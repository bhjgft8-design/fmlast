export class AsyncLock {
    private locks = new Map<string, Promise<void>>();

    async acquire(key: string): Promise<() => void> {
        const existing = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const next = new Promise<void>(resolve => { release = resolve; });
        this.locks.set(key, existing.then(() => next));
        await existing;
        return () => {
            release();
            if (this.locks.get(key) === next) this.locks.delete(key);
        };
    }
}

export const playbackLock = new AsyncLock();
