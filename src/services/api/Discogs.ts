import axios from 'axios';
import { config } from '../../../config';

export interface DiscogsRelease {
    id: number;
    title: string;
    year?: number;
    thumb?: string;
    cover_image?: string;
    master_id?: number;
    master_url?: string;
    uri?: string;
    format?: string[];
    label?: string[];
    genre?: string[];
    style?: string[];
    community?: {
        want: number;
        have: number;
    };
}

export class Discogs {
    private static readonly BASE_URL = 'https://api.discogs.com';
    private static readonly USER_AGENT = 'FMBot/1.0 +https://discord.com';

    private static get headers() {
        const h: any = {
            'User-Agent': this.USER_AGENT
        };
        
        if (config.DISCOGS_KEY && config.DISCOGS_SECRET) {
            h['Authorization'] = `Discogs key=${config.DISCOGS_KEY}, secret=${config.DISCOGS_SECRET}`;
        } else if (config.DISCOGS_TOKEN) {
            h['Authorization'] = `Discogs token=${config.DISCOGS_TOKEN}`;
        }
        
        return h;
    }

    /**
     * Search for a master release on Discogs
     */
    static async searchRelease(query: string): Promise<DiscogsRelease | null> {
        try {
            const url = `${this.BASE_URL}/database/search`;
            const params = {
                q: query,
                type: 'master', // Focus on master releases
                per_page: 1
            };

            const res = await axios.get(url, { headers: this.headers, params });
            if (res.data.results && res.data.results.length > 0) {
                const item = res.data.results[0];
                return {
                    id: item.id,
                    title: item.title,
                    year: item.year ? parseInt(item.year, 10) : undefined,
                    thumb: item.thumb,
                    cover_image: item.cover_image,
                    master_id: item.master_id,
                    master_url: item.master_url,
                    uri: item.uri,
                    format: item.format,
                    label: item.label,
                    genre: item.genre,
                    style: item.style,
                    community: item.community
                };
            }
            return null;
        } catch (err: any) {
            console.error('[Discogs] searchRelease error:', err.message);
            return null;
        }
    }

    /**
     * Verify if a Discogs user exists
     */
    static async verifyUser(username: string): Promise<boolean> {
        try {
            await axios.get(`${this.BASE_URL}/users/${username}`, { headers: this.headers });
            return true;
        } catch (err: any) {
            return false;
        }
    }

    /**
     * Get a user's collection (folder 0 is "All")
     */
    static async getCollection(username: string, page = 1, perPage = 10): Promise<{ items: any[], pagination: any }> {
        try {
            const res = await axios.get(`${this.BASE_URL}/users/${username}/collection/folders/0/releases`, {
                headers: this.headers,
                params: {
                    page,
                    per_page: perPage,
                    sort: 'added',
                    sort_order: 'desc'
                }
            });
            return {
                items: res.data.releases || [],
                pagination: res.data.pagination
            };
        } catch (err: any) {
            console.error('[Discogs] getCollection error:', err.message);
            return { items: [], pagination: {} };
        }
    }

    /**
     * Get a user's wantlist
     */
    static async getWantlist(username: string, page = 1, perPage = 10): Promise<{ items: any[], pagination: any }> {
        try {
            const res = await axios.get(`${this.BASE_URL}/users/${username}/wants`, {
                headers: this.headers,
                params: {
                    page,
                    per_page: perPage,
                    sort: 'added',
                    sort_order: 'desc'
                }
            });
            return {
                items: res.data.wants || [],
                pagination: res.data.pagination
            };
        } catch (err: any) {
            console.error('[Discogs] getWantlist error:', err.message);
            return { items: [], pagination: {} };
        }
    }
}
