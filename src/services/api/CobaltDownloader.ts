import axios from 'axios';
import fs from 'fs';
import NodeID3 from 'node-id3';

export class CobaltDownloader {

    static async downloadTrack(
        outputPath: string,
        metadata: { name: string; artist: string; album: string; artworkUrl?: string; spotifyUrl: string }
    ): Promise<string> {
        const apiKey = process.env.RAPIDAPI_KEY;
        if (!apiKey) {
            throw new Error("RAPIDAPI_KEY is missing. Add it to your environment variables.");
        }

        console.log(`📥 Spotify Engine: Processing ${metadata.name}`);

        // 1. Use Spotify Downloader API
        const options = {
            method: 'GET',
            url: 'https://spotify-downloader9.p.rapidapi.com/downloadSong',
            params: { songId: metadata.spotifyUrl },
            headers: {
                'x-rapidapi-key': apiKey,
                'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
            }
        };

        let apiRes: any;
        try {
            const response = await axios.request(options);
            apiRes = response.data;
        } catch (err: any) {
            if (err.response) {
                console.error('❌ RapidAPI Error Details:', JSON.stringify(err.response.data, null, 2));
                throw new Error(`RapidAPI 403: ${err.response.data.message || 'Forbidden. Ensure you are subscribed.'}`);
            }
            throw err;
        }
        
        const downloadLink = apiRes.data?.downloadLink || apiRes.link || apiRes.data?.url;

        if (!downloadLink) {
            console.log('📡 Full API Response (Debug):', JSON.stringify(apiRes, null, 2));
            throw new Error(`API Error: No download link in response. Status: ${apiRes.success}`);
        }

        console.log(`✅ API resolved link. Downloading binary...`);

        // 2. Download via axios (Standard binary download)
        try {
            const response = await axios.get(downloadLink, {
                responseType: 'arraybuffer',
                timeout: 300_000, // 5 minutes
                maxRedirects: 10,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            fs.writeFileSync(outputPath, Buffer.from(response.data));
        } catch (err: any) {
            throw new Error(`Binary download failed: ${err.message}`);
        }

        if (!fs.existsSync(outputPath)) throw new Error("Download failed: File not created.");

        const stats = fs.statSync(outputPath);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`📦 Final Size: ${sizeMb} MB`);

        if (stats.size < 500000) {
            throw new Error(`Download failed. File size is too small (${sizeMb} MB).`);
        }

        // 3. Tags
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
        console.log(`✅ Success: ${metadata.name}`);

        return outputPath;
    }
}
