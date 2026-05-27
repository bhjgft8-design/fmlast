import chalk from 'chalk';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4
}

const ICONS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '○',
    [LogLevel.INFO]:  '●',
    [LogLevel.WARN]:  '▲',
    [LogLevel.ERROR]: '✖',
    [LogLevel.FATAL]: '☠',
};

export class LoggerService {
    private static currentLevel: LogLevel = LogLevel.INFO;

    static setLevel(level: LogLevel) {
        this.currentLevel = level;
    }

    private static timestamp(): string {
        return chalk.dim(new Date().toISOString().replace('T', ' ').replace('Z', ''));
    }

    private static format(level: LogLevel, message: string, context?: string): string {
        const ts = this.timestamp();
        const icon = ICONS[level];
        const ctx = context ? chalk.cyan(`[${context}]`) + ' ' : '';

        switch (level) {
            case LogLevel.DEBUG:
                return `${ts}  ${chalk.gray(icon)} ${chalk.gray('DEBUG')}  ${ctx}${chalk.gray(message)}`;
            case LogLevel.INFO:
                return `${ts}  ${chalk.blue(icon)} ${chalk.blue('INFO ')}  ${ctx}${message}`;
            case LogLevel.WARN:
                return `${ts}  ${chalk.yellow(icon)} ${chalk.yellow('WARN ')}  ${ctx}${chalk.yellow(message)}`;
            case LogLevel.ERROR:
                return `${ts}  ${chalk.red(icon)} ${chalk.red('ERROR')}  ${ctx}${chalk.red(message)}`;
            case LogLevel.FATAL:
                return `${ts}  ${chalk.bgRed.white(icon)} ${chalk.bgRed.white('FATAL')}  ${ctx}${chalk.bgRed.white(message)}`;
            default:
                return `${ts}  ${icon}  ${ctx}${message}`;
        }
    }

    static debug(message: string, context?: string) {
        if (this.currentLevel <= LogLevel.DEBUG) console.log(this.format(LogLevel.DEBUG, message, context));
    }

    static info(message: string, context?: string) {
        if (this.currentLevel <= LogLevel.INFO) console.log(this.format(LogLevel.INFO, message, context));
    }

    static warn(message: string, context?: string) {
        if (this.currentLevel <= LogLevel.WARN) console.warn(this.format(LogLevel.WARN, message, context));
    }

    static error(message: string, error?: any, context?: string) {
        if (this.currentLevel <= LogLevel.ERROR) {
            console.error(this.format(LogLevel.ERROR, message, context));
            if (error) console.error(chalk.dim(error?.stack || error));
        }
    }

    static fatal(message: string, error?: any, context?: string) {
        if (this.currentLevel <= LogLevel.FATAL) {
            console.error(this.format(LogLevel.FATAL, message, context));
            if (error) console.error(chalk.dim(error?.stack || error));
            process.exit(1);
        }
    }

    // ── Startup Banner ──────────────────────────────────────────────
    static banner(tag: string, commandCount: number) {
        const line = chalk.dim('─'.repeat(50));
        console.log('');
        console.log(line);
        console.log(`  ${chalk.bold.green('✦ her')}  ${chalk.dim('|')}  ${chalk.white(tag)}`);
        console.log(`  ${chalk.dim('Commands:')}  ${chalk.cyan(commandCount.toString().padStart(3))}  ${chalk.dim('|')}  ${chalk.dim('UTR Engine: Active')}`);
        console.log(line);
        console.log('');
    }

    // ── UTR-specific helpers ─────────────────────────────────────────
    static utrFetch(query: string) {
        console.log(`  ${chalk.magenta('↯')} ${chalk.dim('UTR')}  ${chalk.bold('Resolve')}  ${chalk.white(query)}`);
    }

    static utrCacheHit(query: string) {
        console.log(`  ${chalk.green('⚡')} ${chalk.dim('UTR')}  ${chalk.green('Cache')}    ${chalk.dim(query)}`);
    }

    static utrAlbumHit(artist: string, album: string) {
        console.log(`  ${chalk.blue('🖼')} ${chalk.dim('UTR')}  ${chalk.blue('Album↑')}   ${chalk.dim(`${artist} — ${album}`)}`);
    }

    static utrResult(source: string, artist: string, track: string) {
        const sourceColor = source === 'Spotify' ? chalk.green(source) : source === 'Apple Music' ? chalk.red(source) : chalk.yellow(source);
        console.log(`  ${chalk.green('✓')} ${chalk.dim('UTR')}  ${sourceColor.padEnd(14)}  ${chalk.white(artist)} ${chalk.dim('—')} ${chalk.white(track)}`);
    }

    static utrTiming(query: string, timings: Record<string, number>) {
        const parts = Object.entries(timings)
            .map(([name, ms]) => ms < 0 ? `${name}:skip` : `${name}:${ms.toFixed(ms < 10 ? 2 : 0)}ms`)
            .join(' ');
        console.log(`  ${chalk.cyan('timer')} ${chalk.dim('UTR')}  ${chalk.dim(query)}  ${chalk.gray(parts)}`);
    }

    static utrScoredResult(source: string, score: number, artist: string, track: string, album?: string | null) {
        const sourceColor = source === 'Spotify' ? chalk.green(source) : source === 'Apple Music' ? chalk.red(source) : chalk.yellow(source);
        const albumPart = album ? ` ${chalk.dim('on')} ${chalk.gray(album)}` : '';
        console.log(`  ${chalk.green('score')} ${chalk.dim('UTR')}  ${sourceColor} ${chalk.dim(`(${score})`)}  ${chalk.white(artist)} ${chalk.dim('-')} ${chalk.white(track)}${albumPart}`);
    }
}
