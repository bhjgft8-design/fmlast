import axios from 'axios';
import { ArtistMetadataService } from '../external/ArtistMetadataService';

// Simple in-memory cache: "albumName|artistName" → cover URL
const coverCache = new Map<string, string | null>();

export class AppleMusic {
    /** Helper to normalize names for strict comparison */
    private static clean(name: string): string {
        return name.toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^\p{L}\p{N}]/gu, '');
    }

    /** 
     * Validates if a result is a reasonably close match. 
     */
    private static validateArtist(expected: string, actual: string): boolean {
        // Special case for zaf: ensure we don't match other artists if we have an override
        const override = ArtistMetadataService.getOverride(expected);
        if (override?.appleMusicId) {
            // In search results, we can't always see the ID easily without extra calls,
            // but we can at least be stricter with the name or use the ID if provided by the result.
            // For now, just do a strict name check if override exists.
            return actual.toLowerCase().trim() === expected.toLowerCase().trim();
        }

        const e = this.clean(expected);
        const a = this.clean(actual);
        if (e === a) return true;
        if (e.length > 3 && (a.includes(e) || e.includes(a))) return true;
        return false;
    }

    /** Get album cover from Apple Music / iTunes Search API (no API key needed) */
    static async getAlbumCover(albumName: string, artistName: string): Promise<string | null> {
        const cacheKey = `album:${albumName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return coverCache.get(cacheKey)!;
        }

        try {
            const { data } = await axios.get('https://itunes.apple.com/search', {
                params: {
                    term: `${albumName} ${artistName}`,
                    media: 'music',
                    entity: 'album',
                    limit: 5,
                },
                timeout: 5000,
            });

            const results = data.results || [];
            const overrideId = ArtistMetadataService.getAppleMusicId(artistName);
            
            const album = results.find((r: any) => {
                if (overrideId && r.artistId && String(r.artistId) !== overrideId) return false;
                return this.validateArtist(artistName, r.artistName);
            }) || results[0];

            if (album && !this.validateArtist(artistName, album.artistName)) {
                coverCache.set(cacheKey, null);
                return null;
            }

            // iTunes returns 100x100 by default — replace with 600x600 for high-res
            const coverUrl = album?.artworkUrl100
                ? album.artworkUrl100.replace('100x100bb', '600x600bb')
                : null;

            coverCache.set(cacheKey, coverUrl);
            return coverUrl;
        } catch (err: any) {
            console.error('Apple Music error:', err.message);
            coverCache.set(cacheKey, null);
            return null;
        }
    }

    /** Get track cover from Apple Music / iTunes Search API */
    static async getTrackCover(trackName: string, artistName: string): Promise<string | null> {
        const cacheKey = `track:${trackName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return coverCache.get(cacheKey)!;
        }

        try {
            const { data } = await axios.get('https://itunes.apple.com/search', {
                params: {
                    term: `${trackName} ${artistName}`,
                    media: 'music',
                    entity: 'musicTrack',
                    limit: 5,
                },
                timeout: 5000,
            });

            const results = data.results || [];
            const overrideId = ArtistMetadataService.getAppleMusicId(artistName);

            const track = results.find((r: any) => {
                if (overrideId && r.artistId && String(r.artistId) !== overrideId) return false;
                return this.validateArtist(artistName, r.artistName);
            }) || results[0];

            if (track && !this.validateArtist(artistName, track.artistName)) {
                coverCache.set(cacheKey, null);
                return null;
            }

            const coverUrl = track?.artworkUrl100
                ? track.artworkUrl100.replace('100x100bb', '600x600bb')
                : null;

            coverCache.set(cacheKey, coverUrl);
            return coverUrl;
        } catch (err: any) {
            console.error('Apple Music track error:', err.message);
            coverCache.set(cacheKey, null);
            return null;
        }
    }

    /** Get album metadata (type, release year) — used for chart filtering */
    static async getAlbumMetadata(albumName: string, artistName: string): Promise<{
        coverUrl: string | null;
        albumType: string | null;
        releaseYear: number | null;
    }> {
        const cacheKey = `meta:${albumName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return JSON.parse(coverCache.get(cacheKey)!);
        }

        try {
            const { data } = await axios.get('https://itunes.apple.com/search', {
                params: {
                    term: `${albumName} ${artistName}`,
                    media: 'music',
                    entity: 'album',
                    limit: 5,
                },
                timeout: 5000,
            });

            const album = data.results?.[0];
            const coverUrl = album?.artworkUrl100
                ? album.artworkUrl100.replace('100x100bb', '600x600bb')
                : null;

            // iTunes collectionType: "Album", "Single", "EP"
            let albumType: string | null = null;
            if (album?.collectionType) {
                const type = album.collectionType.toLowerCase();
                if (type.includes('single')) albumType = 'single';
                else if (type.includes('ep')) albumType = 'ep';
                else albumType = 'album';
            }

            const releaseYear = album?.releaseDate
                ? parseInt(album.releaseDate.substring(0, 4))
                : null;

            const result = { coverUrl, albumType, releaseYear };
            coverCache.set(cacheKey, JSON.stringify(result));
            return result;
        } catch (err: any) {
            console.error('Apple Music metadata error:', err.message);
            const fallback = { coverUrl: null, albumType: null, releaseYear: null };
            coverCache.set(cacheKey, JSON.stringify(fallback));
            return fallback;
        }
    }

    /** Search for a track and get full metadata, including artwork (Universal Search) */
    static async searchTrack(artistName: string, trackName: string, albumHint?: string): Promise<{
        trackName: string;
        artistName: string;
        albumName: string | null;
        albumId: string | null;
        albumType: string | null;
        artworkUrl: string | null;
        durationMs: number;
        previewUrl: string | null;
        storeUrl: string;
    } | null> {
        try {
            const originalQuery = (artistName ? `${artistName} ${trackName}` : trackName).toLowerCase();
            const { data } = await axios.get('https://itunes.apple.com/search', {
                params: {
                    term: artistName ? `${artistName} ${trackName}` : trackName,
                    media: 'music',
                    entity: 'song',
                    limit: 15,
                },

                timeout: 5000,
            });

            if (data.results?.length > 0) {
                const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                const cleanQuery = clean(artistName ? `${artistName} ${trackName}` : trackName);
                const cleanArtist = clean(artistName || '');
                const cleanTrack = clean(trackName || '');
                const cleanAlbumHint = albumHint ? clean(albumHint) : '';

                const scoredResults = data.results.map((item: any) => {
                    const resTrack = (item.trackName || '').toLowerCase();
                    const resArt = (item.artistName || '').toLowerCase();
                    const resColl = (item.collectionName || '').toLowerCase();
                    const combined = `${resArt} ${resTrack}`;
                    
                    const cResArt = clean(resArt);
                    const cResTrack = clean(resTrack);
                    const cCombined = clean(combined);

                    let score = 0;

                    // 1. Symbol-Agnostic Exact Match (Highest Priority)
                    if (cCombined === cleanQuery) score += 5000;
                    if (cResTrack === cleanTrack && cResArt === cleanArtist) score += 4000;

                    // 2. Artist Match (CRITICAL for Devon Hendryx/Special symbols)
                    if (cResArt === cleanArtist) score += 2000;
                    if (resArt.includes(artistName.toLowerCase())) score += 1000;

                    // 3. Track Match
                    let trackMatchScore = 0;
                    if (cResTrack === cleanTrack) trackMatchScore += 1000;
                    if (resTrack.includes(trackName.toLowerCase()) || trackName.toLowerCase().includes(resTrack)) trackMatchScore += 500;
                    if (cResTrack.includes(cleanTrack) || cleanTrack.includes(cResTrack)) trackMatchScore += 500;
                    
                    score += trackMatchScore;

                    // 4. PENALTY: Avoid matching "Lil Baby" if user typed "Lil Baba"
                    if (artistName.toLowerCase().includes('baba') && !resArt.includes('baba')) score -= 5000;

                    // Reject completely different artists to avoid popular artist hijacking
                    const overrideId = ArtistMetadataService.getAppleMusicId(artistName);
                    if (overrideId && String(item.artistId || '') !== overrideId) {
                        return { item, score: -1 };
                    }

                    if (cleanArtist && cResArt !== cleanArtist && !resArt.includes(artistName.toLowerCase()) && !artistName.toLowerCase().includes(resArt)) {
                        // Only allow matches if the track name is extremely confident
                        if (cResTrack !== cleanTrack) {
                            return { item, score: -1 };
                        }
                        score -= 2000;
                    }

                    // Final validation: reject results that are completely irrelevant
                    if (cleanTrack && trackMatchScore === 0) {
                        // If artist matches exactly, we allow a high typo tolerance 
                        // as long as it's the top result from the service.
                        if (cResArt === cleanArtist) {
                            score -= 1000; // Small penalty for mismatch
                        } else {
                            // If artist is also wrong/fuzzy, we reject the mismatch
                            return { item, score: -1 };
                        }
                    }


                    // 4. Collection/Album Preference
                    if (cleanAlbumHint && resColl) {
                        const cResColl = clean(resColl);
                        if (cResColl === cleanAlbumHint) score += 3500;
                        else if (cResColl.includes(cleanAlbumHint) || cleanAlbumHint.includes(cResColl)) score += 1500;
                    }

                    // If the user provided a "❤️" or symbol hint and it matches the collection
                    const querySymbols = (artistName + trackName).replace(/[a-z0-9\s]/g, '');
                    const resSymbols = (resArt + resTrack + resColl).replace(/[a-z0-9\s]/g, '');
                    if (querySymbols && resSymbols.includes(querySymbols)) score += 800;

                    // 5. Popularity Tie-breaker
                    // Apple Music results are somewhat ordered by popularity, so we add a tiny weight to preserve AM's intent if scores are close
                    score += (15 - data.results.indexOf(item)) * 10;

                    return { item, score };
                });

                const validResults = scoredResults.filter((r: any) => r.score >= 0);
                if (validResults.length === 0) return null;

                validResults.sort((a: any, b: any) => b.score - a.score);
                const track = validResults[0].item;

                if (track.trackName && track.artistName && track.trackViewUrl) {
                    const artworkUrl = track.artworkUrl100
                        ? track.artworkUrl100.replace('100x100bb', '600x600bb')
                        : null;

                    let albumType: string | null = null;
                    if (track.collectionType) {
                        const type = track.collectionType.toLowerCase();
                        if (type.includes('single')) albumType = 'single';
                        else if (type.includes('ep')) albumType = 'ep';
                        else albumType = 'album';
                    }

                    return {
                        trackName: track.trackName,
                        artistName: track.artistName,
                        albumName: track.collectionName ?? null,
                        albumId: track.collectionId ? String(track.collectionId) : null,
                        albumType: albumType,
                        artworkUrl: artworkUrl,
                        durationMs: track.trackTimeMillis ? Number(track.trackTimeMillis) : 0,
                        previewUrl: track.previewUrl ?? null,
                        storeUrl: track.trackViewUrl,
                    };
                }
            }
            return null;
        } catch (err: any) {
            console.error('Apple Music searchTrack error:', err.message);
            return null;
        }
    }

    /** Get ALL tracks from an album with preview URLs using iTunes Lookup API */
    static async getAlbumTracks(albumId: string): Promise<{ name: string; previewUrl: string | null }[]> {
        try {
            const { data } = await axios.get('https://itunes.apple.com/lookup', {
                params: {
                    id: albumId,
                    entity: 'song',
                    limit: 200,
                },
                timeout: 5000,
            });

            if (!data?.results?.length) return [];

            // The first result is often the album itself, the rest are songs
            return data.results
                .filter((res: any) => res.kind === 'song')
                .map((res: any) => ({
                    name: res.trackName || 'Unknown Track',
                    previewUrl: res.previewUrl || null,
                }));
        } catch (err: any) {
            console.error('Apple Music getAlbumTracks error:', err.message);
            return [];
        }
    }
}
