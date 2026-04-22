import { config } from '../../../config';
import { prisma } from '../../database/client';
import { indexQueue, triggerDeltaSync } from './QueueWorker';

/**
 * Initializes the global bot profile in the database and triggers its synchronization.
 */
export async function initBotProfile() {
    try {
        const botId = config.BOT_DISCORD_ID;
        const botLfm = config.BOT_LASTFM_USERNAME;

        if (botId && botLfm) {
            // Cleanup: If the username is already held by a different (legacy) ID, clear it first
            const existingWithName = await prisma.user.findUnique({ where: { lastfmUsername: botLfm } });
            if (existingWithName && existingWithName.discordId !== botId) {
                console.log(`[Bot] Clearing legacy bot profile (${existingWithName.discordId}) to migrate to ${botId}`);
                await prisma.user.delete({ where: { discordId: existingWithName.discordId } });
            }

            const user = await prisma.user.upsert({
                where: { discordId: botId },
                update: { lastfmUsername: botLfm },
                create: { discordId: botId, lastfmUsername: botLfm }
            });
            
            // Trigger sync for bot stats
            if (indexQueue) {
                const settings: any = user.settings || {};

                if (!settings.lastSyncTimestamp) {
                    // Force a fast FULL_SYNC for the first time
                    await indexQueue.add(`full-${botId}`, { discordId: botId, type: 'FULL_SYNC' }, {
                        jobId: `full-${botId}`,
                        removeOnComplete: true,
                        removeOnFail: true
                    });
                    console.log(`[Bot] Queued initial FULL_SYNC for ${botLfm}`);
                } else {
                    // Normal delta check for existing bot profile
                    await triggerDeltaSync(botId);
                    console.log(`[Bot] Global Profile Active: ${botLfm}`);
                }
            }
        }
    } catch (e) {
        console.error("[Bot] Global profile initialization failed:", e);
    }
}
