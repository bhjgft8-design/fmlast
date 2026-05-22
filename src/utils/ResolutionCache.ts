import { CacheService } from '../services/bot/CacheService';

interface CacheEntry {
    encoded: string;
    expiresAt: number;
}

export class ResolutionCache {
    private static cache = new Map<string, CacheEntry>();
    private static TTL = 30 * 60 * 1000; // 30 minutes L1 in-memory TTL
    private static REDIS_TTL = 7 * 24 * 3600; // 7 days L2 Redis TTL
    private static MAX = 200;

    static async get(key: string): Promise<string | null> {
        // 1. L1 In-Memory Cache Check
        const entry = this.cache.get(key);
        if (entry && Date.now() <= entry.expiresAt) {
            return entry.encoded;
        }
        if (entry) {
            this.cache.delete(key);
        }

        // 2. L2 Redis Cache Check
        const redisKey = `resolution:${Buffer.from(key).toString('base64')}`;
        try {
            const cached = await CacheService.get<string>(redisKey);
            if (cached) {
                // Populate L1 cache for subsequent fast hits
                this.setInMemory(key, cached);
                return cached;
            }
        } catch (err) {
            console.warn('[ResolutionCache] Redis read failed:', err);
        }

        return null;
    }

    private static setInMemory(key: string, encoded: string): void {
        if (this.cache.size >= this.MAX) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, { encoded, expiresAt: Date.now() + this.TTL });
    }

    static async set(key: string, encoded: string): Promise<void> {
        // Set L1
        this.setInMemory(key, encoded);

        // Set L2 (Redis)
        const redisKey = `resolution:${Buffer.from(key).toString('base64')}`;
        try {
            await CacheService.set(redisKey, encoded, this.REDIS_TTL);
        } catch (err) {
            console.warn('[ResolutionCache] Redis write failed:', err);
        }
    }
}
