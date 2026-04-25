import { LastFM } from '../api/LastFM';
import { prisma } from '../../database/client';

export interface ScrobbleTrack {
    artist: string;
    track: string;
    album?: string;
    timestamp?: number;
}

export class ScrobbleService {
    /** 
     * Scrobble a single track for multiple users 
     * Used mainly by MusicBotService for live scrobbling
     */
    static async scrobbleForUsers(discordIds: string[], track: ScrobbleTrack) {
        const users = await prisma.user.findMany({
            where: { 
                discordId: { in: discordIds },
                lastfmSessionKey: { not: null }
            }
        });

        const now = Math.floor(Date.now() / 1000);
        const timestamp = track.timestamp || now;

        const results = await Promise.allSettled(users.map(async (user) => {
            // 1. Check if user has scrobbling enabled in settings
            const settings = (user.settings as any) || {};
            if (settings.scrobbling === false) return; // Opted out

            // 2. Update Now Playing (Optional, but good for visibility)
            await LastFM.updateNowPlaying(track.artist, track.track, user.lastfmSessionKey!, {
                album: track.album || ''
            }).catch(() => {});

            // 3. Perform the actual scrobble
            return await LastFM.scrobble(track.artist, track.track, timestamp, user.lastfmSessionKey!, {
                album: track.album || ''
            });
        }));

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

        for (const fail of failures) {
            console.error(`[Scrobble] Scrobble failed:`, fail.reason?.message || fail.reason);
        }

        return results;
    }

    /**
     * Batch scrobble for a single user (Import mode)
     * Handles chunking into 50s
     */
    static async scrobbleHistory(discordId: string, history: ScrobbleTrack[]) {
        const user = await prisma.user.findUnique({ where: { discordId } });
        if (!user || !user.lastfmSessionKey) throw new Error("User not linked or found.");

        const CHUNK_SIZE = 50;
        const totalTracks = history.length;
        let scrobbled = 0;

        for (let i = 0; i < totalTracks; i += CHUNK_SIZE) {
            const chunk = history.slice(i, i + CHUNK_SIZE).map(t => ({
                artist: t.artist,
                track: t.track,
                timestamp: t.timestamp || Math.floor(Date.now() / 1000),
                album: t.album
            }));

            try {
                await LastFM.scrobbleBatch(chunk, user.lastfmSessionKey);
                scrobbled += chunk.length;
            } catch (err: any) {
                console.error(`[Scrobble] Batch failed for ${user.lastfmUsername}:`, err.message);
                // Depending on error, maybe continue or break
            }
        }

        return scrobbled;
    }
}
