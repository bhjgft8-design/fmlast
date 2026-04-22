export function parseArgs(args: string[]) {
    const map: Record<string, string> = {};
    const unnamed: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith('--')) {
            const eqIndex = arg.indexOf('=');
            if (eqIndex !== -1) {
                const key = arg.slice(2, eqIndex);
                const value = arg.slice(eqIndex + 1);
                map[key] = value;
            } else {
                const key = arg.slice(2);
                if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                    map[key] = args[i + 1];
                    i++; // Skip the next arg since it was consumed as a value
                } else {
                    map[key] = "true";
                }
            }
        } else if (arg.startsWith('-')) {
            // Handle single dash as flag
            const eqIndex = arg.indexOf('=');
            if (eqIndex !== -1) {
                const key = arg.slice(1, eqIndex);
                const value = arg.slice(eqIndex + 1);
                map[key] = value;
            } else {
                const key = arg.slice(1);
                if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    map[key] = args[i + 1];
                    i++; // Skip the next arg since it was consumed as a value
                } else {
                    map[key] = "true";
                }
            }
        } else {
            unnamed.push(arg);
        }
    }

    return { map, unnamed };
}
