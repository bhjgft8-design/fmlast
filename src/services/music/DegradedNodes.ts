export const degradedNodes = new Map<string, number>(); // nodeName -> timestamp of failure

export const nodeStats = new Map<string, { hits: number; misses: number; avgMs: number }>();

export function recordNodeResult(name: string, success: boolean, ms: number): void {
    const s = nodeStats.get(name) || { hits: 0, misses: 0, avgMs: 0 };
    if (success) s.hits++;
    else s.misses++;
    s.avgMs = (s.avgMs * (s.hits + s.misses - 1) + ms) / (s.hits + s.misses);
    nodeStats.set(name, s);
}

export function sortNodesByQuality(shoukakuNodes: any): any[] {
    const now = Date.now();
    const allNodes = Array.from(shoukakuNodes.values() as Iterable<any>)
        .filter((node: any) => node && node.state === 1);
        
    return allNodes.sort((a: any, b: any) => {
        const aDegraded = degradedNodes.has(a.name) && (now - degradedNodes.get(a.name)! < 300000); // 5 minutes
        const bDegraded = degradedNodes.has(b.name) && (now - degradedNodes.get(b.name)! < 300000);
        
        if (aDegraded && !bDegraded) return 1;
        if (!aDegraded && bDegraded) return -1;
        
        const sa = nodeStats.get(a.name) || { hits: 1, misses: 0, avgMs: 999 };
        const sb = nodeStats.get(b.name) || { hits: 1, misses: 0, avgMs: 999 };
        
        const scoreA = (sa.misses / (sa.hits + sa.misses)) + sa.avgMs / 10000 + (a.penalties || 0) / 1000;
        const scoreB = (sb.misses / (sb.hits + sb.misses)) + sb.avgMs / 10000 + (b.penalties || 0) / 1000;
        
        return scoreA - scoreB;
    }) as any[];
}
