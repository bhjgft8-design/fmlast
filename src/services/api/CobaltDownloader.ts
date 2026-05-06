import axios from 'axios';
import fs from 'fs';
import NodeID3 from 'node-id3';
import { config } from '../../../config';

export class CobaltDownloader {

    static async downloadTrack(
        outputPath: string,
        metadata: { name: string; artist: string; album: string; artworkUrl?: string; youtubeUrl: string }
    ): Promise<string> {
        if (!config.COBALT_URL) {
            throw new Error("COBALT_URL is not set in environment variables.");
        }

        console.log(`📥 Requesting Cobalt stream for: ${metadata.name}`);

        // 1. Get stream URL from Cobalt
        const { data: cobaltRes } = await axios.post(`${config.COBALT_URL}/api/json`, {
            url: metadata.youtubeUrl,
            downloadMode: 'audio',
            audioFormat: 'mp3',
            audioBitrate: '320'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (cobaltRes.status === 'error') {
            throw new Error(`Cobalt Error: ${cobaltRes.text}`);
        }

        const streamUrl = cobaltRes.url;
        if (!streamUrl) {
            throw new Error("Cobalt failed to return a stream URL.");
        }

        // 2. Download the binary
        const response = await axios.get(streamUrl, {
            responseType: 'arraybuffer',
            timeout: 60_000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        fs.writeFileSync(outputPath, Buffer.from(response.data));

        // 3. Write ID3 tags
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

        NodeID3.write(tags, outputPath);
        console.log(`✅ Downloaded and Tagged: ${metadata.name}`);

        return outputPath;
    }
}
