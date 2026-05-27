type ProviderName = 'spotify' | 'apple' | 'deezer' | 'youtube' | 'lastfm';

interface ProviderBreaker {
    failures: number;
    openUntil: number;
}

const breakers = new Map<ProviderName, ProviderBreaker>();
const THRESHOLD = 3;
const BASE_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class ProviderCircuitBreaker {
    static isAvailable(provider: ProviderName): boolean {
        const breaker = breakers.get(provider);
        if (!breaker) return true;

        if (Date.now() >= breaker.openUntil) {
            breakers.delete(provider);
            return true;
        }

        return false;
    }

    static recordSuccess(provider: ProviderName): void {
        breakers.delete(provider);
    }

    static recordFailure(provider: ProviderName): void {
        const breaker = breakers.get(provider) ?? { failures: 0, openUntil: 0 };
        breaker.failures++;

        if (breaker.failures >= THRESHOLD) {
            const backoff = Math.min(BASE_BACKOFF_MS * (breaker.failures - THRESHOLD + 1), MAX_BACKOFF_MS);
            breaker.openUntil = Date.now() + backoff;
            console.warn(`[ProviderCircuit] ${provider} tripped; backing off ${Math.round(backoff / 1000)}s`);
        }

        breakers.set(provider, breaker);
    }

    static getRemainingMs(provider: ProviderName): number {
        const breaker = breakers.get(provider);
        if (!breaker) return 0;
        return Math.max(0, breaker.openUntil - Date.now());
    }
}
