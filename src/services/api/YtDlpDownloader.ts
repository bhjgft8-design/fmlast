import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import NodeID3 from 'node-id3';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export class YtDlpDownloader {

    static async downloadTrack(
        outputPath: string,
        metadata: { name: string; artist: string; album: string; artworkUrl?: string; durationMs?: number }
    ): Promise<string> {
        const query = `${metadata.artist} - ${metadata.name}`;
        
        // 1. YouTube Music (Best quality/metadata)
        // 2. YouTube Search
        // 3. SoundCloud (with strict filters)
        const searchStrategies = [
            { name: 'YouTube Music', query: `ytsearch1:${query} official audio`, extractor: 'youtube' },
            { name: 'YouTube', query: `ytsearch1:${query} audio`, extractor: 'youtube' },
            { name: 'SoundCloud', query: `scsearch5:${query}`, extractor: 'soundcloud' }
        ];

        const ffmpegCandidates = [
            process.env.FFMPEG_PATH,
            'C:\\tools\\ffmpeg\\ffmpeg.exe',
            '/usr/bin/ffmpeg',
            'ffmpeg'
        ];

        let resolvedFfmpeg = 'ffmpeg';
        for (const candidate of ffmpegCandidates) {
            if (candidate && (fs.existsSync(candidate) || candidate === 'ffmpeg')) {
                resolvedFfmpeg = candidate;
                if (candidate !== 'ffmpeg') break;
            }
        }

        const cookiesPath = path.join(process.cwd(), 'cookies.txt');
        const hasCookies = fs.existsSync(cookiesPath);

        let lastError = null;

        for (const strategy of searchStrategies) {
            console.log(`📥 Searching (${strategy.name}): ${query}`);

            const filterParts = [];
            
            // Advanced Filters for SoundCloud/Search
            if (strategy.extractor === 'soundcloud' || strategy.name === 'YouTube') {
                // Reject remixes if original isn't one
                const originalIsRemix = metadata.name.toLowerCase().includes('remix');
                if (!originalIsRemix) {
                    filterParts.push('title !~* "(remix|edit|bootleg|mashup|cover|tribute)"');
                }

                // Duration filter (within 20 seconds of original)
                if (metadata.durationMs) {
                    const durSec = Math.floor(metadata.durationMs / 1000);
                    filterParts.push(`duration > ${durSec - 20} & duration < ${durSec + 20}`);
                }
            }

            const matchFilter = filterParts.length > 0 ? `--match-filter "${filterParts.join(' & ')}"` : '';

            const cmd = [
                'yt-dlp',
                `"${strategy.query}"`,
                '--format "bestaudio/best"',
                '--extract-audio',
                '--audio-format mp3',
                '--no-playlist',
                '--no-warnings',
                '--quiet',
                '--no-progress',
                '--add-header "Referer:https://www.google.com/"',
                hasCookies ? `--cookies "${cookiesPath}"` : '',
                matchFilter,
                `--output "${outputPath}.%(ext)s"`,
                `--ffmpeg-location "${resolvedFfmpeg}"`
            ].join(' ');

            try {
                await execAsync(cmd, { timeout: 120_000 });
                const finalPath = `${outputPath}.mp3`;
                if (fs.existsSync(finalPath)) {
                    await this.writeTags(finalPath, metadata);
                    return finalPath;
                }
            } catch (err: any) {
                lastError = err;
                console.warn(`⚠️ ${strategy.name} attempt failed: ${err.message.split('\n')[0]}`);
                continue;
            }
        }

        throw new Error(`Download failed after all strategies: ${lastError?.message}`);
    }

    private static async writeTags(filePath: string, metadata: any) {
        const tags: any = {
            title: metadata.name,
            artist: metadata.artist,
            album: metadata.album
        };

        if (metadata.artworkUrl) {
            try {
                const art = await axios.get(metadata.artworkUrl, { responseType: 'arraybuffer', timeout: 10000 });
                tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3, name: 'front cover' },
                    description: 'Front Cover',
                    imageBuffer: Buffer.from(art.data)
                };
            } catch (_) {}
        }

        NodeID3.write(tags, filePath);
        console.log(`✅ Finalized: ${metadata.name}`);
    }
}
