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

        // Ensure URL doesn't have a trailing slash so we can add it safely
        const baseUrl = config.COBALT_URL.endsWith('/') ? config.COBALT_URL : `${config.COBALT_URL}/`;

        console.log(`📥 Requesting Cobalt v10 stream for: ${metadata.name}`);

        // 1. Get stream URL from Cobalt (v10 uses root POST /)
        const { data: cobaltRes } = await axios.post(baseUrl, {
            url: metadata.youtubeUrl,
            videoQuality: '1080',
            audioFormat: 'mp3',
            downloadMode: 'audio',
            filenameStyle: 'basic'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        // Cobalt v10 error handling
        if (cobaltRes.status === 'error' || cobaltRes.status === 'rate-limit') {
            throw new Error(`Cobalt Error: ${cobaltRes.text || 'Unknown Error'}`);
        }

        const streamUrl = cobaltRes.url;
        if (!streamUrl) {
            throw new Error(`Cobalt failed to return a stream URL. Status: ${cobaltRes.status}`);
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
        console.log(`✅ Finalized via Cobalt: ${metadata.name}`);

        return outputPath;
    }
}
