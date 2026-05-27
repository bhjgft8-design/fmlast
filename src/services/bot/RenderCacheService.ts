import { CacheService } from './CacheService';

export class RenderCacheService {
    /**
     * Get a cached CDN URL for a rendered template
     */
    static async getCachedImage(template: string, artist: string, track: string, username?: string, variant?: string): Promise<string | null> {
        const userPart = username ? `:${username.toLowerCase()}` : '';
        const variantPart = variant ? `:${variant.toLowerCase()}` : '';
        const key = `render:v7:${template}:${artist.toLowerCase()}:${track.toLowerCase()}${userPart}${variantPart}`;
        return CacheService.get<string>(key);
    }

    /**
     * Save a CDN URL to cache (default 24 hours)
     */
    static async setCachedImage(template: string, artist: string, track: string, url: string, username?: string, ttl: number = 86400, variant?: string): Promise<void> {
        const userPart = username ? `:${username.toLowerCase()}` : '';
        const variantPart = variant ? `:${variant.toLowerCase()}` : '';
        const key = `render:v7:${template}:${artist.toLowerCase()}:${track.toLowerCase()}${userPart}${variantPart}`;
        await CacheService.set(key, url, ttl);
    }
}
