import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Resolve ffmpeg path — ffmpeg-static exports a string, ffprobe-static exports { path }
const localFfmpeg = ['C:\\tools\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\tools\\ffmpeg\\ffmpeg.exe'].find(p => fs.existsSync(p));
const localFfprobe = ['C:\\tools\\ffmpeg\\bin\\ffprobe.exe', 'C:\\tools\\ffmpeg\\ffprobe.exe'].find(p => fs.existsSync(p));

const resolvedFfmpegPath: string | null = localFfmpeg
  ?? (typeof ffmpegStatic === 'string' ? ffmpegStatic : (ffmpegStatic as any)?.path ?? null);
const resolvedFfprobePath: string | null = localFfprobe
  ?? ((ffprobeStatic as any)?.path ?? (typeof ffprobeStatic === 'string' ? ffprobeStatic : null));

if (resolvedFfmpegPath) ffmpeg.setFfmpegPath(resolvedFfmpegPath);
if (resolvedFfprobePath) ffmpeg.setFfprobePath(resolvedFfprobePath);

/**
 * Extracts a 15-second snippet of audio from a video/audio file.
 * Returns the path to the temporary processed file.
 */
export async function extractPreview(inputPath: string, uniqueId: string): Promise<string> {
    const outputPath = path.join(os.tmpdir(), `shazam_${uniqueId}.raw`);

    return new Promise((resolve, reject) => {
        (ffmpeg as any)(inputPath)
            .setStartTime(0)
            .setDuration(4) // 4 seconds of raw PCM is usually plenty for Shazam
            .audioChannels(1)
            .audioFrequency(44100)
            .format('s16le') // Raw PCM
            .on('end', () => {
                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
                    resolve(outputPath);
                } else {
                    reject(new Error("Extracted audio is empty or too short."));
                }
            })
            .on('error', (err: any) => reject(err))
            .save(outputPath);
    });
}

/**
 * Cleanup helper
 */
export function cleanup(filePath: string) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.warn(`[audioProcessor] Failed to delete temp file ${filePath}:`, err);
    }
}
