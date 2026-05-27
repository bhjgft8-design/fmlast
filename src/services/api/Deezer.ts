import axios from 'axios';
import { ArtistMetadataService } from '../external/ArtistMetadataService';

// Simple in-memory cache: "trackName|artistName" → cover URL
const coverCache = new Map<string, string | null>();

export class Deezer {
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
        const e = this.clean(expected);
        const a = this.clean(actual);
        if (e === a) return true;
        if (e.length > 3 && (a.includes(e) || e.includes(a))) return true;
        return false;
    }

    /** Get best cover from Deezer (no API key needed) */
    static async getTrackCover(trackName: string, artistName: string): Promise<string | null> {
        if (ArtistMetadataService.isDeezerDisabled(artistName)) return null;
        const cacheKey = `${trackName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return coverCache.get(cacheKey)!;
        }

        try {
            const { data } = await axios.get('https://api.deezer.com/search/track', {
                params: {
                    q: `"${trackName}" "${artistName}"`,
                    limit: 5,
                },
            });

            const results = data.data || [];
            const track = results.find((r: any) => this.validateArtist(artistName, r.artist?.name)) || results[0];

            if (track && !this.validateArtist(artistName, track.artist?.name)) {
                coverCache.set(cacheKey, null);
                return null;
            }

            const coverUrl = track?.album?.cover_xl || track?.album?.cover_big || track?.album?.cover_medium || null;

            coverCache.set(cacheKey, coverUrl);

            if (coverUrl) console.log(`🎨 Deezer cover found: ${trackName}`);
            else console.log(`⚠️ Deezer cover not found for: ${trackName}`);

            return coverUrl;
        } catch (err: any) {
            console.error('Deezer error:', err.message);
            coverCache.set(cacheKey, null);
            return null;
        }
    }

    /** Get best ALBUM cover from Deezer (used by chart fallback) */
    static async getAlbumCover(albumName: string, artistName: string): Promise<string | null> {
        const cacheKey = `album:${albumName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return coverCache.get(cacheKey)!;
        }

        try {
            const { data } = await axios.get('https://api.deezer.com/search/album', {
                params: {
                    q: `"${albumName}" "${artistName}"`,
                    limit: 5,
                },
            });

            const results = data.data || [];
            const album = results.find((r: any) => this.validateArtist(artistName, r.artist?.name)) || results[0];

            if (album && !this.validateArtist(artistName, album.artist?.name)) {
                coverCache.set(cacheKey, null);
                return null;
            }

            const coverUrl = album?.cover_xl || album?.cover_big || album?.cover_medium || null;

            coverCache.set(cacheKey, coverUrl);

            if (coverUrl) console.log(`🎨 Deezer album cover found: ${albumName}`);
            else console.log(`⚠️ Deezer album cover not found for: ${albumName}`);

            return coverUrl;
        } catch (err: any) {
            console.error('Deezer album error:', err.message);
            coverCache.set(cacheKey, null);
            return null;
        }
    }

    /** Get album metadata (type, explicit, release year) from Deezer — used for chart filtering */
    static async getAlbumMetadata(albumName: string, artistName: string): Promise<{
        coverUrl: string | null;
        albumType: string | null;
        isExplicit: boolean;
        releaseYear: number | null;
    }> {
        const cacheKey = `meta:${albumName.toLowerCase()}|${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return JSON.parse(coverCache.get(cacheKey)!);
        }

        try {
            const { data } = await axios.get('https://api.deezer.com/search/album', {
                params: {
                    q: `"${albumName}" "${artistName}"`,
                    limit: 5,
                },
            });

            const album = data.data?.[0];
            const result = {
                coverUrl: album?.cover_xl || album?.cover_big || album?.cover_medium || null,
                albumType: album?.record_type || null, // "album", "single", "ep", "compile"
                isExplicit: album?.explicit_lyrics === true,
                releaseYear: album?.release_date ? parseInt(album.release_date.substring(0, 4)) : null,
            };

            coverCache.set(cacheKey, JSON.stringify(result));
            return result;
        } catch (err: any) {
            console.error('Deezer metadata error:', err.message);
            const fallback = { coverUrl: null, albumType: null, isExplicit: false, releaseYear: null };
            coverCache.set(cacheKey, JSON.stringify(fallback));
            return fallback;
        }
    }

    /** Search for a track and get full metadata, including artwork (Universal Search) */
    static async searchTrack(artistName: string, trackName: string, albumHint?: string): Promise<{
        id: string;
        albumId: string | null;
        name: string;
        artist: string;
        album: string | null;
        albumType: string | null;
        artworkUrl: string | null;
        url: string;
        previewUrl: string | null;
        durationMs: number;
    } | null> {
        if (ArtistMetadataService.isDeezerDisabled(artistName)) return null;
        try {
            const originalQuery = (artistName ? `${artistName} ${trackName}` : trackName).toLowerCase();
            const { data } = await axios.get(`https://api.deezer.com/search`, {
                params: {
                    q: originalQuery,
                    limit: 50 // Increase significantly to find correct artists buried under popular hits
                }
            });
            
            if (!data?.data?.length) return null;

            const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanArtist = clean(artistName || '');
            const cleanTrack = clean(trackName || '');
            const cleanAlbumHint = albumHint ? clean(albumHint) : '';

            // INTELLIGENT SCORING SYSTEM: Deezer API is heavily biased towards popular artists
            const scoredResults = data.data.map((item: any) => {
                const resTrack = (item.title || '').toLowerCase();
                const resArt = (item.artist?.name || '').toLowerCase();
                const resColl = (item.album?.title || '').toLowerCase();
                
                const cResArt = clean(resArt);
                const cResTrack = clean(resTrack);
                const cResColl = clean(resColl);

                let score = 0;

                // 1. Symbol-Agnostic Match (Highest Priority)
                if (cResArt === cleanArtist && cResTrack === cleanTrack) score += 5000;

                // 2. Artist Match (CRITICAL)
                if (cResArt === cleanArtist) score += 2000;
                if (resArt.includes(artistName.toLowerCase())) score += 1000;

                // 3. Track Match
                let trackMatchScore = 0;
                if (cResTrack === cleanTrack) trackMatchScore += 1000;
                if (resTrack.includes(trackName.toLowerCase()) || trackName.toLowerCase().includes(resTrack)) trackMatchScore += 500;
                if (cResTrack.includes(cleanTrack) || cleanTrack.includes(cResTrack)) trackMatchScore += 500;
                
                score += trackMatchScore;

                if (cleanTrack && trackMatchScore === 0) {
                    // If artist matches exactly, we allow a high typo tolerance 
                    if (cResArt === cleanArtist) {
                        score -= 1000;
                    } else {
                        return { item, score: -1 };
                    }
                }

                // 4. Symbol Match (E.g. ❤️ or 🖤)
                const querySymbols = (artistName + trackName).replace(/[a-z0-9\s]/g, '');
                const resSymbols = (resArt + resTrack + resColl).replace(/[a-z0-9\s]/g, '');
                if (querySymbols && resSymbols.includes(querySymbols)) score += 800;

                if (cleanAlbumHint && cResColl) {
                    if (cResColl === cleanAlbumHint) score += 3500;
                    else if (cResColl.includes(cleanAlbumHint) || cleanAlbumHint.includes(cResColl)) score += 1500;
                }

                // 5. PENALTY: Avoid matching "Lil Baby" if user typed "Lil Baba"
                if (artistName.toLowerCase().includes('baba') && !resArt.includes('baba')) score -= 5000;

                return { item, score };
            });

            // Filter and sort by score descending
            const validResults = scoredResults.filter((r: any) => r.score >= 0);
            if (validResults.length === 0) return null;

            validResults.sort((a: any, b: any) => b.score - a.score);
            const item = validResults[0].item;

            let albumType: string | null = null;
            if (item.album?.record_type) {
                albumType = item.album.record_type.toLowerCase();
            } else if (item.album?.title && item.title) {
                // Heuristic: If album title matches track title exactly, it's likely a single branding
                if (item.album.title.toLowerCase() === item.title.toLowerCase()) {
                    albumType = 'single';
                } else {
                    albumType = 'album';
                }
            }

            return {
                id: String(item.id),
                albumId: item.album?.id ? String(item.album.id) : null,
                name: item.title ?? trackName,
                artist: item.artist?.name ?? artistName,
                album: item.album?.title ?? null,
                albumType: albumType,
                artworkUrl: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || null,
                url: item.link ? String(item.link) : `https://www.deezer.com/track/${item.id}`,
                previewUrl: item.preview ?? null,
                durationMs: (Number(item.duration) || 0) * 1000,
            };
        } catch (err: any) {
            console.error('Deezer searchTrack error:', err.message);
            return null;
        }
    }

    /** Get best ARTIST cover from Deezer */
    static async getArtistCover(artistName: string): Promise<string | null> {
        if (ArtistMetadataService.isDeezerDisabled(artistName)) return null;
        const cacheKey = `artist:${artistName.toLowerCase()}`;

        if (coverCache.has(cacheKey)) {
            return coverCache.get(cacheKey)!;
        }

        try {
            const { data } = await axios.get('https://api.deezer.com/search/artist', {
                params: {
                    q: artistName,
                    limit: 5,
                },
            });

            const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const target = clean(artistName);
            
            // Find the artist that perfectly matches or is the most popular
            const results = data.data || [];
            const artist = results.find((a: any) => this.validateArtist(artistName, a.name)) || results[0];
            
            if (artist && !this.validateArtist(artistName, artist.name)) {
                coverCache.set(cacheKey, null);
                return null;
            }

            const coverUrl = artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null;

            coverCache.set(cacheKey, coverUrl);
            return coverUrl;
        } catch (err: any) {
            console.error('Deezer artist error:', err.message);
            coverCache.set(cacheKey, null);
            return null;
        }
    }

    /** Get ALL tracks from an album with preview URLs */
    static async getAlbumTracks(albumId: string): Promise<{ name: string; previewUrl: string | null }[]> {
        try {
            const { data } = await axios.get(`https://api.deezer.com/album/${albumId}/tracks`, {
                params: { limit: 100 }
            });
            
            if (!data?.data?.length) return [];
            
            return data.data.map((t: any) => ({
                name: t.title || 'Unknown Track',
                previewUrl: t.preview || null
            }));
        } catch (err: any) {
            console.error('Deezer getAlbumTracks error:', err.message);
            return [];
        }
    }
}
