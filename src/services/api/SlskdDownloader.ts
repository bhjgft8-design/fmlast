import axios from 'axios';
import fs from 'fs';
import path from 'path';
import NodeID3 from 'node-id3';
import { config } from '../../../config';

const SLSKD_URL = process.env.SLSKD_URL || 'http://localhost:5030';
const SLSKD_API_KEY = process.env.SLSKD_API_KEY || '';
const SLSKD_DOWNLOADS_DIR = process.env.SLSKD_DOWNLOADS_DIR || '/downloads';

const PREFERRED_FORMATS = ['.flac', '.mp3', '.ogg', '.m4a'];
const MAX_WAIT_MS = 120_000;   // 2 min total
const POLL_INTERVAL_MS = 2_000;

const api = axios.create({
    baseURL: `${SLSKD_URL}/api/v0`,
    headers: { 'X-API-Key': SLSKD_API_KEY }
});

interface SlskFile {
    filename: string;
    size: number;
    bitRate?: number;
    username: string;
}

export class SlskdDownloader {

    private static async search(query: string): Promise<SlskFile[]> {
        if (!SLSKD_API_KEY) {
            throw new Error('SLSKD_API_KEY is not set. Check your Railway environment variables.');
        }
        const { data: search } = await api.post('/searches', {
            searchText: query,
            fileLimit: 100,
            filterResponses: true
        });

        const searchId: string = search.id;
        console.log(`🔍 slskd search started: ${searchId}`);

        await this.sleep(6000);

        const { data: results } = await api.get(`/searches/${searchId}`);

        const files: SlskFile[] = [];
        for (const response of results.responses ?? []) {
            for (const file of response.files ?? []) {
                files.push({
                    filename: file.filename,
                    size: file.size,
                    bitRate: file.bitRate,
                    username: response.username
                });
            }
        }

        await api.delete(`/searches/${searchId}`).catch(() => {});

        return files;
    }

    private static pickBest(files: SlskFile[], artist: string, title: string): SlskFile | null {
        const scored = files
            .filter(f => {
                const ext = path.extname(f.filename).toLowerCase();
                return PREFERRED_FORMATS.includes(ext);
            })
            .map(f => {
                const name = f.filename.toLowerCase();
                const ext = path.extname(name);
                let score = 0;

                if (name.includes(artist.toLowerCase())) score += 10;
                if (name.includes(title.toLowerCase())) score += 10;

                if (ext === '.mp3' && (f.bitRate ?? 0) >= 320) score += 8;
                else if (ext === '.flac') score += 7;
                else if (ext === '.mp3' && (f.bitRate ?? 0) >= 192) score += 5;
                else if (ext === '.mp3') score += 3;

                if (f.size < 1_000_000) score -= 20;

                return { file: f, score };
            })
            .sort((a, b) => b.score - a.score);

        return scored[0]?.file ?? null;
    }

    private static async queueAndWait(file: SlskFile): Promise<{ username: string; filename: string }> {
        const encodedUsername = encodeURIComponent(file.username);

        await api.post(`/transfers/downloads/${encodedUsername}`, {
            files: [{ filename: file.filename }]
        });

        console.log(`⬇️  Queued: ${file.filename} from ${file.username}`);

        const deadline = Date.now() + MAX_WAIT_MS;

        while (Date.now() < deadline) {
            await this.sleep(POLL_INTERVAL_MS);

            const { data: transfers } = await api.get(
                `/transfers/downloads/${encodedUsername}`
            );

            const match = transfers
                ?.flatMap((d: any) => d.files ?? [])
                ?.find((f: any) => f.filename === file.filename);

            if (!match) continue;

            console.log(`📊 Status: ${match.state} | ${Math.round((match.bytesTransferred / match.size) * 100)}%`);

            if (match.state === 'Completed, Succeeded') {
                return { username: file.username, filename: file.filename };
            }

            if (match.state?.startsWith('Completed,') && match.state !== 'Completed, Succeeded') {
                throw new Error(`Download failed with state: ${match.state}`);
            }
        }

        throw new Error('Download timed out after 2 minutes.');
    }

    private static async findDownloadedFile(username: string, remoteFilename: string): Promise<string> {
        // slskd saves to: /downloads/{username}/{original_path_basename}
        const basename = path.basename(remoteFilename.replace(/\\/g, '/'));
        const userDir = path.join(SLSKD_DOWNLOADS_DIR, username);
        
        const found = this.findFileRecursive(userDir, basename);
        if (!found) {
            throw new Error(`Downloaded file not found in ${userDir}. Looking for: ${basename}`);
        }
        return found;
    }

    private static findFileRecursive(dir: string, filename: string): string | null {
        if (!fs.existsSync(dir)) return null;
        
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = this.findFileRecursive(fullPath, filename);
                if (found) return found;
            } else if (entry.name === filename) {
                return fullPath;
            }
        }
        return null;
    }

    static async downloadTrack(
        outputPath: string,
        metadata: { name: string; artist: string; album: string; artworkUrl?: string }
    ): Promise<string> {
        const query = `${metadata.artist} ${metadata.name}`;

        const files = await this.search(query);
        if (files.length === 0) throw new Error(`No results found on Soulseek for: ${query}`);

        const best = this.pickBest(files, metadata.artist, metadata.name);
        if (!best) throw new Error(`No suitable audio file found for: ${query}`);

        console.log(`✅ Best match: ${best.filename} (${best.bitRate ?? '?'}kbps)`);

        const { username, filename } = await this.queueAndWait(best);

        await this.sleep(1000); // let file flush to disk

        const slskdFilePath = await this.findDownloadedFile(username, filename);
        fs.copyFileSync(slskdFilePath, outputPath);

        const ext = path.extname(best.filename).toLowerCase();
        if (ext === '.mp3') {
            const tags: any = {
                title: metadata.name,
                artist: metadata.artist,
                album: metadata.album,
            };
            if (metadata.artworkUrl) {
                try {
                    const artData = await axios.get(metadata.artworkUrl, { responseType: 'arraybuffer' });
                    tags.image = {
                        mime: 'image/jpeg',
                        type: { id: 3, name: 'front cover' },
                        description: 'Front Cover',
                        imageBuffer: artData.data
                    };
                } catch (e) {}
            }
            NodeID3.write(tags, outputPath);
        }

        return outputPath;
    }

    private static sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
