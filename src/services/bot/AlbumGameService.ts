import { prisma } from '../../database/client';
import { TrackResolverService } from '../api/TrackResolverService';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { client } from '../../index';
import { TextChannel, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { CacheService } from '../bot/CacheService';
import { LoggerService } from '../bot/LoggerService';
import { AlbumRenderService } from '../bot/AlbumRenderService';
import { Spotify } from '../api/Spotify';

export enum AlbumRarity {
    COMMON = 'COMMON',
    RARE = 'RARE',
    EPIC = 'EPIC',
    LEGENDARY = 'LEGENDARY'
}

export interface GameRoll {
    type: 'ALBUM' | 'ARTIST';
    itemId: string;
    albumName?: string;
    artistName: string;
    image: string;
    rarity: AlbumRarity;
    variant: string;
}

export class AlbumGameService {
    /**
     * Rolls for a random item (80% Album, 20% Artist) based on gacha rates.
     */
    static async rollItem(userId: string): Promise<GameRoll | null> {
        // 1. Determine Rarity Tier
        const roll = Math.random() * 100;
        let rarity = AlbumRarity.COMMON;

        if (roll < 0.5) rarity = AlbumRarity.LEGENDARY;
        else if (roll < 4) rarity = AlbumRarity.EPIC;
        else if (roll < 20) rarity = AlbumRarity.RARE;

        // 2. Determine Variant Tier
        const variantRoll = Math.random() * 1000;
        let variant = 'NORMAL';
        if (variantRoll < 5) variant = 'ERROR'; // 0.5%
        else if (variantRoll < 50) variant = 'HOLOGRAPHIC'; // 4.5%

        // 3. Determine Item Type (80% Album, 20% Artist)
        const isArtistRoll = Math.random() < 0.2;

        let attempts = 0;
        while (attempts < 5) {
            attempts++;
            
            if (isArtistRoll) {
                const artists = await prisma.$queryRaw<any[]>`
                    SELECT id, name as "artistName"
                    FROM artists
                    WHERE name NOT LIKE '%Ù%' 
                      AND name NOT LIKE '%Ø%'
                      AND name NOT LIKE '%??%'
                      AND LENGTH(name) > 1
                    ORDER BY RANDOM()
                    LIMIT 1
                `;
                
                if (!artists || artists.length === 0) return null;
                const artist = artists[0];
                
                let image = '';
                try {
                    const res = await TrackResolverService.resolveArtist(artist.artistName);
                    image = res.avatarUrl || '';
                } catch { }
                
                if (image) {
                    return {
                        type: 'ARTIST',
                        itemId: artist.id,
                        artistName: artist.artistName,
                        image,
                        rarity,
                        variant
                    };
                }
            } else {
                const albums = await prisma.$queryRaw<any[]>`
                    SELECT a.id, a.name as "albumName", art.name as "artistName"
                    FROM albums a
                    JOIN artists art ON a.artist_id = art.id
                    WHERE a.name NOT LIKE '%Ù%' 
                      AND a.name NOT LIKE '%Ø%'
                      AND a.name NOT LIKE '%??%'
                      AND art.name NOT LIKE '%Ù%'
                      AND art.name NOT LIKE '%Ø%'
                      AND LENGTH(a.name) > 1
                    ORDER BY RANDOM()
                    LIMIT 1
                `;

                if (!albums || albums.length === 0) return null;
                const album = albums[0];

                const resolved = await TrackResolverService.resolveAlbum(album.artistName, album.albumName);
                const image = resolved.artworkUrl || '';

                if (image) {
                    return {
                        type: 'ALBUM',
                        itemId: album.id,
                        albumName: album.albumName,
                        artistName: album.artistName,
                        image,
                        rarity,
                        variant
                    };
                }
            }
        }

        return null;
    }

    /**
     * Claims an item (Album or Artist) for the user.
     */
    static async claimItem(discordId: string, type: 'ALBUM' | 'ARTIST', itemId: string, rarity: AlbumRarity, variant: string): Promise<{success: boolean, message?: string}> {
        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return { success: false };

        try {
            let bonusMessage: string | undefined;

            if (type === 'ALBUM') {
                await prisma.userAlbumCollection.upsert({
                    where: { userId_albumId: { userId: dbUser.id, albumId: itemId } },
                    create: { userId: dbUser.id, albumId: itemId, rarity, variant },
                    update: {}
                });
                
                // Trigger Artist Completion Check
                const album = await prisma.album.findUnique({ where: { id: itemId }, include: { artist: true } });
                if (album) {
                    const artistId = album.artistId;
                    const totalAlbums = await prisma.album.count({ where: { artistId } });
                    const userAlbums = await prisma.userAlbumCollection.count({
                        where: { userId: dbUser.id, album: { artistId } }
                    });
                    
                    if (totalAlbums > 0 && userAlbums === totalAlbums) {
                        const badgeName = `Completed: ${album.artist.name}`;
                        const profile = await prisma.userGameProfile.findUnique({ where: { userId: dbUser.id } });
                        if (profile && !profile.badges.includes(badgeName)) {
                            await prisma.userGameProfile.update({
                                where: { userId: dbUser.id },
                                data: { vinylScraps: { increment: 5000 }, badges: { push: badgeName } }
                            });
                            bonusMessage = `🎉 **ARTIST COMPLETED!** You collected all ${totalAlbums} albums by **${album.artist.name}** and received a badge + **5000 Vinyls**!`;
                        }
                    }
                }
                
            } else {
                await prisma.userArtistCollection.upsert({
                    where: { 
                        userId_artistId_rarity_variant: { 
                            userId: dbUser.id, 
                            artistId: itemId, 
                            rarity, 
                            variant 
                        } 
                    },
                    create: { userId: dbUser.id, artistId: itemId, rarity, variant },
                    update: {}
                });
            }

            // Calculate Value
            let value = 10;
            if (rarity === AlbumRarity.RARE) value = 50;
            if (rarity === AlbumRarity.EPIC) value = 200;
            if (rarity === AlbumRarity.LEGENDARY) value = 1000;
            if (variant === 'HOLOGRAPHIC') value *= 10;
            if (variant === 'ERROR') value *= 50;
            if (variant === 'GLITCH') value *= 100;

            await prisma.userGameProfile.upsert({
                where: { userId: dbUser.id },
                create: { userId: dbUser.id, collectionValue: value },
                update: { collectionValue: { increment: value } }
            });

            await prisma.user.update({
                where: { discordId },
                data: {
                    albumRolls: 10, // Max out rolls to force cooldown
                    lastAlbumRoll: new Date()
                }
            });

            return { success: true, message: bonusMessage };
        } catch (err) {
            console.error('[AlbumGame] Error claiming item:', err);
            return { success: false };
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
     * RPG: Get a user's artist collection with pagination.
     */
    static async getArtistCollection(discordId: string, page = 0, limit = 1) {
        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return null;

        const count = await prisma.userArtistCollection.count({ where: { userId: dbUser.id } });
        const items = await prisma.userArtistCollection.findMany({
            where: { userId: dbUser.id },
            include: {
                artist: true
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

    /**
     * RPG: Gets or creates a user's game profile.
     */
    static async getGameProfile(discordId: string) {
        const user = await prisma.user.findUnique({ 
            where: { discordId },
            include: { gameProfile: true }
        });
        if (!user) return null;

        if (!user.gameProfile) {
            return await prisma.userGameProfile.create({
                data: { userId: user.id }
            });
        }
        return user.gameProfile;
    }

    /**
     * RPG: Calculates scrap value based on rarity.
     */
    static getScrapValue(rarity: AlbumRarity): number {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return 500;
            case AlbumRarity.EPIC:      return 100;
            case AlbumRarity.RARE:      return 25;
            default:                    return 5;
        }
    }

    /**
     * RPG: Checks if an item is already owned.
     */
    static async isOwned(discordId: string, type: 'ALBUM' | 'ARTIST', itemId: string): Promise<boolean> {
        const user = await prisma.user.findUnique({ where: { discordId } });
        if (!user) return false;

        if (type === 'ALBUM') {
            const collection = await prisma.userAlbumCollection.findUnique({
                where: { userId_albumId: { userId: user.id, albumId: itemId } }
            });
            return !!collection;
        } else {
            const collection = await prisma.userArtistCollection.findFirst({
                where: { userId: user.id, artistId: itemId }
            });
            return !!collection;
        }
    }

    /**
     * RPG: Updates user wishlist.
     */
    static async updateWishlist(discordId: string, albumId: string, action: 'add' | 'remove'): Promise<boolean> {
        const profile = await this.getGameProfile(discordId);
        if (!profile) return false;

        let newWishlist = [...profile.wishlist];
        if (action === 'add') {
            if (newWishlist.length >= 5) return false;
            if (!newWishlist.includes(albumId)) newWishlist.push(albumId);
        } else {
            newWishlist = newWishlist.filter(id => id !== albumId);
        }

        await prisma.userGameProfile.update({
            where: { userId: profile.userId },
            data: { wishlist: newWishlist }
        });
        return true;
    }

    /**
     * RPG: Check if anyone has this album on their wishlist.
     */
    static async getWishers(albumId: string): Promise<string[]> {
        const profiles = await prisma.userGameProfile.findMany({
            where: { wishlist: { has: albumId } },
            include: { user: true }
        });
        return profiles.map(p => p.user.discordId);
    }

    /**
     * RPG: Check and apply evolutions based on Mastery XP.
     */
    static async checkAndApplyEvolutions(userId: string, type: 'ALBUM' | 'ARTIST', itemId: string, xpIncrement: number) {
        if (type === 'ALBUM') {
            const collection = await prisma.userAlbumCollection.findUnique({
                where: { userId_albumId: { userId, albumId: itemId } }
            });
            if (!collection) return;

            const newXp = collection.masteryXp + xpIncrement;
            let newVariant = collection.variant;
            let newPolish = collection.polishLevel;
            let upgraded = false;

            if (newXp >= 1000 && newVariant !== 'GLITCH') {
                newVariant = 'GLITCH';
                upgraded = true;
            } else if (newXp >= 500 && newVariant === 'NORMAL') {
                newVariant = 'HOLOGRAPHIC';
                upgraded = true;
            } else if (newXp >= 300 && newPolish < 3) {
                newPolish = 3;
                upgraded = true;
            } else if (newXp >= 150 && newPolish < 2) {
                newPolish = 2;
                upgraded = true;
            } else if (newXp >= 50 && newPolish < 1) {
                newPolish = 1;
                upgraded = true;
            }

            await prisma.userAlbumCollection.update({
                where: { id: collection.id },
                data: { masteryXp: newXp, variant: newVariant, polishLevel: newPolish }
            });
            
            if (upgraded) {
                // optionally we could send a DM or log it
            }
        } else {
        const collection = await prisma.userArtistCollection.findFirst({
            where: { userId, artistId: itemId }
        });
            if (!collection) return;

            const newXp = collection.masteryXp + xpIncrement;
            let newVariant = collection.variant;
            let newPolish = collection.polishLevel;
            let upgraded = false;

            if (newXp >= 1000 && newVariant !== 'GLITCH') {
                newVariant = 'GLITCH';
                upgraded = true;
            } else if (newXp >= 500 && newVariant === 'HOLOGRAPHIC') {
                newVariant = 'GLITCH';
                upgraded = true;
            } else if (newXp >= 300 && (newVariant === 'RAINBOW' || newVariant === 'NORMAL')) {
                newVariant = 'RAINBOW';
                upgraded = true;
            } else if (newXp >= 150 && (newVariant === 'DIAMOND' || newVariant === 'NORMAL')) {
                newVariant = 'DIAMOND';
                upgraded = true;
            } else if (newXp >= 50 && (newVariant === 'GOLD' || newVariant === 'NORMAL')) {
                newVariant = 'GOLD';
                upgraded = true;
            }

            await prisma.userArtistCollection.update({
                where: { id: collection.id },
                data: { masteryXp: newXp, variant: newVariant, polishLevel: newPolish }
            });
        }
    }

    /**
     * RPG: Check and apply scrobbles to active Raid Bosses.
     */
    static async checkAndApplyRaidBoss(userId: string, artistId: string, scrobbles: number) {
        // Find active raid bosses for this artist
        const activeBosses = await prisma.raidBoss.findMany({
            where: { artistId, status: 'ACTIVE' },
            include: { artist: true }
        });

        for (const boss of activeBosses) {
            const now = new Date();
            if (now > boss.endTime) {
                await prisma.raidBoss.update({ where: { id: boss.id }, data: { status: 'FAILED' } });
                continue;
            }

            // ── Update Global Progress ──
            LoggerService.info(`[Raid] Applying ${scrobbles} scrobbles to boss ${boss.id} for artist ${boss.artist.name}`, 'Raid');
            const updated = await prisma.raidBoss.update({
                where: { id: boss.id },
                data: { currentScrobbles: { increment: scrobbles } }
            });

            // ── Update Individual Contribution (Damage) ──
            await prisma.raidContribution.upsert({
                where: { raidId_userId: { raidId: boss.id, userId } },
                update: { scrobbles: { increment: scrobbles } },
                create: { raidId: boss.id, userId, scrobbles }
            });

            if (updated.currentScrobbles >= updated.targetScrobbles) {
                // Atomic check to ensure only one process handles the victory
                const result = await prisma.raidBoss.updateMany({
                    where: { id: boss.id, status: 'ACTIVE' },
                    data: { status: 'DEFEATED' }
                });

                if (result.count === 0) continue;
                
                // ── VICTOR NOTIFICATION ──
                if (boss.notificationChannelId) {
                    try {
                        const channel = await client.channels.fetch(boss.notificationChannelId) as TextChannel;
                        if (channel) {
                            // ── Award Rewards to Contributors ──
                            const contributors = await prisma.raidContribution.findMany({
                                where: { raidId: boss.id },
                                include: { user: true }
                            });

                            for (const c of contributors) {
                                // Award a random card of this artist to the user
                                await this.awardRaidReward(c.user.discordId, boss.artistId);
                            }

                            // ── Render Victory Card ──
                            let cardBuffer: Buffer | null = null;
                            try {
                                const res = await TrackResolverService.resolveArtist(boss.artist.name);
                                cardBuffer = await AlbumRenderService.renderRaidAnimation({
                                    artistName: boss.artist.name,
                                    image: res.avatarUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'
                                });
                            } catch (e) {
                                console.error('[Raid] Failed to render victory card:', e);
                            }

                            const builder = new ComponentsV2()
                                .setAccent(0xFF4500)
                                .addText(`## ⚔️ RAID BOSS DEFEATED!\nThe community has successfully taken down **${boss.artist.name}**!`)
                                .addText(`\n**Total HP:** \`${boss.targetScrobbles.toLocaleString()}\` HP\n**Heroes Involved:** \`${contributors.length}\` contributors\n\n*Every hero has been awarded a special **RAID ELITE** card of this artist!*`);

                            if (cardBuffer) {
                                builder.setImage('attachment://raid_victory.webp');
                            }

                            const payload: any = builder.build();
                            if (cardBuffer) {
                                payload.files = [new AttachmentBuilder(cardBuffer, { name: 'raid_victory.webp' })];
                            }

                            await channel.send(payload);
                        }
                    } catch (e) {
                        console.error('[Raid] Failed to send victory notification:', e);
                    }
                }

                // TODO: Award participants (e.g. random card from this artist or vinyls)
            }
        }
    }

    /**
     * RPG: Award Vinyls to user.
     */
    static async awardVinyls(discordId: string, amount: number) {
        const profile = await this.getGameProfile(discordId);
        if (!profile) return;

        await prisma.userGameProfile.update({
            where: { userId: profile.userId },
            data: { vinylScraps: { increment: amount } }
        });
    }

    /**
     * RPG: Process results of a sync job to update Raid Bosses and Card Mastery.
     */
    static async processSyncResults(userId: string, artistCounts: Map<string, {name: string, count: number}>, albumCounts: Map<string, {artistName: string, albumName: string, count: number}>) {
        if (artistCounts.size === 0) return;
        LoggerService.info(`[RPG] Processing sync results for user ${userId}. Artists found: ${artistCounts.size}`, 'RPG');
        
        // 1. Update Raid Bosses (only for added scrobbles)
        for (const [key, data] of artistCounts.entries()) {
            if (data.count <= 0) continue;
            
            // Resolve artist ID
            const artist = await prisma.artist.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } } });
            if (artist) {
                LoggerService.info(`[RPG] Found artist ${artist.name} with ${data.count} new scrobbles`, 'RPG');
                await this.checkAndApplyRaidBoss(userId, artist.id, data.count);
                
                // 2. Update Artist Mastery XP
                await this.checkAndApplyEvolutions(userId, 'ARTIST', artist.id, data.count);
            }
        }

        // 3. Update Album Mastery XP
        for (const [key, data] of albumCounts.entries()) {
            if (data.count <= 0) continue;

            const artist = await prisma.artist.findFirst({ where: { name: { equals: data.artistName, mode: 'insensitive' } } });
            if (artist) {
                const album = await prisma.album.findFirst({ 
                    where: { 
                        name: { equals: data.albumName, mode: 'insensitive' },
                        artistId: artist.id
                    } 
                });
                if (album) {
                    await this.checkAndApplyEvolutions(userId, 'ALBUM', album.id, data.count);
                }
            }
        }
    }

    /**
     * RPG: Caches a proxied image URL.
     */
    static async cacheProxyUrl(originalUrl: string, proxiedUrl: string) {
        const key = `market:proxy:${Buffer.from(originalUrl).toString('base64')}`;
        await CacheService.set(key, proxiedUrl, 21600); // 6 hours
    }

    /**
     * RPG: Gets a cached proxied image URL.
     */
    static async getCachedProxyUrl(originalUrl: string): Promise<string | null> {
        const key = `market:proxy:${Buffer.from(originalUrl).toString('base64')}`;
        return await CacheService.get<string>(key);
    }

    /**
     * RPG: Refreshes the global market with new stock.
     */
    static async refreshMarket() {
        // Clear old items
        await prisma.marketItem.deleteMany({});

        // Pick 10 random albums with weighted rarity
        const items = [];
        for (let i = 0; i < 10; i++) {
            const album = await this.pickRandomAlbum();
            if (!album) continue;

            const roll = Math.random() * 100;
            let rarity = AlbumRarity.COMMON;
            let price = 25;

            if (roll < 2) {
                rarity = AlbumRarity.LEGENDARY;
                price = 1500;
            } else if (roll < 10) {
                rarity = AlbumRarity.EPIC;
                price = 400;
            } else if (roll < 40) {
                rarity = AlbumRarity.RARE;
                price = 100;
            }

            items.push({ albumId: album.id, rarity, price });
        }

        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
        
        for (const item of items) {
            await prisma.marketItem.create({
                data: { ...item, expiresAt }
            });
        }
    }

    private static async pickRandomAlbum() {
        const albums = await prisma.$queryRaw<any[]>`
            SELECT a.id 
            FROM albums a
            JOIN artists art ON a.artist_id = art.id
            WHERE a.name NOT LIKE '%Ù%' 
              AND a.name NOT LIKE '%Ø%'
              AND a.name NOT LIKE '%??%'
              AND art.name NOT LIKE '%Ù%'
              AND art.name NOT LIKE '%Ø%'
              AND LENGTH(a.name) > 1
            ORDER BY RANDOM() 
            LIMIT 1
        `;
        return albums[0] || null;
    }

    static async getMarketItems() {
        return await prisma.marketItem.findMany({
            include: { album: { include: { artist: true } } },
            orderBy: { id: 'asc' }
        });
    }

    /**
     * RPG: Purchase an album from the market.
     */
    static async buyFromMarket(discordId: string, marketId: string): Promise<{ success: boolean; msg: string }> {
        const profile = await this.getGameProfile(discordId);
        if (!profile) return { success: false, msg: 'Profile not found.' };

        const item = await prisma.marketItem.findUnique({
            where: { id: marketId },
            include: { album: { include: { artist: true } } }
        });
        if (!item) return { success: false, msg: 'Item no longer in market.' };
        if (item.isSold) return { success: false, msg: 'This album is already sold out!' };

        if (profile.vinylScraps < item.price) {
            return { success: false, msg: `You need **${item.price}** Vinyls! (You have ${profile.vinylScraps})` };
        }

        // Check if already owned
        const owned = await this.isOwned(discordId, 'ALBUM', item.albumId);
        if (owned) return { success: false, msg: 'You already own this album!' };

        // Calculate Value
        let value = 10;
        if (item.rarity === AlbumRarity.RARE) value = 50;
        if (item.rarity === AlbumRarity.EPIC) value = 200;
        if (item.rarity === AlbumRarity.LEGENDARY) value = 1000;

        // Transaction
        await prisma.$transaction([
            prisma.userGameProfile.update({
                where: { userId: profile.userId },
                data: { vinylScraps: { decrement: item.price }, collectionValue: { increment: value } }
            }),
            prisma.userAlbumCollection.create({
                data: {
                    userId: profile.userId,
                    albumId: item.albumId,
                    rarity: item.rarity,
                    variant: 'NORMAL' // Market items are always normal for now
                }
            }),
            prisma.marketItem.update({
                where: { id: marketId },
                data: { isSold: true }
            })
        ]);

        return { success: true, msg: `Successfully bought **${item.album.artist.name} - ${item.album.name}**!` };
    }

    /**
     * RPG: Claims daily reward.
     */
    static async claimDaily(discordId: string): Promise<{ success: boolean; scraps?: number; cooldown?: number }> {
        const profile = await this.getGameProfile(discordId);
        if (!profile) return { success: false };

        const now = new Date();
        const lastDaily = profile.lastDaily;
        const COOLDOWN = 6 * 60 * 60 * 1000;

        if (lastDaily && (now.getTime() - lastDaily.getTime() < COOLDOWN)) {
            return { success: false, cooldown: COOLDOWN - (now.getTime() - lastDaily.getTime()) };
        }

        const Vinyls = Math.floor(Math.random() * (150 - 50 + 1)) + 50;
        await prisma.$transaction([
            prisma.userGameProfile.update({
                where: { userId: profile.userId },
                data: { 
                    vinylScraps: { increment: Vinyls },
                    lastDaily: now
                }
            }),
            prisma.user.update({
                where: { discordId },
                data: { 
                    albumRolls: 0, // Reset roll quota
                    lastAlbumRoll: null 
                }
            })
        ]);

        return { success: true, scraps: Vinyls };

    }

    /**
     * RPG: Purchase a specialized booster pack.
     */
    static async buyPack(discordId: string, packId: string): Promise<{ success: boolean; msg: string; roll?: GameRoll }> {
        const PACKS: Record<string, { name: string; price: number; polish: number; variant: string }> = {
            'pack_gold':      { name: 'Gold Booster', price: 1000, polish: 1, variant: 'NORMAL' },
            'pack_diamond':   { name: 'Diamond Booster', price: 5000, polish: 2, variant: 'NORMAL' },
            'pack_rainbow':   { name: 'Rainbow Booster', price: 15000, polish: 3, variant: 'NORMAL' },
            'pack_holo':      { name: 'Holographic Pack', price: 25000, polish: 0, variant: 'HOLOGRAPHIC' },
            'pack_error':     { name: 'Glitch Pack', price: 60000, polish: 0, variant: 'ERROR' }
        };

        const pack = PACKS[packId];
        if (!pack) return { success: false, msg: 'Invalid booster pack.' };

        const profile = await this.getGameProfile(discordId);
        if (!profile) return { success: false, msg: 'Profile not found.' };

        if (profile.vinylScraps < pack.price) {
            return { success: false, msg: `You need **${pack.price.toLocaleString()}** Vinyls for this pack! (You have ${profile.vinylScraps.toLocaleString()})` };
        }

        // Generate a random album for the pack
        const albums = await prisma.$queryRaw<any[]>`
            SELECT a.id, a.name as "albumName", art.name as "artistName"
            FROM albums a
            JOIN artists art ON a.artist_id = art.id
            WHERE a.name NOT LIKE '%Ù%' 
              AND a.name NOT LIKE '%Ø%'
              AND LENGTH(a.name) > 1
            ORDER BY RANDOM()
            LIMIT 1
        `;

        if (!albums || albums.length === 0) return { success: false, msg: 'Failed to generate pack contents.' };
        const album = albums[0];

        // Determine rarity for the pack (standard rates)
        const rollValue = Math.random() * 100;
        let rarity = AlbumRarity.COMMON;
        if (rollValue < 1) rarity = AlbumRarity.LEGENDARY;
        else if (rollValue < 8) rarity = AlbumRarity.EPIC;
        else if (rollValue < 25) rarity = AlbumRarity.RARE;

        // Calculate Collection Value increase
        let baseValue = 10;
        if (rarity === AlbumRarity.RARE) baseValue = 50;
        if (rarity === AlbumRarity.EPIC) baseValue = 200;
        if (rarity === AlbumRarity.LEGENDARY) baseValue = 1000;

        // Bonus value for polish/variants
        const bonusValue = (pack.polish * 200) + (pack.variant !== 'NORMAL' ? 500 : 0);
        const totalValue = baseValue + bonusValue;

        const resolved = await TrackResolverService.resolveAlbum(album.artistName, album.albumName);
        const image = resolved.artworkUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

        // Check if already owned - if so, convert to scraps as usual
        const isOwned = await this.isOwned(discordId, 'ALBUM', album.id);
        
        if (isOwned) {
            const refund = Math.floor(pack.price * 0.4); // 40% refund on duplicate pack items
            await prisma.userGameProfile.update({
                where: { userId: profile.userId },
                data: { vinylScraps: { decrement: pack.price - refund } }
            });
            return { 
                success: true, 
                msg: `💿 **Duplicate!** You pulled ${album.artistName} — ${album.albumName}.\nSince you already own it, you were refunded **${refund.toLocaleString()}** Vinyls.`,
                roll: { type: 'ALBUM', itemId: album.id, artistName: album.artistName, albumName: album.albumName, image, rarity, variant: pack.variant }
            };
        }

        // Create the item
        await prisma.$transaction([
            prisma.userGameProfile.update({
                where: { userId: profile.userId },
                data: { 
                    vinylScraps: { decrement: pack.price }, 
                    collectionValue: { increment: totalValue } 
                }
            }),
            prisma.userAlbumCollection.create({
                data: {
                    userId: profile.userId,
                    albumId: album.id,
                    rarity: rarity,
                    variant: pack.variant,
                    polishLevel: pack.polish
                }
            })
        ]);

        return { 
            success: true, 
            msg: `✅ Successfully opened **${pack.name}**!`,
            roll: { type: 'ALBUM', itemId: album.id, artistName: album.artistName, albumName: album.albumName, image, rarity, variant: pack.variant }
        };
    }
    /**
     * RPG: Get top contributors for a raid.
     */
    static async getRaidLeaderboard(raidId: string, limit = 5) {
        return await prisma.raidContribution.findMany({
            where: { raidId },
            include: { user: true },
            orderBy: { scrobbles: 'desc' },
            take: limit
        });
    }

    /**
     * RPG: Get specific user contribution for a raid.
     */
    static async getUserRaidContribution(raidId: string, userId: string) {
        return await prisma.raidContribution.findUnique({
            where: { raidId_userId: { raidId, userId } }
        });
    }
    /**
     * RPG: Award a card from a specific artist (used for Raids).
     */
    static async awardRaidReward(discordId: string, artistId: string) {
        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return;

        // Award the Artist Card (RAID variant)
        const existing = await prisma.userArtistCollection.findUnique({
            where: { 
                userId_artistId_rarity_variant: { 
                    userId: dbUser.id, 
                    artistId,
                    rarity: 'COMMON',
                    variant: 'RAID'
                } 
            }
        });

        if (existing) {
            // Duplicate RAID reward: Grant 50 Mastery XP instead
            await this.checkAndApplyEvolutions(dbUser.id, 'ARTIST', artistId, 50);
        } else {
            await prisma.userArtistCollection.create({
                data: { userId: dbUser.id, artistId, rarity: 'COMMON', variant: 'RAID', masteryXp: 10 }
            });
        }
    }
    /**
     * RPG: Recalculate total raid progress from individual contributions.
     * This prevents the "stuck progress" bug caused by sync race conditions.
     */
    static async recalculateRaidProgress(raidId: string): Promise<number> {
        const aggregations = await prisma.raidContribution.aggregate({
            where: { raidId },
            _sum: { scrobbles: true }
        });
        return aggregations._sum.scrobbles || 0;
    }
}
