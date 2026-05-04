import { prisma } from '../../database/client';
import { TrackResolverService } from '../api/TrackResolverService';

export enum AlbumRarity {
    COMMON = 'COMMON',
    RARE = 'RARE',
    EPIC = 'EPIC',
    LEGENDARY = 'LEGENDARY'
}

export interface AlbumRoll {
    albumId: string;
    albumName: string;
    artistName: string;
    image: string;
    rarity: AlbumRarity;
}

export class AlbumGameService {
    /**
     * Rolls for a random album based on gacha rates and rarity tiers.
     */
    static async rollAlbum(userId: string): Promise<AlbumRoll | null> {
        // 1. Determine Rarity Tier (New exclusive rates)
        const roll = Math.random() * 100;
        let rarity = AlbumRarity.COMMON;

        if (roll < 0.5) {
            rarity = AlbumRarity.LEGENDARY;
        } else if (roll < 4) {
            rarity = AlbumRarity.EPIC;
        } else if (roll < 20) {
            rarity = AlbumRarity.RARE;
        }

        // 2. Fetch a random album from the global pool
        // We'll retry up to 5 times if we can't find an image for the selected album
        let attempts = 0;
        while (attempts < 5) {
            attempts++;
            const albums = await prisma.$queryRaw<any[]>`
                SELECT a.id, a.name as "albumName", art.name as "artistName"
                FROM albums a
                JOIN artists art ON a.artist_id = art.id
                ORDER BY RANDOM()
                LIMIT 1
            `;

            if (!albums || albums.length === 0) return null;
            const album = albums[0];

            // 3. Resolve fresh artwork from APIs (Always bypassing DB as requested)
            const resolved = await TrackResolverService.resolveAlbum(album.artistName, album.albumName);
            const image = resolved.artworkUrl || '';

            if (image) {
                return {
                    albumId: album.id,
                    albumName: album.albumName,
                    artistName: album.artistName,
                    image: image,
                    rarity
                };
            }
            
            // If no image, loop will try again with a new random album
        }

        return null; // Exhausted retries
    }

    /**
     * Claims an album for the user.
     */
    static async claimAlbum(discordId: string, albumId: string, rarity: AlbumRarity): Promise<boolean> {
        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return false;

        try {
            await prisma.userAlbumCollection.upsert({
                where: {
                    userId_albumId: {
                        userId: dbUser.id,
                        albumId
                    }
                },
                create: {
                    userId: dbUser.id,
                    albumId,
                    rarity
                },
                update: {}
            });

            // On successful claim, trigger cooldown and reset quota
            await prisma.user.update({
                where: { discordId },
                data: {
                    albumRolls: 10, // Max out rolls to force cooldown
                    lastAlbumRoll: new Date()
                }
            });

            return true;
        } catch (err) {
            console.error('[AlbumGame] Error claiming album:', err);
            return false;
        }
    }

    /**
     * Gets the user's collection.
     */
    static async getCollection(discordId: string, page = 0, limit = 10) {
        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return null;

        const count = await prisma.userAlbumCollection.count({ where: { userId: dbUser.id } });
        const items = await prisma.userAlbumCollection.findMany({
            where: { userId: dbUser.id },
            include: {
                album: {
                    include: { artist: true }
                }
            },
            orderBy: { claimedAt: 'desc' },
            skip: page * limit,
            take: limit
        });

        return { items, count };
    }

    /**
     * Formats rarity into a hex color for the UI.
     */
    static getRarityColor(rarity: AlbumRarity): number {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return 0xFFD700; // Gold
            case AlbumRarity.EPIC:      return 0xA335EE; // Purple
            case AlbumRarity.RARE:      return 0x0070DD; // Blue
            default:                    return 0xFFFFFF; // White
        }
    }
}
