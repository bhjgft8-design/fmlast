import { LastFM } from '../api/LastFM';
import { LoggerService } from './LoggerService';

export interface FillRequest {
    userId: string;
    sessionKey: string;
    artistNames: string[];
    countPerArtist: number;
    targetDate: Date;
    stealthLevel: 'LITE' | 'NORMAL' | 'AGGRESSIVE';
}

export class HistoryFillerService {

    /**
     * Fills a user's history with scrobbles for a set of artists.
     * Enforces daily caps and uses organic timing patterns.
     */
    static async fill(req: FillRequest) {
        const { userId, sessionKey, artistNames, countPerArtist, targetDate } = req;
        
        // 1. Cap total scrobbles to 2800 (Last.fm safety limit)
        let finalCountPerArtist = countPerArtist;
        const totalRequested = artistNames.length * countPerArtist;
        if (totalRequested > 2800) {
            finalCountPerArtist = Math.floor(2800 / artistNames.length);
            LoggerService.warn(`[Filler] Total requested (${totalRequested}) exceeds cap. Scaling to ${finalCountPerArtist} per artist.`, 'HistoryFiller');
        }

        // 2. Resolve Tracks for each artist
        const tracksToScrobble: { artist: string; track: string; album?: string; timestamp: number }[] = [];
        
        for (const artistName of artistNames) {
            try {
                const topTracks = await LastFM.getArtistTopTracks(artistName, 50, sessionKey);
                if (topTracks.length === 0) {
                    LoggerService.warn(`[Filler] No tracks found for artist: ${artistName}`, 'HistoryFiller');
                    continue;
                }

                // Randomize count between 90 and 130 per artist if using default
                const randomizedCount = 90 + Math.floor(Math.random() * 41);
                const countToUse = countPerArtist === 100 ? randomizedCount : countPerArtist;

                // Create a pool for this artist
                for (let i = 0; i < countToUse; i++) {
                    const randomTrack = topTracks[Math.floor(Math.random() * topTracks.length)];
                    tracksToScrobble.push({
                        artist: artistName,
                        track: randomTrack.name,
                        album: randomTrack.album?.name || undefined,
                        timestamp: 0 // Will be set later
                    });
                }
            } catch (err) {
                LoggerService.error(`[Filler] Failed to resolve artist: ${artistName}`, err, 'HistoryFiller');
            }
        }

        if (tracksToScrobble.length === 0) return { success: false, message: 'No valid tracks found to scrobble.' };

        // 3. Shuffle tracks to mix artists (Organic pattern)
        for (let i = tracksToScrobble.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tracksToScrobble[i], tracksToScrobble[j]] = [tracksToScrobble[j], tracksToScrobble[i]];
        }

        // 4. Distribute Timestamps (Organic Timing)
        // Start time: 10:00 AM on the target date
        const targetDay = new Date(targetDate);
        targetDay.setHours(0, 0, 0, 0);
        const startUts = Math.floor(targetDay.getTime() / 1000) + (10 * 3600);
        let currentUts = startUts;
        let sessionCount = 0;

        for (const s of tracksToScrobble) {
            s.timestamp = currentUts;
            
            // Random duration (3m - 5m)
            const trackDuration = 180 + Math.floor(Math.random() * 120);
            // Random gap (10s - 45s)
            const gap = 10 + Math.floor(Math.random() * 35);
            
            currentUts += (trackDuration + gap);
            sessionCount++;

            // Break Logic: Every 12-18 tracks, take a longer break (20-45 mins)
            if (sessionCount >= (12 + Math.floor(Math.random() * 6))) {
                const breakTime = (20 + Math.floor(Math.random() * 25)) * 60;
                currentUts += breakTime;
                sessionCount = 0;
            }

            // Safety check: Don't scrobble into the future
            if (currentUts > Math.floor(Date.now() / 1000)) {
                LoggerService.warn(`[Filler] Hit current time limit. Stopping further scrobble generation.`, 'HistoryFiller');
                break;
            }
        }

        // Filter out any that didn't get a timestamp or are in the future
        const finalBatch = tracksToScrobble.filter(t => t.timestamp > 0 && t.timestamp < Math.floor(Date.now() / 1000));

        // 5. Execute in batches of 50
        LoggerService.info(`[Filler] Starting injection of ${finalBatch.length} scrobbles for user ${userId}`, 'HistoryFiller');
        
        let successCount = 0;
        for (let i = 0; i < finalBatch.length; i += 50) {
            const chunk = finalBatch.slice(i, i + 50);
            try {
                await LastFM.scrobbleBatch(chunk, sessionKey);
                successCount += chunk.length;
                // Avoid slamming the API
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                LoggerService.error(`[Filler] Batch failed`, err, 'HistoryFiller');
            }
        }

        return { 
            success: true, 
            totalRequested: tracksToScrobble.length, 
            totalInjected: successCount,
            message: `Successfully injected ${successCount} scrobbles for ${artistNames.length} artists.`
        };
    }
}
