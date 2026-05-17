interface NodeBreaker {
    failures: number;
    openUntil: number;
}

const breakers = new Map<string, NodeBreaker>();
const THRESHOLD = 3;
const BACKOFF_MS = 5 * 60 * 1000;

export function recordSuccess(nodeName: string): void {
    breakers.delete(nodeName);
}

export function recordFailure(nodeName: string): void {
    const b = breakers.get(nodeName) ?? { failures: 0, openUntil: 0 };
    b.failures++;
    if (b.failures >= THRESHOLD) {
        b.openUntil = Date.now() + BACKOFF_MS;
        console.warn(`[CircuitBreaker] 🚨 Node ${nodeName} tripped — backing off 5 min`);
    }
    breakers.set(nodeName, b);
}

export function isAvailable(nodeName: string): boolean {
    const b = breakers.get(nodeName);
    if (!b) return true;
    if (Date.now() > b.openUntil) {
        breakers.delete(nodeName);
        return true;
    }
    return b.failures < THRESHOLD;
}
