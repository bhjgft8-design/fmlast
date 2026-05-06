import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';

export class UploaderService {

    static async uploadToGoFile(filePath: string): Promise<string> {
        try {
            // 1. Get best server
            const { data: serverData } = await axios.get('https://api.gofile.io/servers');
            if (serverData.status !== 'ok') throw new Error('GoFile: Could not get server.');
            
            const server = serverData.data.servers[0].name;

            // 2. Upload file
            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath), {
                filename: path.basename(filePath)
            });

            const { data: uploadData } = await axios.post(
                `https://${server}.gofile.io/contents/uploadfile`,
                formData,
                {
                    headers: { ...formData.getHeaders() },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 120_000
                }
            );

            if (uploadData.status !== 'ok') throw new Error(`GoFile: Upload failed: ${JSON.stringify(uploadData)}`);

            return uploadData.data.downloadPage;
        } catch (err: any) {
            console.error('❌ UploaderService error:', err.message);
            throw err;
        }
    }
}
