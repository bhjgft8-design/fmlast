import { CacheService } from './CacheService';
import { LoggerService } from './LoggerService';

export class RateLimitService {
    /**
     * Check if a user is exceeding their rate limit for a specific command/action.
     * @param identifier Unique ID (discordId, guildId, or IP)
     * @param action Action name (e.g., 'command_cover')
     * @param limit Max requests allowed in the window
     * @param windowSeconds Time window in seconds
     * @returns boolean True if allowed, False if rate-limited
     */
    static async isAllowed(identifier: string, action: string, limit: number, windowSeconds: number): Promise<boolean> {
        const key = `ratelimit:${action}:${identifier}`;
        
        try {
            const current = await CacheService.get<number>(key) || 0;
            
            if (current >= limit) {
                LoggerService.warn(`Rate limit hit for ${identifier} on ${action}`, 'RateLimit');
                return false;
            }

            // Increment and set TTL if new
            await CacheService.set(key, current + 1, windowSeconds);
            return true;
        } catch (err) {
            // If Redis fails, fail-open (allow the request) but log
            LoggerService.error(`RateLimit Check Failed [${key}]`, err, 'RateLimit');
            return true;
        }
    }

    /**
     * Helper for standard command rate limiting (e.g. 5 commands every 10 seconds)
     */
    static async checkCommand(discordId: string): Promise<boolean> {
        return this.isAllowed(discordId, 'global_cmd', 5, 10);
    }
}
