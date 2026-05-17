interface CacheEntry {
    encoded: string;
    expiresAt: number;
}

export class ResolutionCache {
    private static cache = new Map<string, CacheEntry>();
    private static TTL = 30 * 60 * 1000; // 30 minutes
    private static MAX = 200;

    static get(key: string): string | null {
        const entry = this.cache.get(key);
        if (!entry || Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.encoded;
    }

    static set(key: string, encoded: string): void {
        if (this.cache.size >= this.MAX) {
            // Evict oldest (FIFO)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, { encoded, expiresAt: Date.now() + this.TTL });
    }
}
