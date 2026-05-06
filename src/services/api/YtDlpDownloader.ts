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
        metadata: { name: string; artist: string; album: string; artworkUrl?: string }
    ): Promise<string> {
        const query = `${metadata.artist} - ${metadata.name}`;
        const searchQuery = `ytsearch1:${query} audio`;

        console.log(`📥 Searching YouTube: ${query}`);

        // Try to find ffmpeg in common locations or use PATH
        const ffmpegCandidates = [
            process.env.FFMPEG_PATH,
            'C:\\tools\\ffmpeg\\ffmpeg.exe',
            'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
            '/usr/bin/ffmpeg',
            '/usr/local/bin/ffmpeg',
            'ffmpeg'
        ];

        let resolvedFfmpeg = 'ffmpeg';
        for (const candidate of ffmpegCandidates) {
            if (candidate && (fs.existsSync(candidate) || candidate === 'ffmpeg')) {
                resolvedFfmpeg = candidate;
                if (candidate !== 'ffmpeg') break;
            }
        }

        const cmd = [
            'yt-dlp',
            `"${searchQuery}"`,
            '--extract-audio',
            '--audio-format mp3',
            '--audio-quality 0',
            '--no-playlist',
            '--no-warnings',
            '--quiet',
            '--no-progress',
            `--output "${outputPath}.%(ext)s"`,
            `--ffmpeg-location "${resolvedFfmpeg}"`
        ].join(' ');

        try {
            await execAsync(cmd, { timeout: 120_000 });
        } catch (err: any) {
            throw new Error(`yt-dlp failed: ${err.message}`);
        }

        const finalPath = `${outputPath}.mp3`;

        if (!fs.existsSync(finalPath)) {
            throw new Error(`Downloaded file not found at expected path: ${finalPath}`);
        }

        // Write ID3 tags
        const tags: any = {
            title: metadata.name,
            artist: metadata.artist,
            album: metadata.album
        };

        if (metadata.artworkUrl) {
            try {
                const art = await axios.get(metadata.artworkUrl, { responseType: 'arraybuffer' });
                tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3, name: 'front cover' },
                    description: 'Front Cover',
                    imageBuffer: Buffer.from(art.data)
                };
            } catch (_) {}
        }

        NodeID3.write(tags, finalPath);
        console.log(`✅ Downloaded: ${metadata.name}`);

        return finalPath;
    }
}
