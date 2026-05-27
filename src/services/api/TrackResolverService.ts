import { Spotify } from './Spotify';
import { AppleMusic } from './AppleMusic';
import { Deezer } from './Deezer';
import { LastFM } from './LastFM';
import { CacheService } from '../bot/CacheService';
import { TitleCleaner } from '../../utils/title';
import { LoggerService } from '../bot/LoggerService';
import { ProviderCircuitBreaker } from './ProviderCircuitBreaker';

export interface ResolvedTrack {
    artist: string;
    artistAvatarUrl: string | null;
    title: string;
    album: string | null;
    artworkUrl: string | null;
    previewUrl: string | null;
    durationMs: number;
    links: {
        spotify: string | null;
        apple: string | null;
        deezer: string | null;
        youtube: string | null;
    };
    source: string;
    resolverMeta?: {
        selectedScore: number;
        timings: Record<string, number>;
        candidates: Array<{ source: string; score: number; album: string | null; durationMs: number }>;
    };
}

export class TrackResolverService {
    private static CACHE_TTL = 86400; // 24 hours

    private static async timed<T>(name: 'spotify' | 'apple' | 'deezer' | 'youtube' | 'lastfm', task: () => Promise<T>): Promise<{ name: string; ms: number; value: T | null; skipped: boolean }> {
        if (!ProviderCircuitBreaker.isAvailable(name)) {
            return { name, ms: 0, value: null, skipped: true };
        }

        const start = performance.now();
        try {
            const value = await task();
            if (value) ProviderCircuitBreaker.recordSuccess(name);
            else ProviderCircuitBreaker.recordFailure(name);
            return { name, ms: performance.now() - start, value, skipped: false };
        } catch {
            ProviderCircuitBreaker.recordFailure(name);
            return { name, ms: performance.now() - start, value: null, skipped: false };
        }
    }

    /**
     * Resolves metadata for a track from all available sources in parallel.
     * @param albumHint - Optional album name known by the caller (e.g. from Last.fm).
     *                    If provided and the album cover is already cached, artwork
     *                    resolution is skipped entirely for instant response.
     */
    static async resolve(artistName: string, trackName: string, forceRefresh = false, albumHint?: string): Promise<ResolvedTrack> {
        const query = `${artistName} - ${trackName}`.toLowerCase().trim();
        const normalizedAlbumHint = albumHint?.trim() || '';
        const queryWithContext = normalizedAlbumHint ? `${query} @ ${normalizedAlbumHint.toLowerCase()}` : query;
        // v13: Strict similarity validation + CAS fix
        const cacheKey = `utr:v15:resolve:${Buffer.from(queryWithContext).toString('base64')}`;

        // 1. Check Redis Cache
        if (!forceRefresh) {
            const cached = await CacheService.get<ResolvedTrack>(cacheKey);
            if (cached) {
                LoggerService.utrCacheHit(query);
                return cached;
            }
        }

        // 1b. Album Cover Fast-Path
        let cachedAlbumCover: string | null = null;
        if (normalizedAlbumHint) {
            const albumCoverKey = `utr:cover:v12:${Buffer.from(`${artistName.toLowerCase()}:${normalizedAlbumHint.toLowerCase()}`).toString('base64')}`;
            cachedAlbumCover = await CacheService.get<string>(albumCoverKey) || null;
        }

        // 2. Parallel API Fetch
        LoggerService.utrFetch(queryWithContext);
        const timedFetches = await Promise.all([
            this.timed('spotify', () => Spotify.getTrackInfo(trackName, artistName, normalizedAlbumHint || undefined)),
            this.timed('apple', () => AppleMusic.searchTrack(artistName, trackName, normalizedAlbumHint || undefined)),
            this.timed('deezer', () => Deezer.searchTrack(artistName, trackName, normalizedAlbumHint || undefined)),
            this.timed('youtube', () => this.getYoutubeLink(artistName, trackName)),
            this.timed('lastfm', () => LastFM.getTrackInfo(artistName, trackName))
        ]);
        const timings = Object.fromEntries(timedFetches.map(item => [item.name, item.skipped ? -1 : item.ms]));
        LoggerService.utrTiming(queryWithContext, timings);
        const [sp, am, dz, yt, lfm] = timedFetches.map(item => item.value) as any[];

        // 3. Resolve Artist Avatar
        const bestArtistName = sp?.resolvedArtist || am?.artistName || dz?.artist || artistName;
        const [dzAvatar, spAvatar] = await Promise.all([
            Deezer.getArtistCover(bestArtistName).catch(() => null),
            Spotify.getArtistCover(bestArtistName).catch(() => null)
        ]);
        const artistAvatarUrl = spAvatar || dzAvatar || null;

        // 4. Intelligence: Combine the best data points with STRICT similarity validation
        const normalizeFeaturedArtists = (s: string) => (s || '')
            .toLowerCase()
            .replace(/\b(featuring|feat\.?|ft\.?|with)\b/g, ' ')
            .replace(/\s+x\s+/g, ' ')
            .replace(/&/g, ' and ');
        const clean = (s: string) => normalizeFeaturedArtists(s).replace(/[^a-z0-9]/g, '');
        const qTrack = clean(trackName);
        const qArtist = clean(artistName);
        const versionTerms = ['remix', 'live', 'acoustic', 'sped up', 'speed up', 'slowed', 'reverb', 'demo', 'remaster', 'remastered', 'edit', 'instrumental', 'karaoke', 'cover', 'deluxe'];
        const getVersions = (s: string) => {
            const normalized = normalizeFeaturedArtists(s);
            return versionTerms.filter(term => normalized.includes(term));
        };
        const qVersions = getVersions(trackName);

        // Known artists where strict matching fails — bypass isMatch entirely
        const TRUSTED_ARTISTS = [
            'cigarettes after sex', 'cas', 'tv girl', 'the weeknd', 'lana del rey', 
            'the arctic monkeys', 'arctic monkeys', 'beach house', 'zaid khaled', 'el waili'
        ];

        const isTrustedArtist = TRUSTED_ARTISTS.some(a => 
            qArtist.includes(clean(a)) || clean(a).includes(qArtist)
        );

        // Helper: Check if result is reasonably similar to query
        const isMatch = (resTitle: string, resArtist: string) => {
            const rT = clean(resTitle);
            const rA = clean(resArtist);
            if (!rT) return false;
            
            const titleMatch = rT.includes(qTrack) || qTrack.includes(rT) || 
                               rT.startsWith(qTrack.substring(0, 4)); // prefix match for short titles
            
            // Stricter artist match: 
            // 1. One must contain the other
            // 2. The length difference shouldn't be extreme (e.g. "Savage" vs "Niky Savage")
            //    unless the result is a common "Topic" or "Official" channel
            let artistMatch = !qArtist || rA.includes(qArtist) || qArtist.includes(rA);
            
            if (artistMatch && qArtist.length > 3) {
                const lenDiff = Math.abs(rA.length - qArtist.length);
                // If the difference is more than 60% of the longer string, it's likely a different artist
                // (e.g. "savage" [6] vs "nikysavage" [10] -> diff 4. 4/10 = 0.4. Allowed.
                // wait, "savage" [6] vs "21savage" [8] -> diff 2. Allowed.
                // But "savage" [6] vs "savage garden" [12] -> diff 6. 6/12 = 0.5.
                if (lenDiff > Math.max(rA.length, qArtist.length) * 0.6 && !rA.includes('topic')) {
                    artistMatch = false;
                }
            }
            
            return titleMatch && artistMatch;
        };

        const isSpValid = !!sp?.resolvedTrack || (!!sp?.trackUrl && isTrustedArtist);
        const isAmValid = am?.trackName && (isTrustedArtist || isMatch(am.trackName, am.artistName));
        const isDzValid = dz?.name && (isTrustedArtist || isMatch(dz.name, dz.artist));

        type Candidate = {
            source: string;
            artist: string;
            title: string;
            album: string | null;
            artworkUrl: string | null;
            previewUrl: string | null;
            durationMs: number;
            link: string | null;
            valid: boolean;
            score: number;
        };

        const candidateInputs: Array<Omit<Candidate, 'score'> & { providerBoost: number }> = [
            {
                source: 'Spotify',
                artist: sp?.resolvedArtist || artistName,
                title: sp?.resolvedTrack || trackName,
                album: sp?.albumName || null,
                artworkUrl: sp?.coverUrl || null,
                previewUrl: sp?.previewUrl || null,
                durationMs: sp?.durationMs || 0,
                link: sp?.trackUrl || null,
                valid: !!isSpValid,
                providerBoost: 8
            },
            {
                source: 'Apple Music',
                artist: am?.artistName || artistName,
                title: am?.trackName || trackName,
                album: am?.albumName || null,
                artworkUrl: am?.artworkUrl ? am.artworkUrl.replace('{w}x{h}', '1000x1000') : null,
                previewUrl: am?.previewUrl || null,
                durationMs: am?.durationMs || 0,
                link: am?.storeUrl || null,
                valid: !!isAmValid,
                providerBoost: 6
            },
            {
                source: 'Deezer',
                artist: dz?.artist || artistName,
                title: dz?.name || trackName,
                album: dz?.album || null,
                artworkUrl: dz?.artworkUrl || null,
                previewUrl: dz?.previewUrl || null,
                durationMs: dz?.durationMs || 0,
                link: dz?.url || null,
                valid: !!isDzValid,
                providerBoost: 4
            }
        ];
        const validInputs = candidateInputs.filter(candidate => candidate.valid);

        const scoreCandidate = (candidate: Omit<Candidate, 'score'>, providerBoost: number): Candidate => {
            if (!candidate.valid) return { ...candidate, score: -1 };
            const cTitle = clean(candidate.title);
            const cArtist = clean(candidate.artist);
            const cAlbum = clean(candidate.album || '');
            const cHint = clean(normalizedAlbumHint);
            const cVersions = getVersions(candidate.title);
            let score = 100 + providerBoost;

            if (cTitle === qTrack) score += 70;
            else if (cTitle.includes(qTrack) || qTrack.includes(cTitle)) score += 35;

            if (!qArtist) score += 10;
            else if (cArtist === qArtist) score += 55;
            else if (cArtist.includes(qArtist) || qArtist.includes(cArtist)) score += 25;

            if (cHint && cAlbum) {
                if (cAlbum === cHint) score += 90;
                else if (cAlbum.includes(cHint) || cHint.includes(cAlbum)) score += 40;
            }

            const missingRequestedVersions = qVersions.filter(term => !cVersions.includes(term));
            const extraCandidateVersions = cVersions.filter(term => !qVersions.includes(term));
            if (qVersions.length > 0 && missingRequestedVersions.length === 0) score += 35;
            if (missingRequestedVersions.length > 0) score -= 45;
            if (qVersions.length === 0 && extraCandidateVersions.length > 0) score -= 25;

            const durationMatches = validInputs.filter(peer => {
                if (peer.source === candidate.source || !peer.durationMs || !candidate.durationMs) return false;
                return Math.abs(peer.durationMs - candidate.durationMs) <= 4000;
            }).length;
            score += durationMatches * 18;

            const agreementMatches = validInputs.filter(peer => {
                if (peer.source === candidate.source) return false;
                const sameTitle = clean(peer.title) === cTitle;
                const sameAlbum = !!peer.album && !!candidate.album && clean(peer.album) === cAlbum;
                const sameArtist = clean(peer.artist) === cArtist;
                return sameTitle && sameArtist && (!candidate.album || !peer.album || sameAlbum);
            }).length;
            score += agreementMatches * 20;

            if (candidate.artworkUrl) score += 25;
            if (candidate.previewUrl) score += 5;
            if (candidate.link) score += 10;
            if (candidate.durationMs > 0) score += 5;
            return { ...candidate, score };
        };

        const candidates: Candidate[] = candidateInputs
            .map(({ providerBoost, ...candidate }) => scoreCandidate(candidate, providerBoost))
            .filter(candidate => candidate.score >= 0);

        const best = candidates.sort((a, b) => b.score - a.score)[0];

        const artist = best?.artist || artistName;
        const title = best?.title || trackName;
        const album = normalizedAlbumHint || best?.album || null;

        // Artwork logic
        const lfmImage = lfm?.album?.image?.find((img: any) => img.size === 'extralarge')?.['#text']
            || lfm?.album?.image?.find((img: any) => img.size === 'large')?.['#text'];
        const isLfmValid = lfmImage && !LastFM.isDefaultImage(lfmImage);

        let artworkUrl = cachedAlbumCover 
            || best?.artworkUrl
            || (isLfmValid ? lfmImage : null);

        if (!isSpValid && !isAmValid && !isDzValid) {
            console.warn(`[UTR] Match failed for: ${query}. SP:${!!sp?.resolvedTrack} AM:${!!am?.trackName} DZ:${!!dz?.name}`);
        }

        const resolved: ResolvedTrack = {
            artist,
            artistAvatarUrl: artistAvatarUrl,
            title,
            album,
            artworkUrl,
            previewUrl: best?.previewUrl || null,
            durationMs: best?.durationMs || 0,
            links: {
                spotify: (isSpValid ? sp?.trackUrl : null),
                apple: (isAmValid ? am?.storeUrl : null),
                deezer: (isDzValid ? dz?.url : null),
                youtube: yt || null
            },
            source: best?.source || 'Last.fm Fallback',
            resolverMeta: {
                selectedScore: best?.score || 0,
                timings,
                candidates: candidates.map(candidate => ({
                    source: candidate.source,
                    score: candidate.score,
                    album: candidate.album,
                    durationMs: candidate.durationMs
                }))
            }
        };

        // 5. Store track result in cache
        await CacheService.set(cacheKey, resolved, this.CACHE_TTL);
        if (best) LoggerService.utrScoredResult(resolved.source, best.score, resolved.artist, resolved.title, resolved.album);
        else LoggerService.utrResult(resolved.source, resolved.artist, resolved.title);


        // 5b. Write-through: store the album cover separately for future tracks on the same album
        if (artworkUrl && album) {
            const albumCoverKey = `utr:cover:v12:${Buffer.from(`${artist.toLowerCase()}:${album.toLowerCase()}`).toString('base64')}`;
            await CacheService.set(albumCoverKey, artworkUrl, this.CACHE_TTL);
        }

        return resolved;
    }

    /**
     * Resolves metadata for an artist specifically.
     */
    static async resolveArtist(artistName: string): Promise<{ artist: string, avatarUrl: string | null, tags: string[] }> {
        const query = `artist:${artistName}`.toLowerCase().trim();
        const cacheKey = `utr:artist:v2:${Buffer.from(query).toString('base64')}`;

        const cached = await CacheService.get<any>(cacheKey);
        if (cached) return cached;

        const [dzAvatar, spAvatar, lfmTags] = await Promise.all([
            Deezer.getArtistCover(artistName).catch(() => null),
            Spotify.getArtistCover(artistName).catch(() => null),
            LastFM.getArtistTopTags(artistName).catch(() => [])
        ]);

        const result = {
            artist: artistName,
            avatarUrl: spAvatar || dzAvatar || null,
            tags: lfmTags.map((t: any) => t.name).slice(0, 5)
        };

        await CacheService.set(cacheKey, result, this.CACHE_TTL);

        return result;
    }

    /**
     * Resolves metadata for an album specifically.
     * Uses strict name validation to prevent false positives.
     */
    static async resolveAlbum(artistName: string, albumName: string): Promise<{ 
        artist: string, 
        album: string, 
        artworkUrl: string | null, 
        releaseYear: number | null, 
        albumType: string | null,
        isExplicit: boolean,
        source: string 
    }> {
        const query = `album:${artistName} - ${albumName}`.toLowerCase().trim();
        const cacheKey = `utr:album:v13:${Buffer.from(query).toString('base64')}`;

        const cached = await CacheService.get<any>(cacheKey);
        if (cached) {
            LoggerService.utrAlbumHit(artistName, albumName);
            return cached;
        }

        const resolve = async (aName: string, albName: string) => {
            const [sp, am, dz, lfm] = await Promise.all([
                Spotify.getAlbumMetadata(albName, aName).catch(() => null),
                AppleMusic.getAlbumMetadata(albName, aName).catch(() => null),
                Deezer.getAlbumMetadata(albName, aName).catch(() => null),
                LastFM.getAlbumInfo(aName, albName).catch(() => null)
            ]);

            const lfmImage = lfm?.image?.find((img: any) => img.size === 'extralarge')?.['#text']
                || lfm?.image?.find((img: any) => img.size === 'large')?.['#text'];
            const isLfmValid = lfmImage && !LastFM.isDefaultImage(lfmImage);

            const artworkUrl = (sp?.coverUrl) 
                || (am?.coverUrl) 
                || (dz?.coverUrl) 
                || (isLfmValid ? lfmImage : null);

            return { artworkUrl, sp, am, dz, lfm, isLfmValid };
        };

        // 1. Try with original name
        let result = await resolve(artistName, albumName);

        // 2. If no artwork, try with cleaned name
        if (!result.artworkUrl) {
            const cleanedName = TitleCleaner.cleanAlbumName(albumName);
            if (cleanedName !== albumName) {
                console.log(`[UTR] Retrying resolution with cleaned name: ${cleanedName}`);
                result = await resolve(artistName, cleanedName);
            }
        }

        const { artworkUrl, sp, am, dz, lfm, isLfmValid } = result;

        const finalResult = {
            artist: artistName,
            album: albumName,
            artworkUrl,
            releaseYear: sp?.releaseYear || am?.releaseYear || dz?.releaseYear || null,
            albumType: sp?.albumType || am?.albumType || dz?.albumType || null,
            isExplicit: dz?.isExplicit || false,
            source: sp?.coverUrl ? 'Spotify' : (am?.coverUrl ? 'Apple Music' : (dz?.coverUrl ? 'Deezer' : (isLfmValid ? 'Last.fm' : 'None')))
        };

        await CacheService.set(cacheKey, finalResult, this.CACHE_TTL);
        return finalResult;
    }

    private static isValidMatch(resTitle: string, resArtist: string, qTrack: string, qArtist: string): boolean {
        const clean = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const rT = clean(resTitle);
        const rA = clean(resArtist);
        const qt = clean(qTrack);
        const qa = clean(qArtist);

        if (!rT) return false;

        const titleMatch = rT.includes(qt) || qt.includes(rT) || rT.startsWith(qt.substring(0, 4));
        let artistMatch = !qa || rA.includes(qa) || qa.includes(rA);

        if (artistMatch && qa.length > 3) {
            const lenDiff = Math.abs(rA.length - qa.length);
            if (lenDiff > Math.max(rA.length, qa.length) * 0.6 && !rA.includes('topic')) {
                artistMatch = false;
            }
        }

        return titleMatch && artistMatch;
    }

    /**
     * Helper to resolve YouTube link separately if requested.
     * Uses strict similarity validation to prevent false positives for common artist names.
     */
    static async getYoutubeLink(artist: string, track: string): Promise<string | null> {
        const { Youtube } = await import('./Youtube');
        
        // Clean characters that break YouTube search
        const cleanQuery = `${artist} - ${track}`.replace(/[!?]/g, '').trim();
        const isArabic = /[\u0600-\u06FF]/.test(cleanQuery);
        const hasSpecificVersion = /\b(remix|cover|live|slowed|reverb|acoustic|version|edit|mashup|mix|remake|instrumental|karaoke|sped\s+up|speed\s+up|official|audio|video|music)\b/i.test(cleanQuery);
        const searchQuery = (isArabic || hasSpecificVersion) ? cleanQuery : `${cleanQuery} (Official Audio)`;
        const results = await Youtube.searchByQuery(searchQuery);
        
        if (!results || results.length === 0) return null;

        // Find the best match among top 3 results using shared validation
        for (const res of results.slice(0, 3)) {
            if (this.isValidMatch(res.title, res.channelTitle, track, artist)) {
                return res.url;
            }
        }

        // Final fallback for exact match in title
        const first = results[0];
        const clean = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean(first.title).includes(clean(artist)) && clean(first.title).includes(clean(track))) {
            return first.url;
        }

        return null;
    }

    /**
     * Parses a streaming service link and returns the artist and track name.
     */
    static async parseStreamingLink(url: string): Promise<{ artist: string; track: string } | null> {
        // Spotify
        const spTrackMatch = url.match(/(?:https?:\/\/)?open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
        if (spTrackMatch) {
            const meta = await Spotify.getTrackMetadataById(spTrackMatch[1]);
            return meta ? { artist: meta.artist, track: meta.name } : null;
        }

        const spAlbumMatch = url.match(/(?:https?:\/\/)?open\.spotify\.com\/album\/([a-zA-Z0-9]+)/);
        if (spAlbumMatch) {
            const meta = await Spotify.getAlbumMetadataById(spAlbumMatch[1]);
            return meta ? { artist: meta.artist, track: meta.name } : null;
        }

        const spArtistMatch = url.match(/(?:https?:\/\/)?open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
        if (spArtistMatch) {
            const meta = await Spotify.getArtistMetadataById(spArtistMatch[1]);
            return meta ? { artist: meta.artist, track: '' } : null;
        }

        // Apple Music
        const amTrackMatch = url.match(/(?:https?:\/\/)?music\.apple\.com\/\w+\/album\/.+\/(\d+)(?:\?i=(\d+))?/);
        if (amTrackMatch) {
            const trackId = amTrackMatch[2] || amTrackMatch[1];
            // Apple Music searchTrack uses query, but we can try to find by ID if we implement a lookup
            // For now, let's use search with the ID if possible, or just the URL
            const res = await AppleMusic.searchTrack('', url);
            if (res) return { artist: res.artistName, track: res.trackName };
        }

        // Deezer
        const dzTrackMatch = url.match(/(?:https?:\/\/)?(?:www\.)?deezer\.com\/\w+\/track\/(\d+)/);
        if (dzTrackMatch) {
            const res = await Deezer.searchTrack('', url);
            if (res) return { artist: res.artist, track: res.name };
        }

        return null;
    }
}
