import { shoukaku } from '../../index';
import YouTubeSR from 'youtube-sr';
import { formatDuration } from '../../utils/formatDuration';
import { Readable } from 'node:stream';
import { degradedNodes, sortNodesByQuality } from '../music/DegradedNodes';

export interface YoutubeResult {
    title: string;
    url: string;
    id: string;
    thumbnail: string;
    channelTitle: string;
    duration?: string;
    durationSeconds?: number;
    views?: string;
    publishedAt?: string;
    artistName?: string;
    trackTitle?: string;
    artworkUrl?: string;     // For UI rendering
    statsText?: string;      // For UI rendering
    requesterName?: string;  // For UI rendering
    requesterId?: string;    // For user history
    _fallbackAttempts?: number;
}

export interface AudioStreamResult {
    stream: Readable;
}

export class Youtube {
    /**
     * Search for a music video based on artist and track names.
     */
    static async searchMusicVideo(artist: string, track: string): Promise<YoutubeResult | null> {
        const query = `${artist} - ${track} (Official Music Video)`;
        return this.search(query);
    }

    /**
     * General YouTube search.
     */
    static async search(query: string, isMusic = true): Promise<YoutubeResult | null> {
        const isUrl = /^https?:\/\//.test(query);
        if (isUrl) {
            const results = await this.searchByQuery(query);
            return results[0] ?? null;
        }

        const isArabic = /[\u0600-\u06FF]/.test(query);
        const hasSpecificVersion = /\b(remix|cover|live|slowed|reverb|acoustic|version|edit|mashup|mix|remake|instrumental|karaoke|sped\s+up|speed\s+up|official|audio|video|music)\b/i.test(query);
        const searchQuery = (isMusic && !isArabic && !hasSpecificVersion) ? `${query} (Official Audio)` : query;
        const results = await this.searchByQuery(searchQuery);
        return results[0] ?? null;
    }

    private static parseISO8601Duration(durationStr: string): number {
        const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
        const matches = durationStr.match(regex);
        if (!matches) return 0;
        const hours = parseInt(matches[1] || '0', 10);
        const minutes = parseInt(matches[2] || '0', 10);
        const seconds = parseInt(matches[3] || '0', 10);
        return hours * 3600 + minutes * 60 + seconds;
    }

    private static async searchViaGoogleApi(query: string): Promise<YoutubeResult[]> {
        const key = process.env.YOUTUBE_API_KEY;
        if (!key) return [];

        try {
            const axios = (await import('axios')).default;
            const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: {
                    part: 'snippet',
                    q: query,
                    maxResults: 5,
                    type: 'video',
                    key: key
                },
                timeout: 3000
            });

            if (!data.items || data.items.length === 0) return [];

            const videoIds = data.items.map((item: any) => item.id.videoId).join(',');
            const durationMap = new Map<string, { duration: string; durationSeconds: number }>();

            try {
                const { data: videoDetails } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                    params: {
                        part: 'contentDetails',
                        id: videoIds,
                        key: key
                    },
                    timeout: 3000
                });

                if (videoDetails && videoDetails.items) {
                    for (const item of videoDetails.items) {
                        const isoDuration = item.contentDetails?.duration || '';
                        const secs = this.parseISO8601Duration(isoDuration);
                        durationMap.set(item.id, {
                            duration: this.formatDuration(secs),
                            durationSeconds: secs
                        });
                    }
                }
            } catch (err: any) {
                console.warn(`[Youtube API] Videos details fetch failed:`, err.message);
            }

            return data.items.map((item: any) => {
                const details = durationMap.get(item.id.videoId) || { duration: '0:00', durationSeconds: 0 };
                return {
                    title: item.snippet.title,
                    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                    id: item.id.videoId,
                    thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || `https://img.youtube.com/vi/${item.id.videoId}/hqdefault.jpg`,
                    channelTitle: item.snippet.channelTitle,
                    duration: details.duration,
                    durationSeconds: details.durationSeconds
                };
            });
        } catch (err: any) {
            console.warn(`[Youtube API] Search failed:`, err.message);
            return [];
        }
    }

    public static async searchByQuery(query: string): Promise<YoutubeResult[]> {
        const isUrl = /^https?:\/\//.test(query);

        // 1. Try the official Google YouTube API first if it is a text search query!
        if (!isUrl && process.env.YOUTUBE_API_KEY) {
            const apiResults = await this.searchViaGoogleApi(query);
            if (apiResults.length > 0) {
                return apiResults;
            }
        }

        // 2. Fall back to Lavalink resolve
        const nodes = sortNodesByQuality(shoukaku.nodes);
        
        // Helper for timeout
        const withTimeout = (promise: Promise<any>, ms: number) => {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
            ]);
        };

        const resolveQuery = isUrl ? query : `ytsearch:${query}`;

        for (const node of nodes) {
            try {
                // Reduced timeout to 2500ms to failover quickly from sluggish nodes
                const res = await withTimeout(node.rest.resolve(resolveQuery), 2500) as any;
                if (!res || !res.data || res.loadType === 'error' || res.loadType === 'empty') continue;

                const tracks = Array.isArray(res.data) ? res.data : [res.data];
                return tracks.map((track: any) => ({
                    title: track.info.title,
                    url: track.info.uri,
                    id: track.info.identifier,
                    thumbnail: `https://img.youtube.com/vi/${track.info.identifier}/hqdefault.jpg`,
                    channelTitle: track.info.author,
                    duration: this.formatDuration(track.info.length / 1000),
                    durationSeconds: Math.floor(track.info.length / 1000),
                }));
            } catch (error) {
                console.warn(`[Youtube] Search failed/timed out on node ${node.name}: ${error instanceof Error ? error.message : String(error)}`);
                degradedNodes.set(node.name, Date.now());
            }
        }

        // Final fallback to youtube-sr with extra safety and timeout
        try {
            const results = await withTimeout(YouTubeSR.search(query, {
                limit: 5,
                type: 'video',
            }), 8000) as any[];

            if (!results || !Array.isArray(results)) return [];

            return results.map((video) => ({
                title: video.title ?? 'Unknown Title',
                url: video.url,
                id: video.id ?? '',
                thumbnail: video.thumbnail?.url ?? '',
                channelTitle: video.channel?.name ?? 'Unknown Channel',
                duration: video.durationFormatted,
                durationSeconds: Math.floor((video.duration ?? 0) / 1000),
            }));
        } catch (srError) {
            console.error(`[Youtube] All search methods failed or timed out:`, srError instanceof Error ? srError.message : srError);
            return [];
        }
    }

    static async getPlaylistInfo(url: string): Promise<{ title: string; songs: YoutubeResult[] }> {
        try {
            const node = shoukaku.options.nodeResolver(shoukaku.nodes);
            if (!node) throw new Error('No nodes available');

            const res = await node.rest.resolve(url);
            
            if (!res || res.loadType !== 'playlist') {
                throw new Error('Not a playlist or failed to load');
            }

            const playlistData = res.data as any;
            
            const songs: YoutubeResult[] = playlistData.tracks.map((track: any) => ({
                title: track.info.title,
                url: track.info.uri,
                id: track.info.identifier,
                thumbnail: `https://img.youtube.com/vi/${track.info.identifier}/hqdefault.jpg`,
                channelTitle: track.info.author,
                durationSeconds: Math.floor(track.info.length / 1000),
                duration: this.formatDuration(track.info.length / 1000),
            }));

            return { 
                title: playlistData.info.name || 'Unknown Playlist', 
                songs 
            };
        } catch (error) {
            console.error('[Youtube] Lavalink playlist failed:', error);
            throw error;
        }
    }

    private static formatDuration(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
    }
}
