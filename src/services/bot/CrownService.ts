import { prisma } from '../../database/client';

export class CrownService {
    /**
     * Recalculates all crowns for a specific guild.
     * Uses a raw SQL query for maximum performance with many artists.
     */
    static async reconcileGuild(guildId: string): Promise<void> {
        console.log(`[Crowns] Reconciling guild ${guildId}...`);

        try {
            // Ensure the guild exists in our DB to prevent foreign key violations
            await prisma.guild.upsert({
                where: { guildId },
                update: {},
                create: { guildId }
            });

            await prisma.$executeRaw`
                WITH artist_rankings AS (
                    SELECT 
                        gm.guild_id,
                        ua.artist_name,
                        ua.user_id,
                        ua.playcount,
                        ROW_NUMBER() OVER(PARTITION BY ua.artist_name ORDER BY ua.playcount DESC, ua.id ASC) as rn
                    FROM user_artists ua
                    JOIN guild_members gm ON ua.user_id = gm.user_id
                    WHERE gm.guild_id = ${guildId}
                    AND ua.playcount >= 20
                )
                INSERT INTO crowns (id, guild_id, artist_name, user_id, playcount, updated_at)
                SELECT 
                    'cr_' || md5(guild_id || artist_name), 
                    guild_id, 
                    artist_name, 
                    user_id, 
                    playcount, 
                    NOW()
                FROM artist_rankings
                WHERE rn = 1
                ON CONFLICT (guild_id, artist_name) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    playcount = EXCLUDED.playcount,
                    updated_at = EXCLUDED.updated_at;
            `;
            console.log(`[Crowns] Guild ${guildId} reconciled.`);
        } catch (err) {
            console.error(`[Crowns] Error reconciling guild ${guildId}:`, err);
        }
    }

    /**
     * Explicitly claims or updates a crown for a specific artist.
     * Enforces the 20-play minimum requirement.
     */
    static async claimCrown(guildId: string, artistName: string, userId: string, playcount: number): Promise<boolean> {
        if (playcount < 20) return false;

        try {
            // Ensure the guild exists in our DB to prevent foreign key violations
            await prisma.guild.upsert({
                where: { guildId },
                update: {},
                create: { guildId }
            });

            const existing = await prisma.crown.findUnique({
                where: { guildId_artistName: { guildId, artistName } }
            });

            const isNewHolder = !existing || existing.userId !== userId;

            // If stolen, archive the old holder to history
            if (existing && existing.userId !== userId) {
                await prisma.crownHistory.create({
                    data: {
                        guildId,
                        artistName,
                        userId: existing.userId,
                        playcountAtClaim: existing.initialPlaycount,
                        playcountAtLoss: existing.playcount,
                        claimedAt: existing.claimedAt,
                        lostAt: new Date()
                    }
                });
            }

            await prisma.crown.upsert({
                where: { guildId_artistName: { guildId, artistName } },
                update: { 
                    userId, 
                    playcount, 
                    updatedAt: new Date(),
                    ...(isNewHolder ? { claimedAt: new Date(), initialPlaycount: playcount } : {})
                },
                create: {
                    id: 'cr_' + Math.random().toString(36).substring(2),
                    guildId,
                    artistName,
                    userId,
                    playcount,
                    initialPlaycount: playcount,
                    claimedAt: new Date()
                }
            });
            return true;
        } catch (err) {
            console.error(`[Crowns] Failed to claim crown for ${artistName} in ${guildId}:`, err);
            return false;
        }
    }

    /**
     * Checks if a user has stolen or reinforced any crowns for specific artists.
     * Useful after a DELTA_SYNC finishes.
     */
    static async reconcileUser(userId: string): Promise<void> {
        try {
            // Find all guilds this user is in
            const memberships = await prisma.guildMember.findMany({
                where: { userId },
                select: { guildId: true }
            });

            if (memberships.length === 0) return;

            // For each guild, trigger a reconciliation (backgrounded)
            for (const m of memberships) {
                // To keep it simple and efficient, we just run the guild-wide reconciliation query
                // It's fast enough in PG even for large servers.
                this.reconcileGuild(m.guildId);
            }
        } catch (err) {
            console.error(`[Crowns] User ${userId} reconciliation failed:`, err);
        }
    }

    /**
     * Get all crowns belonging to a specific user in a specific guild.
     */
    static async getUserCrowns(guildId: string, discordId: string, sort: 'Playcount' | 'Recent' | 'Stolen' = 'Playcount') {
        const orderBy = (sort === 'Recent' || sort === 'Stolen') 
            ? { claimedAt: 'desc' as const } 
            : { playcount: 'desc' as const };

        return prisma.crown.findMany({
            where: {
                guildId,
                user: { discordId }
            },
            orderBy
        });
    }

    /**
     * Get information about a single artist's crown in a guild.
     */
    static async getArtistCrown(guildId: string, artistName: string) {
        return prisma.crown.findUnique({
            where: {
                guildId_artistName: { guildId, artistName }
            },
            include: {
                user: true
            }
        });
    }

    /**
     * Get the holder history for a specific artist in a guild.
     */
    static async getHistory(guildId: string, artistName: string) {
        return prisma.crownHistory.findMany({
            where: { guildId, artistName },
            include: { user: true },
            orderBy: { lostAt: 'desc' },
            take: 10
        });
    }
}
