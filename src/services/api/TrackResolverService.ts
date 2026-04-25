import { Spotify } from './Spotify';
import { AppleMusic } from './AppleMusic';
import { Deezer } from './Deezer';
import { CacheService } from '../bot/CacheService';
import { LoggerService } from '../bot/LoggerService';

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
}

export class TrackResolverService {
    private static CACHE_TTL = 86400; // 24 hours

    /**
     * Resolves metadata for a track from all available sources in parallel.
     * @param albumHint - Optional album name known by the caller (e.g. from Last.fm).
     *                    If provided and the album cover is already cached, artwork
     *                    resolution is skipped entirely for instant response.
     */
    static async resolve(artistName: string, trackName: string, forceRefresh = false, albumHint?: string): Promise<ResolvedTrack> {
        const query = `${artistName} - ${trackName}`.toLowerCase().trim();
        // Add a version salt to the cache key to allow global cache busting when logic changes
        const cacheKey = `utr:v12:resolve:${Buffer.from(query).toString('base64')}`;

        // 1. Check Redis Cache (Skip if forceRefresh is true)
        if (!forceRefresh) {
            const cached = await CacheService.get<ResolvedTrack>(cacheKey);
            if (cached) {
                LoggerService.utrCacheHit(query);
                return cached;
            }
        }

        // 1b. Album Cover Fast-Path: if we already resolved this album before, reuse the cover
        //     and only fetch track-specific data (links, preview, etc.)
        let cachedAlbumCover: string | null = null;
        if (albumHint) {
            const albumCoverKey = `utr:cover:v11:${Buffer.from(`${artistName.toLowerCase()}:${albumHint.toLowerCase()}`).toString('base64')}`;
            cachedAlbumCover = await CacheService.get<string>(albumCoverKey) || null;
            if (cachedAlbumCover) {
                LoggerService.utrAlbumHit(artistName, albumHint);
            }
        }

        if (!cachedAlbumCover) {
            LoggerService.utrFetch(query);
        }

        // 2. Parallel API Fetch
        const [sp, am, dz, yt] = await Promise.all([
            Spotify.getTrackInfo(trackName, artistName).catch(() => null),
            AppleMusic.searchTrack(artistName, trackName).catch(() => null),
            Deezer.searchTrack(artistName, trackName).catch(() => null),
            this.getYoutubeLink(artistName, trackName).catch(() => null)
        ]);

        // 3. Resolve Artist Avatar (Parallel)
        const bestArtistName = sp?.resolvedArtist || am?.artistName || dz?.artist || artistName;
        const [dzAvatar, spAvatar] = await Promise.all([
            Deezer.getArtistCover(bestArtistName).catch(() => null),
            Spotify.getArtistCover(bestArtistName).catch(() => null)
        ]);
        const artistAvatarUrl = spAvatar || dzAvatar || null;

        // 4. Intelligence: Combine the best data points
        // Strictly prioritize Spotify for EVERYTHING to ensure consistency.
        // HOWEVER, we must validate the match quality to avoid false positives (e.g. unreleased tracks matching wrong songs)
        const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const qTrack = clean(trackName);

        const isSpValid = sp?.resolvedTrack && (clean(sp.resolvedTrack).includes(qTrack) || qTrack.includes(clean(sp.resolvedTrack)));
        const isAmValid = am?.trackName && (clean(am.trackName).includes(qTrack) || qTrack.includes(clean(am.trackName)));
        const isDzValid = dz?.name && (clean(dz.name).includes(qTrack) || qTrack.includes(clean(dz.name)));

        const artist = (isSpValid ? sp?.resolvedArtist : (isAmValid ? am?.artistName : (isDzValid ? dz?.artist : artistName))) || artistName;
        const title = (isSpValid ? sp?.resolvedTrack : (isAmValid ? am?.trackName : (isDzValid ? dz?.name : trackName))) || trackName;
        const album = (isSpValid ? sp?.albumName : (isAmValid ? am?.albumName : (isDzValid ? dz?.album : null))) || albumHint || null;
        
        // Artwork logic: use cached album cover if available, otherwise resolve fresh
        let artworkUrl = cachedAlbumCover 
            || ((isSpValid && sp?.coverUrl) ? sp.coverUrl : (isAmValid && am?.artworkUrl ? am.artworkUrl.replace('{w}x{h}', '1000x1000') : (isDzValid ? dz?.artworkUrl : null)));

        const resolved: ResolvedTrack = {
            artist,
            artistAvatarUrl: artistAvatarUrl,
            title,
            album,
            artworkUrl,
            previewUrl: (isSpValid && sp?.previewUrl ? sp.previewUrl : null) 
                || (isAmValid && am?.previewUrl ? am.previewUrl : null) 
                || (isDzValid && dz?.previewUrl ? dz.previewUrl : null) 
                || am?.previewUrl || dz?.previewUrl || sp?.previewUrl || null,
            durationMs: (isSpValid ? sp?.durationMs : (isAmValid ? am?.durationMs : dz?.durationMs)) || 0,
            links: {
                spotify: (isSpValid ? sp?.trackUrl : null),
                apple: (isAmValid ? am?.storeUrl : null),
                deezer: (isDzValid ? dz?.url : null),
                youtube: yt || null
            },
            source: isSpValid ? 'Spotify' : (isAmValid ? 'Apple Music' : (isDzValid ? 'Deezer' : 'Last.fm Fallback'))
        };

        // 5. Store track result in cache
        await CacheService.set(cacheKey, resolved, this.CACHE_TTL);
        LoggerService.utrResult(resolved.source, resolved.artist, resolved.title);

        // 5b. Write-through: store the album cover separately for future tracks on the same album
        if (artworkUrl && album) {
            const albumCoverKey = `utr:cover:v11:${Buffer.from(`${artist.toLowerCase()}:${album.toLowerCase()}`).toString('base64')}`;
            await CacheService.set(albumCoverKey, artworkUrl, this.CACHE_TTL);
        }

        return resolved;
    }

    /**
     * Resolves metadata for an artist specifically.
     */
    static async resolveArtist(artistName: string): Promise<{ artist: string, avatarUrl: string | null, tags: string[] }> {
        const query = `artist:${artistName}`.toLowerCase().trim();
        const cacheKey = `utr:artist:${Buffer.from(query).toString('base64')}`;

        const cached = await CacheService.get<any>(cacheKey);
        if (cached) return cached;

        const [dzAvatar, spAvatar, lfmTags] = await Promise.all([
            Deezer.getArtistCover(artistName).catch(() => null),
            Spotify.getArtistCover(artistName).catch(() => null),
            import('./LastFM').then(m => m.LastFM.getArtistTopTags(artistName)).catch(() => [])
        ]);

        const result = {
            artist: artistName,
            avatarUrl: dzAvatar || spAvatar || null,
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
        // v11: bumped to flush incorrect results
        const cacheKey = `utr:album:v12:${Buffer.from(query).toString('base64')}`;

        const cached = await CacheService.get<any>(cacheKey);
        if (cached) return cached;

        const [sp, am, dz] = await Promise.all([
            Spotify.getAlbumMetadata(albumName, artistName).catch(() => null),
            AppleMusic.getAlbumMetadata(albumName, artistName).catch(() => null),
            Deezer.getAlbumMetadata(albumName, artistName).catch(() => null)
        ]);

        // Strict validation: only accept cover if the album name is a real match
        const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const qAlbum = clean(albumName);
        const isSpValid = sp?.coverUrl && qAlbum.length > 0;  // Spotify already validates internally
        const isAmValid = am?.coverUrl && qAlbum.length > 0;  // Apple Music already validates internally
        const isDzValid = dz?.coverUrl && qAlbum.length > 0;  // Deezer already validates internally

        // Prioritize Spotify for artwork, then Apple Music, then Deezer
        const artworkUrl = (isSpValid ? sp!.coverUrl : null) 
            || (isAmValid ? am!.coverUrl : null) 
            || (isDzValid ? dz!.coverUrl : null) 
            || null;

        const result = {
            artist: artistName,
            album: albumName,
            artworkUrl,
            releaseYear: sp?.releaseYear || am?.releaseYear || dz?.releaseYear || null,
            albumType: sp?.albumType || am?.albumType || dz?.albumType || null,
            isExplicit: dz?.isExplicit || false,
            source: isSpValid ? 'Spotify' : (isAmValid ? 'Apple Music' : (isDzValid ? 'Deezer' : 'Last.fm'))
        };

        await CacheService.set(cacheKey, result, this.CACHE_TTL);

        return result;
    }

    /**
     * Helper to resolve YouTube link separately if requested
     */
    static async getYoutubeLink(artist: string, track: string): Promise<string | null> {
        const { Youtube } = await import('./Youtube');
        const res = await Youtube.search(`${artist} - ${track}`);
        return res?.url || null;
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
