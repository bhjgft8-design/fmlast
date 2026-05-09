import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import {
    SlashCommandBuilder,
    TextChannel,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    AttachmentBuilder,
    ChannelType
} from "discord.js";
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { AlbumGameService, AlbumRarity, GameRoll } from '../../services/bot/AlbumGameService';
import { TrackResolverService } from '../../services/api/TrackResolverService';
import { Spotify } from '../../services/api/Spotify';
import { LastFM } from '../../services/api/LastFM';
import { AlbumRenderService } from '../../services/bot/AlbumRenderService';
import { RenderCacheService } from '../../services/bot/RenderCacheService';
import { config } from '../../../config';
import axios from 'axios';

export default class AlbumCommand extends BaseCommand {
    name = 'album';
    description = 'Roll for and collect albums in your personal music collection!';
    aliases = ['ar', 'roll', 'claim'];

    slashData = new SlashCommandBuilder()
        .setName('album')
        .setDescription('Music Album Collection Game')
        .addSubcommand(sub =>
            sub.setName('roll')
                .setDescription('Roll for a random album to add to your collection')
        )
        .addSubcommand(sub =>
            sub.setName('collection')
                .setDescription('View your collected albums')
                .addUserOption(opt => opt.setName('user').setDescription('User to view collection of'))
        )
        .addSubcommand(sub =>
            sub.setName('profile')
                .setDescription('View your game profile, Vinyls, and wishlist')
                .addUserOption(opt => opt.setName('user').setDescription('User to view profile of'))
        )
        .addSubcommand(sub =>
            sub.setName('roster')
                .setDescription('View your collected artist cards')
                .addUserOption(opt => opt.setName('user').setDescription('User to view roster of'))
        )
        .addSubcommand(sub =>
            sub.setName('wish')
                .setDescription('Add/remove an album from your wishlist')
                .addStringOption(opt => opt.setName('query').setDescription('Artist - Album').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('market')
                .setDescription('View and buy from the global album market')
        )
        .addSubcommand(sub =>
            sub.setName('daily')
                .setDescription('Claim your daily Vinyls and quota reset')
        )
        .addSubcommand(sub =>
            sub.setName('balance')
                .setDescription('Check your Vinyls balance')
                .addUserOption(opt => opt.setName('user').setDescription('User to check balance of'))
        )
        .addSubcommand(sub =>
            sub.setName('polish')
                .setDescription('Upgrade an item in your collection to Gold, Diamond, or Rainbow')
                .addStringOption(opt => opt.setName('query').setDescription('Artist - Album or Artist name').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('top')
                .setDescription('View the Collection Value leaderboard')
        )
        .addSubcommand(sub =>
            sub.setName('quests')
                .setDescription('View and claim daily album quests')
        )
        .addSubcommand(sub =>
            sub.setName('store')
                .setDescription('Buy specialized booster packs with guaranteed effects')
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const channel = interactionOrMessage.channel as TextChannel;
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const subcommand = isSlash ? interactionOrMessage.options.getSubcommand() : (args?.[0] || 'roll');

        if (subcommand === 'roll' || subcommand === 'r') {
            await this.handleRoll(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'collection' || subcommand === 'c' || subcommand === 'inv') {
            await this.handleCollection(interactionOrMessage, isSlash, userId, channel, 0);
        } else if (subcommand === 'profile' || subcommand === 'p') {
            await this.handleProfile(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'wish' || subcommand === 'w') {
            await this.handleWishlist(interactionOrMessage, isSlash, userId, channel, args);
        } else if (subcommand === 'market' || subcommand === 'm' || subcommand === 'shop') {
            await this.handleMarket(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'daily' || subcommand === 'd') {
            await this.handleDaily(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'balance' || subcommand === 'b' || subcommand === 'bal') {
            await this.handleBalance(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'polish') {
            await this.handlePolish(interactionOrMessage, isSlash, userId, channel, args);
        } else if (subcommand === 'top' || subcommand === 'leaderboard') {
            await this.handleLeaderboard(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'quests' || subcommand === 'q') {
            await this.handleQuests(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'roster' || subcommand === 'artists') {
            await this.handleRoster(interactionOrMessage, isSlash, userId, channel, 0);
        } else if (subcommand === 'store' || subcommand === 's' || subcommand === 'packs') {
            await this.handleStore(interactionOrMessage, isSlash, userId, channel);
        }
    }

    private async handleRoll(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        try {
            const dbUser = await prisma.user.findUnique({ where: { discordId } });
            if (!dbUser) {
                const msg = '❌ Link your account first with `/login`!';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            // 1. Quota & Cooldown Check (10 turns / 30 minutes)
            const COOLDOWN_MS = 30 * 60 * 1000;
            const MAX_ROLLS = 10;
            const now = Date.now();

            let rolls = dbUser.albumRolls;
            const lastRoll = dbUser.lastAlbumRoll;

            // If cooldown has passed, reset quota
            if (lastRoll && (now - lastRoll.getTime() >= COOLDOWN_MS)) {
                rolls = 0;
            }

            // Check if quota exhausted
            if (rolls >= MAX_ROLLS && lastRoll && (now - lastRoll.getTime() < COOLDOWN_MS)) {
                const remaining = Math.ceil((COOLDOWN_MS - (now - lastRoll.getTime())) / 60000);
                const msg = `⏳ Quota exhausted! You need to wait **${remaining}m** before your next batch of rolls.`;
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            // 2. Roll for Item
            const roll = await AlbumGameService.rollItem(discordId);
            if (!roll) {
                const msg = '😢 No items found in the pool. Try again later.';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            // Increment rolls
            const newRolls = rolls + 1;
            await prisma.user.update({
                where: { discordId },
                data: {
                    albumRolls: newRolls,
                    lastAlbumRoll: newRolls >= MAX_ROLLS ? new Date() : (rolls === 0 ? null : dbUser.lastAlbumRoll)
                }
            });

            // Proxy the image to Discord CDN
            const proxiedImage = await this.proxyImage(roll.image, interactionOrMessage.client);

            // RPG: Check for duplicates
            const isOwned = await AlbumGameService.isOwned(discordId, roll.type, roll.itemId);
            const scrapValue = AlbumGameService.getScrapValue(roll.rarity);

            // RPG: Check for wishlists
            const wishers = await AlbumGameService.getWishers(roll.itemId);
            const isWish = wishers.length > 0;

            // 3. Build Card UI
            let color = isWish ? 0xFF007F : AlbumGameService.getRarityColor(roll.rarity);
            if (roll.variant === 'HOLOGRAPHIC') color = 0x00FFFF;
            if (roll.variant === 'ERROR') color = 0xFF0000;
            if (roll.variant === 'GLITCH') color = 0x39FF14; // Neon Green

            let flavorText = this.getFlavorText(roll.rarity);
            if (isWish) flavorText = `✨ **A DIVINE MANIFESTATION!** ✨`;
            if (roll.variant === 'HOLOGRAPHIC') flavorText = `🌈 **HOLOGRAPHIC VARIANT!** ` + flavorText;
            if (roll.variant === 'ERROR') flavorText = `⚠️ **ERROR VARIANT!** ` + flavorText;
            if (roll.variant === 'GLITCH') flavorText = `👾 **G L I T C H  A N O M A L Y!** ` + flavorText;

            const titleText = roll.type === 'ALBUM'
                ? `**${roll.artistName}** — **${roll.albumName}**`
                : `**${roll.artistName}**`;

            // RENDER CARD if special
            let displayImage = roll.image;
            let attachment: AttachmentBuilder | null = null;
            if (roll.variant === 'HOLOGRAPHIC' || roll.variant === 'ERROR' || roll.variant === 'GLITCH') {
                const buffer = await AlbumRenderService.renderVariant({
                    image: roll.image,
                    variant: roll.variant
                });
                attachment = new AttachmentBuilder(buffer, { name: 'variant.png' });
                displayImage = 'attachment://variant.png';
            } else if (roll.rarity === 'LEGENDARY' || roll.rarity === 'EPIC') {
                const buffer = await AlbumRenderService.renderAlbumCard({
                    artistName: roll.artistName,
                    albumName: roll.albumName,
                    image: roll.image,
                    rarity: roll.rarity as any,
                    variant: roll.variant
                });
                attachment = new AttachmentBuilder(buffer, { name: 'card.png' });
                displayImage = 'attachment://card.png';
            } else {
                // Proxy the normal image to Discord CDN
                const proxied = await this.proxyImage(roll.image, interactionOrMessage.client);
                displayImage = proxied || roll.image;
            }

            const builder = new ComponentsV2()
                .setAccent(color)
                .addText(`### 🎲 ${roll.type} ROLL\n${flavorText}\n${titleText}`)
                .setImage(displayImage);

            const payload = builder.build();
            if (attachment) payload.files = [attachment];

            if (isOwned) {
                builder.addText(`\n💿 **Duplicate!** You already own this item.\nConverted into **${scrapValue} Vinyls**.`);
                builder.addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant} • Rolls Left: ${MAX_ROLLS - newRolls}`);
                await AlbumGameService.awardVinyls(discordId, scrapValue);

                isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
                return;
            }

            if (isWish) {
                const wisherMentions = wishers.map(id => `<@${id}>`).join(', ');
                builder.addText(`\n🌟 **On wishlist of:** ${wisherMentions}`);
            }

            builder.addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant} • Rolls Left: ${MAX_ROLLS - newRolls} • Exclusive: 15s`);

            // Claim Button
            const claimId = `claim_item:${roll.type}:${roll.itemId}:${roll.rarity}:${roll.variant}:${Date.now()}`;
            builder.addAction(`-# Priority claim for <@${discordId}>`, {
                type: ComponentType.Button,
                custom_id: claimId,
                label: `Claim ${roll.type === 'ALBUM' ? 'Album' : 'Artist'}`,
                emoji: { name: '📥' },
                style: ButtonStyle.Primary
            });

            const rollMsg = isSlash
                ? await interactionOrMessage.editReply(payload)
                : await channel.send(payload);

            // 4. Interaction Collector
            const collector = rollMsg.createMessageComponentCollector({
                filter: (i: any) => i.customId === claimId,
                time: 45000,
                max: 1
            });

            // Timer for Sniping
            let isSnipable = false;
            let isClaimed = false;
            setTimeout(async () => {
                if (isClaimed) return;
                isSnipable = true;
                builder.addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant} • Rolls Left: ${MAX_ROLLS - newRolls} • OPEN FOR SNIPING!`);
                builder.payload.components[builder.payload.components.length - 2].components[0].content = `-# 🔓 **Open for anyone to claim!**`;
                await rollMsg.edit(builder.build()).catch(() => { });
            }, 15000);

            collector.on('collect', async (i: any) => {
                // Sniping Logic
                if (i.user.id !== discordId && !isSnipable) {
                    return i.reply({ content: '❌ Wait for the 15s priority window to end before sniping!', ephemeral: true });
                }

                await i.deferUpdate();
                const claimResult = await AlbumGameService.claimItem(i.user.id, roll.type, roll.itemId, roll.rarity, roll.variant);

                if (claimResult.success) {
                    isClaimed = true;
                    const claimedBuilder = new ComponentsV2()
                        .setAccent(0x4ade80)
                        .addText(`### ✅ ${roll.type} ${i.user.id === discordId ? 'CLAIMED' : 'SNIPED'}!\n${titleText} added to <@${i.user.id}>'s collection.`);

                    if (claimResult.message) {
                        claimedBuilder.addText(`\n\n${claimResult.message}`);
                    }

                    claimedBuilder
                        .setThumbnail(roll.image)
                        .addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant}`);

                    await i.editReply(claimedBuilder.build());
                } else {
                    await i.followUp({ content: '❌ Failed to claim. You might already own this or your quota is full!', ephemeral: true });
                }
            });

            collector.on('end', async (collected: any) => {
                if (collected.size === 0 && !isClaimed) {
                    const expiredBuilder = new ComponentsV2()
                        .setAccent(0x333333)
                        .addText(`### 🎲 ${roll.type} ROLL\n❌ **Claim period expired.**\n${titleText} returned to the pool.`)
                        .addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant}`);

                    if (isSlash) await interactionOrMessage.editReply(expiredBuilder.build());
                    else await rollMsg.edit(expiredBuilder.build()).catch(() => { });
                }
            });

        } catch (err) {
            console.error('Album Roll Error:', err);
            const msg = '⚠️ Failed to generate roll.';
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
        }
    }

    private async handleCollection(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, startPage = 0, overrideTargetId?: string): Promise<void> {
        const targetId = overrideTargetId || (isSlash && interactionOrMessage.options?.getUser
            ? (interactionOrMessage.options.getUser('user')?.id || discordId)
            : discordId);

        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        else if (!isSlash && startPage === 0) { try { channel.sendTyping(); } catch { } }

        const totalResult = await AlbumGameService.getCollection(targetId, 0, 1);
        if (!totalResult || totalResult.count === 0) {
            const msg = targetId === discordId ? '❌ Your collection is empty! Use `/album roll` to start.' : `❌ <@${targetId}>'s collection is empty.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }
        const totalItems = totalResult.count;
        let currentPage = Math.max(0, Math.min(startPage, totalItems - 1));
        let listPage = 0;
        const LIST_LIMIT = 10;

        // ── Card mode payload ──
        const buildCardPayload = async (page: number) => {
            const collection = await AlbumGameService.getCollection(targetId, page, 1);
            const item = collection!.items[0];
            const artist = item.album.artist.name;
            const albumName = item.album.name;
            const rarity = item.rarity as AlbumRarity;

            const claimedDate = new Date(item.claimedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

            // ── 1. CHECK RENDER CACHE ──
            const cacheKey = `${albumName}:${rarity}:${item.variant}:${item.polishLevel}`;
            let cdnUrl = await RenderCacheService.getCachedImage('album_card', artist, cacheKey);
            let cardBuffer: Buffer | null = null;

            if (!cdnUrl) {
                const resolved = await TrackResolverService.resolveAlbum(artist, albumName);
                const artworkUrl = resolved.artworkUrl || item.album.imageLarge || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

                if (item.variant === 'HOLOGRAPHIC' || item.variant === 'ERROR' || item.variant === 'GLITCH') {
                    cardBuffer = await AlbumRenderService.renderVariant({
                        image: artworkUrl,
                        variant: item.variant
                    });
                } else {
                    cardBuffer = await AlbumRenderService.renderAlbumCard({
                        artistName: artist,
                        albumName: albumName,
                        image: artworkUrl,
                        rarity: rarity,
                        variant: item.variant,
                        polishLevel: item.polishLevel
                    });
                }

                // ── 2. UPLOAD TO STAGING CHANNEL FOR CDN URL ──
                const stagingChannelId = config.CHART_STAGING_CHANNEL_ID;
                const client = interactionOrMessage.client;
                if (stagingChannelId && client) {
                    try {
                        const stagingChannel = await client.channels.fetch(stagingChannelId) as TextChannel;
                        if (stagingChannel?.type === ChannelType.GuildText) {
                            const att = new AttachmentBuilder(cardBuffer, { name: `album_${item.album.id}.webp` });
                            const stagingMsg = await stagingChannel.send({ files: [att] });
                            cdnUrl = stagingMsg.attachments.first()?.url || null;

                            if (cdnUrl) {
                                await RenderCacheService.setCachedImage('album_card', artist, cacheKey, cdnUrl);
                                setTimeout(() => stagingMsg.delete().catch(() => { }), 86400000);
                            }
                        }
                    } catch (e) {
                        console.warn('[album] Staging upload failed:', e);
                    }
                }
            }

            const builder = new ComponentsV2()
                .setAccent(AlbumGameService.getRarityColor(rarity))
                .addText(`### 🗃️ ALBUM ARCHIVE (#${page + 1}/${totalItems})\nViewing collection for <@${targetId}>\n-# 📅 Claimed on ${claimedDate}`)
                .setImage(cdnUrl ?? 'attachment://album_card.webp');

            const row: any[] = [];
            if (page > 0) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Back', custom_id: 'col_prev', emoji: { name: '⬅️' }
            });
            row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'List', custom_id: 'col_list', emoji: { name: '📋' }
            });
            if (page < totalItems - 1) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Next', custom_id: 'col_next', emoji: { name: '➡️' }
            });
            builder.addRow(row);

            const payload: any = builder.build();
            if (!cdnUrl) {
                if (!cardBuffer) {
                    const resolved = await TrackResolverService.resolveAlbum(artist, albumName);
                    const artworkUrl = resolved.artworkUrl || item.album.imageLarge || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

                    if (item.variant === 'HOLOGRAPHIC' || item.variant === 'ERROR' || item.variant === 'GLITCH') {
                        cardBuffer = await AlbumRenderService.renderVariant({
                            image: artworkUrl,
                            variant: item.variant
                        });
                    } else {
                        cardBuffer = await AlbumRenderService.renderAlbumCard({
                            artistName: artist,
                            albumName: albumName,
                            image: artworkUrl,
                            rarity: rarity,
                            variant: item.variant,
                            polishLevel: item.polishLevel
                        });
                    }
                }
                payload.files = [new AttachmentBuilder(cardBuffer, { name: 'album_card.webp' })];
            }
            return payload;
        };

        // ── List mode payload ──
        const buildListPayload = async (lPage: number) => {
            const totalListPages = Math.ceil(totalItems / LIST_LIMIT);
            const collection = await AlbumGameService.getCollection(targetId, lPage, LIST_LIMIT);

            let listText = '';
            for (const item of collection!.items) {
                const rarityEmoji = this.getRarityEmoji(item.rarity as AlbumRarity);
                const claimed = new Date(item.claimedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                listText += `${rarityEmoji} **${item.album.artist.name}** — ${item.album.name}\n-# 📅 ${claimed}\n`;
            }

            const builder = new ComponentsV2()
                .setAccent(0x5865F2)
                .addText(`### 📋 ALBUM COLLECTION (${lPage + 1}/${totalListPages})\nViewing collection for <@${targetId}>\n\n${listText}`);

            const row: any[] = [];
            if (lPage > 0) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Back', custom_id: 'col_list_prev', emoji: { name: '⬅️' }
            });
            row.push({
                type: ComponentType.Button, style: ButtonStyle.Primary,
                label: 'Card View', custom_id: 'col_card', emoji: { name: '🖼️' }
            });
            if (lPage < totalListPages - 1) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Next', custom_id: 'col_list_next', emoji: { name: '➡️' }
            });
            builder.addRow(row);

            return builder.build();
        };

        // Initial send
        const payload = await buildCardPayload(currentPage);
        const msg = isSlash
            ? await interactionOrMessage.editReply(payload)
            : await channel.send(payload);

        // Single persistent collector handling all modes
        const COL_IDS = ['col_prev', 'col_next', 'col_list', 'col_card', 'col_list_prev', 'col_list_next'];
        const collector = msg.createMessageComponentCollector({
            filter: (i: any) => COL_IDS.includes(i.customId),
            time: 300000
        });

        collector.on('collect', async (i: any) => {
            if (i.user.id !== discordId) {
                return i.reply({ content: '❌ Open your own collection to browse!', ephemeral: true });
            }
            await i.deferUpdate();

            switch (i.customId) {
                case 'col_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'col_next':
                    currentPage = Math.min(totalItems - 1, currentPage + 1);
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'col_list':
                    await i.editReply(await buildListPayload(listPage));
                    break;
                case 'col_card':
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'col_list_prev':
                    listPage = Math.max(0, listPage - 1);
                    await i.editReply(await buildListPayload(listPage));
                    break;
                case 'col_list_next':
                    listPage = Math.min(Math.ceil(totalItems / LIST_LIMIT) - 1, listPage + 1);
                    await i.editReply(await buildListPayload(listPage));
                    break;
            }
        });
    }


    private async handleRoster(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, startPage = 0, overrideTargetId?: string): Promise<void> {
        const targetId = overrideTargetId || (isSlash && interactionOrMessage.options?.getUser
            ? (interactionOrMessage.options.getUser('user')?.id || discordId)
            : discordId);

        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        else if (!isSlash && startPage === 0) { try { channel.sendTyping(); } catch { } }

        const totalResult = await AlbumGameService.getArtistCollection(targetId, 0, 1);
        if (!totalResult || totalResult.count === 0) {
            const msg = targetId === discordId ? '❌ Your artist roster is empty! Use `/album roll` to start.' : `❌ <@${targetId}>'s artist roster is empty.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }
        const totalItems = totalResult.count;
        let currentPage = Math.max(0, Math.min(startPage, totalItems - 1));
        let listPage = 0;
        const LIST_LIMIT = 10;

        // ── Card mode payload ──
        const buildCardPayload = async (page: number) => {
            const collection = await AlbumGameService.getArtistCollection(targetId, page, 1);
            const item = collection!.items[0];
            const artist = item.artist.name;
            const rarity = item.rarity as AlbumRarity;

            const claimedDate = new Date(item.claimedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

            // ── 1. CHECK RENDER CACHE ──
            const cacheKey = `artist:${artist}:${rarity}:${item.variant}:${item.polishLevel}`;
            let cdnUrl = await RenderCacheService.getCachedImage('artist_card', artist, cacheKey);
            let cardBuffer: Buffer | null = null;

            if (!cdnUrl) {
                const res = await TrackResolverService.resolveArtist(artist);
                const artworkUrl = res.avatarUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

                if (item.variant === 'HOLOGRAPHIC' || item.variant === 'ERROR' || item.variant === 'GLITCH') {
                    cardBuffer = await AlbumRenderService.renderVariant({
                        image: artworkUrl,
                        variant: item.variant
                    });
                } else if (item.variant === 'RAID') {
                    cardBuffer = await AlbumRenderService.renderRaidAnimation({
                        artistName: artist,
                        image: artworkUrl
                    });
                } else {
                    cardBuffer = await AlbumRenderService.renderAlbumCard({
                        artistName: 'OFFICIAL ARTIST',
                        albumName: artist,
                        image: artworkUrl,
                        rarity: rarity,
                        variant: item.variant,
                        polishLevel: item.polishLevel
                    });
                }

                // ── 2. UPLOAD TO STAGING CHANNEL FOR CDN URL ──
                const stagingChannelId = config.CHART_STAGING_CHANNEL_ID;
                const client = interactionOrMessage.client;
                if (stagingChannelId && client) {
                    try {
                        const stagingChannel = await client.channels.fetch(stagingChannelId) as TextChannel;
                        if (stagingChannel?.type === ChannelType.GuildText) {
                            const att = new AttachmentBuilder(cardBuffer, { name: `artist_${item.artist.id}.webp` });
                            const stagingMsg = await stagingChannel.send({ files: [att] });
                            cdnUrl = stagingMsg.attachments.first()?.url || null;

                            if (cdnUrl) {
                                await RenderCacheService.setCachedImage('artist_card', artist, cacheKey, cdnUrl);
                                setTimeout(() => stagingMsg.delete().catch(() => { }), 86400000);
                            }
                        }
                    } catch (e) {
                        console.warn('[roster] Staging upload failed:', e);
                    }
                }
            }

            const builder = new ComponentsV2()
                .setAccent(AlbumGameService.getRarityColor(rarity))
                .addText(`### 🎭 ARTIST ROSTER (#${page + 1}/${totalItems})\nViewing roster for <@${targetId}>\n-# 📅 Collected on ${claimedDate}`)
                .setImage(cdnUrl ?? 'attachment://artist_card.webp');

            const row: any[] = [];
            if (page > 0) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Back', custom_id: 'ros_prev', emoji: { name: '⬅️' }
            });
            row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'List', custom_id: 'ros_list', emoji: { name: '📋' }
            });
            if (page < totalItems - 1) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Next', custom_id: 'ros_next', emoji: { name: '➡️' }
            });
            builder.addRow(row);

            const payload: any = builder.build();
            if (!cdnUrl) {
                if (!cardBuffer) {
                    const res = await TrackResolverService.resolveArtist(artist);
                    const artworkUrl = res.avatarUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';

                    if (item.variant === 'HOLOGRAPHIC' || item.variant === 'ERROR' || item.variant === 'GLITCH') {
                        cardBuffer = await AlbumRenderService.renderVariant({
                            image: artworkUrl,
                            variant: item.variant
                        });
                    } else if (item.variant === 'RAID') {
                        cardBuffer = await AlbumRenderService.renderRaidAnimation({
                            artistName: artist,
                            image: artworkUrl
                        });
                    } else {
                        cardBuffer = await AlbumRenderService.renderAlbumCard({
                            artistName: 'OFFICIAL ARTIST',
                            albumName: artist,
                            image: artworkUrl,
                            rarity: rarity,
                            variant: item.variant,
                            polishLevel: item.polishLevel
                        });
                    }
                }
                payload.files = [new AttachmentBuilder(cardBuffer, { name: 'artist_card.webp' })];
            }
            return payload;
        };

        // ── List mode payload ──
        const buildListPayload = async (lPage: number) => {
            const totalListPages = Math.ceil(totalItems / LIST_LIMIT);
            const collection = await AlbumGameService.getArtistCollection(targetId, lPage, LIST_LIMIT);

            let listText = '';
            for (const item of collection!.items) {
                const rarityEmoji = this.getRarityEmoji(item.rarity as AlbumRarity);
                const claimed = new Date(item.claimedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                listText += `${rarityEmoji} **${item.artist.name}**\n-# 📅 ${claimed}\n`;
            }

            const builder = new ComponentsV2()
                .setAccent(0x5865F2)
                .addText(`### 📋 ARTIST ROSTER (${lPage + 1}/${totalListPages})\nViewing roster for <@${targetId}>\n\n${listText}`);

            const row: any[] = [];
            if (lPage > 0) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Back', custom_id: 'ros_list_prev', emoji: { name: '⬅️' }
            });
            row.push({
                type: ComponentType.Button, style: ButtonStyle.Primary,
                label: 'Card View', custom_id: 'ros_card', emoji: { name: '🖼️' }
            });
            if (lPage < totalListPages - 1) row.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Next', custom_id: 'ros_list_next', emoji: { name: '➡️' }
            });
            builder.addRow(row);

            return builder.build();
        };

        // Initial send
        const payload = await buildCardPayload(currentPage);
        const msg = isSlash
            ? await interactionOrMessage.editReply(payload)
            : await channel.send(payload);

        // Single persistent collector handling all modes
        const COL_IDS = ['ros_prev', 'ros_next', 'ros_list', 'ros_card', 'ros_list_prev', 'ros_list_next'];
        const collector = msg.createMessageComponentCollector({
            filter: (i: any) => COL_IDS.includes(i.customId),
            time: 300000
        });

        collector.on('collect', async (i: any) => {
            if (i.user.id !== discordId) {
                return i.reply({ content: '❌ Open your own roster to browse!', ephemeral: true });
            }
            await i.deferUpdate();

            switch (i.customId) {
                case 'ros_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'ros_next':
                    currentPage = Math.min(totalItems - 1, currentPage + 1);
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'ros_list':
                    await i.editReply(await buildListPayload(listPage));
                    break;
                case 'ros_card':
                    await i.editReply(await buildCardPayload(currentPage));
                    break;
                case 'ros_list_prev':
                    listPage = Math.max(0, listPage - 1);
                    await i.editReply(await buildListPayload(listPage));
                    break;
                case 'ros_list_next':
                    listPage = Math.min(Math.ceil(totalItems / LIST_LIMIT) - 1, listPage + 1);
                    await i.editReply(await buildListPayload(listPage));
                    break;
            }
        });
    }


    private async handleProfile(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        const targetId = isSlash ? (interactionOrMessage.options.getUser('user')?.id || discordId) : discordId;

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const dbUser = await prisma.user.findUnique({
            where: { discordId: targetId },
            include: { gameProfile: true }
        });

        if (!dbUser) {
            isSlash ? await interactionOrMessage.editReply('❌ User not found.') : await channel.send('❌ User not found.');
            return;
        }

        const profile = dbUser.gameProfile || await AlbumGameService.getGameProfile(targetId);
        const collection = await AlbumGameService.getCollection(targetId, 0, 1); // Get count

        // Fetch Last.fm info for thumbnail
        let lfmInfo: any = null;
        try {
            if (dbUser.lastfmUsername) {
                lfmInfo = await LastFM.getUserInfo(dbUser.lastfmUsername, dbUser.lastfmSessionKey);
            }
        } catch (err) {
            console.warn(`[AlbumCommand] Failed to fetch Last.fm info for ${dbUser.lastfmUsername}:`, err instanceof Error ? err.message : err);
        }

        const thumbnail = lfmInfo?.image?.find((img: any) => img.size === 'extralarge')?.['#text']
            || lfmInfo?.image?.find((img: any) => img.size === 'large')?.['#text'];

        const settings = dbUser.settings as any;
        const color = settings?.embedColor ? parseInt(settings.embedColor.replace('#', ''), 16) : 0x5865F2;

        const builder = new ComponentsV2()
            .setAccent(color);

        let mainText = `### 👤 SOUNDSCAPE PROFILE: <@${targetId}>\n`;
        mainText += `📀 **Collection**: \`${collection?.count || 0}\` albums\n`;
        mainText += `💿 **Vinyls**: **${profile.vinylScraps}**\n`;
        mainText += `⭐ **Wishlist**: \`${profile.wishlist.length}/5\` slots used\n`;

        if (lfmInfo) {
            mainText += `📊 **Total Scrobbles**: \`${parseInt(lfmInfo.playcount).toLocaleString()}\` plays\n`;
        }

        builder.addThumbnail(thumbnail, mainText);

        if (profile.wishlist.length > 0) {
            const albums = await prisma.album.findMany({
                where: { id: { in: profile.wishlist } },
                include: { artist: true }
            });
            let wishText = '';
            albums.forEach(a => wishText += `- ${a.artist.name} — **${a.name}**\n`);
            builder.addText(`\n**CURRENT WISHES:**\n${wishText}`);
        } else {
            builder.addText(`\n-# *Wishlist is empty. Use \`/album wish\` to manifest albums!*`);
        }

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }

    private async handleWishlist(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, args?: string[]): Promise<void> {
        const query = isSlash ? interactionOrMessage.options.getString('query') : args?.slice(1).join(' ');
        if (!query) {
            const msg = '❌ Usage: `/album wish Artist Album` or `/album wish Artist - Album`';
            isSlash ? await interactionOrMessage.reply(msg) : await channel.send(msg);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const reply = (msg: string) => isSlash ? interactionOrMessage.editReply(msg) : channel.send(msg);

        // Smart fuzzy search strategy:
        // 1. If there's a dash, try "Artist - Album" split first
        // 2. Also try fuzzy DB search on raw query
        // 3. Fall back to API resolver

        let dbAlbum: any = null;

        // Strategy 1: dash split → exact DB match
        if (query.includes('-')) {
            const dashIdx = query.indexOf('-');
            const artistPart = query.substring(0, dashIdx).trim();
            const albumPart = query.substring(dashIdx + 1).trim();

            if (artistPart && albumPart) {
                dbAlbum = await prisma.album.findFirst({
                    where: {
                        name: { contains: albumPart, mode: 'insensitive' },
                        artist: { name: { contains: artistPart, mode: 'insensitive' } }
                    },
                    include: { artist: true }
                });
            }
        }

        // Strategy 2: fuzzy DB search — treat whole query as album name
        if (!dbAlbum) {
            // Try to find an album whose name contains some part of the query
            const words = query.split(/\s+/);
            // Try full query as album name first
            dbAlbum = await prisma.album.findFirst({
                where: { name: { contains: query, mode: 'insensitive' } },
                include: { artist: true }
            });

            // If not found, try matching any 3+ consecutive words
            if (!dbAlbum && words.length >= 2) {
                for (let len = words.length; len >= 2; len--) {
                    for (let start = 0; start <= words.length - len; start++) {
                        const phrase = words.slice(start, start + len).join(' ');
                        const found = await prisma.album.findFirst({
                            where: { name: { contains: phrase, mode: 'insensitive' } },
                            include: { artist: true }
                        });
                        if (found) { dbAlbum = found; break; }
                    }
                    if (dbAlbum) break;
                }
            }
        }

        // Strategy 3: API resolver with smart guess using Spotify search
        if (!dbAlbum) {
            const spMatch = await Spotify.searchAlbum(query);
            if (spMatch && spMatch.artist && spMatch.album) {
                const dbArtist = await prisma.artist.findFirst({ where: { name: { contains: spMatch.artist, mode: 'insensitive' } } });
                if (dbArtist) {
                    dbAlbum = await prisma.album.findFirst({
                        where: { artistId: dbArtist.id, name: { contains: spMatch.album, mode: 'insensitive' } },
                        include: { artist: true }
                    });
                }
            }
        }

        if (!dbAlbum) {
            await reply(`❌ Couldn't find **"${query}"** in anyone's collection yet. Try being more specific or check the spelling!`);
            return;
        }

        const profile = await AlbumGameService.getGameProfile(discordId);
        const isOnWishlist = profile?.wishlist.includes(dbAlbum.id);


        if (isOnWishlist) {
            await AlbumGameService.updateWishlist(discordId, dbAlbum.id, 'remove');
            const msg = `✅ Removed **${dbAlbum.name}** from your wishlist.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
        } else {
            const success = await AlbumGameService.updateWishlist(discordId, dbAlbum.id, 'add');
            if (success) {
                const msg = `✨ Added **${dbAlbum.name}** to your wishlist!`;
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            } else {
                const msg = '❌ Your wishlist is full (max 5)!';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            }
        }
    }


    private async handleMarket(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        let items = await AlbumGameService.getMarketItems();
        const isExpired = items.length > 0 && items[0].expiresAt && items[0].expiresAt < new Date();

        if (items.length === 0 || isExpired) {
            await AlbumGameService.refreshMarket();
            items = await AlbumGameService.getMarketItems();
        }

        if (items.length === 0) {
            const msg = '_The market is currently empty. Check back soon!_';
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        const profile = await AlbumGameService.getGameProfile(discordId);
        let currentIndex = 0;

        const buildPayload = async (idx: number) => {
            const item = items[idx];
            const expiresAt = item.expiresAt;
            const msLeft = expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : 0;
            const hoursLeft = Math.floor(msLeft / 3600000);
            const minsLeft = Math.floor((msLeft % 3600000) / 60000);
            const timeStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;
            const rarityEmoji = this.getRarityEmoji(item.rarity as AlbumRarity);
            const color = AlbumGameService.getRarityColor(item.rarity as AlbumRarity);

            // Cache-backed artwork
            const resolved = await TrackResolverService.resolveAlbum(item.album.artist.name, item.album.name);
            let proxiedImage = await AlbumGameService.getCachedProxyUrl(resolved.artworkUrl || '');
            if (!proxiedImage && resolved.artworkUrl) {
                proxiedImage = await this.proxyImage(resolved.artworkUrl, interactionOrMessage.client);
                if (proxiedImage) await AlbumGameService.cacheProxyUrl(resolved.artworkUrl, proxiedImage);
            }

            const fallbackImage = item.album.imageLarge || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
            const finalImageUrl = proxiedImage || resolved.artworkUrl || fallbackImage;

            const builder = new ComponentsV2()
                .setAccent(color)
                .addText(`### 🏪 GLOBAL MARKET (#${idx + 1}/${items.length})\n`)
                .addText(`${rarityEmoji} **${item.album.artist.name}** — **${item.album.name}**\n`)
                .addText(`Price: **${item.price}** 💿  |  Balance: **${profile?.vinylScraps || 0}** 💿\n`)
                .addText(`\n-# ⏳ Refreshes in **${timeStr}**`);

            let files = [];
            if (item.isSold) {
                builder.addText(`\n\n> ⚠️ **SOLD OUT** — This album has already been claimed!`);

                // Only render premium card for SOLD OUT state
                const cardBuffer = await AlbumRenderService.renderMarketCard({
                    artistName: item.album.artist.name,
                    albumName: item.album.name,
                    image: finalImageUrl,
                    rarity: item.rarity as AlbumRarity,
                    isSold: true
                });

                builder.setImage('attachment://sold_out.webp');
                files.push({ attachment: cardBuffer, name: 'sold_out.webp' });
            } else {
                // Use raw image for available albums (fast & simple)
                builder.setImage(finalImageUrl);
            }

            const navRow: any[] = [];
            if (idx > 0) navRow.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Prev', custom_id: 'mkt_prev', emoji: { name: '⬅️' }
            });
            navRow.push({
                type: ComponentType.Button, style: item.isSold ? ButtonStyle.Secondary : ButtonStyle.Primary,
                label: item.isSold ? 'Sold Out' : `Buy for ${item.price} Vinyls`,
                custom_id: `mkt_buy:${item.id}`,
                emoji: { name: item.isSold ? '🚫' : '🛒' },
                disabled: item.isSold
            });
            if (idx < items.length - 1) navRow.push({
                type: ComponentType.Button, style: ButtonStyle.Secondary,
                label: 'Next', custom_id: 'mkt_next', emoji: { name: '➡️' }
            });
            builder.addRow(navRow);

            return { ...builder.build(), files };
        };

        // Initial send
        const payload = await buildPayload(currentIndex);
        const msg = isSlash
            ? await interactionOrMessage.editReply(payload)
            : await channel.send(payload);

        // Single stateful collector — no recursion
        const collector = msg.createMessageComponentCollector({
            filter: (i: any) => i.customId.startsWith('mkt_'),
            time: 120000
        });

        collector.on('collect', async (i: any) => {
            if (i.user.id !== discordId) {
                return i.reply({ content: '❌ Open the market yourself to browse!', ephemeral: true });
            }

            await i.deferUpdate();

            if (i.customId === 'mkt_prev') {
                currentIndex = Math.max(0, currentIndex - 1);
                await i.editReply(await buildPayload(currentIndex));

            } else if (i.customId === 'mkt_next') {
                currentIndex = Math.min(items.length - 1, currentIndex + 1);
                await i.editReply(await buildPayload(currentIndex));

            } else if (i.customId.startsWith('mkt_buy:')) {
                const marketId = i.customId.split(':')[1];
                const result = await AlbumGameService.buyFromMarket(i.user.id, marketId);
                if (result.success) {
                    await i.followUp({ content: `✅ **Purchase Complete!**\n${result.msg}`, ephemeral: true });

                    // Refresh items and view
                    items = await AlbumGameService.getMarketItems();
                    await i.editReply(await buildPayload(currentIndex));
                } else {
                    await i.followUp({ content: `❌ ${result.msg}`, ephemeral: true });
                }
            }
        });
    }


    private async handleDaily(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const result = await AlbumGameService.claimDaily(discordId);

        if (result.success) {
            const builder = new ComponentsV2()
                .setAccent(0x4ade80)
                .addText(`### 🎁 DAILY REWARDS CLAIMED!\n\n`)
                .addText(`💿 Received **${result.scraps} Vinyls**\n`)
                .addText(`🎲 **Roll Quota Reset!** (You can roll 10 times again)\n\n`)
                .addFooter(`Come back in 6 hours for more!`);

            const payload = builder.build();
            isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
        } else {
            if (result.cooldown) {
                const hours = Math.floor(result.cooldown / 3600000);
                const minutes = Math.floor((result.cooldown % 3600000) / 60000);
                const msg = `⏳ You've already claimed your daily! Come back in **${hours}h ${minutes}m**.`;
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            } else {
                const msg = '❌ Failed to claim daily rewards.';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            }
        }
    }

    private async handleBalance(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        const targetId = isSlash ? (interactionOrMessage.options.getUser('user')?.id || discordId) : discordId;

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const profile = await AlbumGameService.getGameProfile(targetId);
        if (!profile) {
            isSlash ? await interactionOrMessage.editReply('❌ User not found.') : await channel.send('❌ User not found.');
            return;
        }

        const msg = targetId === discordId
            ? `💳 You have **${profile.vinylScraps}** Vinyls.`
            : `💳 <@${targetId}> has **${profile.vinylScraps}** Vinyls.`;

        isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
    }

    private async handlePolish(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, args?: string[]): Promise<void> {
        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        const query = isSlash ? interactionOrMessage.options.getString('query') : args?.slice(1).join(' ');

        const dbUser = await prisma.user.findUnique({ where: { discordId }, include: { gameProfile: true } });
        if (!dbUser || !dbUser.gameProfile) return;

        // --- Helper Function to execute polish upgrade ---
        const executePolish = async (item: any, isArtist: boolean, interactionOrMsgObj: any) => {
            if (item.polishLevel >= 3) {
                const msg = `✨ This item is already maxed out at **Rainbow Polish**!`;
                if (interactionOrMsgObj.editReply) {
                    await interactionOrMsgObj.editReply({ content: msg, components: [] });
                } else {
                    await channel.send(msg);
                }
                return;
            }

            const costs = [1000, 5000, 15000];
            const nextLevel = item.polishLevel + 1;
            const cost = costs[item.polishLevel];

            if (dbUser.gameProfile!.vinylScraps < cost) {
                const msg = `❌ You need **${cost} Vinyls** to upgrade to Level ${nextLevel}. You only have ${dbUser.gameProfile!.vinylScraps}.`;
                if (interactionOrMsgObj.editReply) {
                    await interactionOrMsgObj.editReply({ content: msg, components: [] });
                } else {
                    await channel.send(msg);
                }
                return;
            }

            // Deduct & Upgrade
            await prisma.userGameProfile.update({
                where: { userId: dbUser.id },
                data: { vinylScraps: { decrement: cost }, collectionValue: { increment: cost } }
            });

            if (isArtist) {
                await prisma.userArtistCollection.update({
                    where: { id: item.id },
                    data: { polishLevel: nextLevel }
                });
            } else {
                await prisma.userAlbumCollection.update({
                    where: { id: item.id },
                    data: { polishLevel: nextLevel }
                });
            }

            const levelNames = ['None', 'Gold 🥇', 'Diamond 💎', 'Rainbow 🌈'];
            const nameText = isArtist ? `**${item.artist.name}**` : `**${item.album.artist.name}** — **${item.album.name}**`;
            const msg = `✨ Successfully polished ${nameText} to **${levelNames[nextLevel]}** for ${cost} Vinyls!`;
            if (interactionOrMsgObj.editReply) {
                await interactionOrMsgObj.editReply({ content: msg, components: [] });
            } else {
                await channel.send(msg);
            }
        };

        if (!query) {
            // Interactive Select Menu mode
            const albums = await prisma.userAlbumCollection.findMany({
                where: { userId: dbUser.id, polishLevel: { lt: 3 } },
                include: { album: { include: { artist: true } } },
                take: 20
            });
            const artists = await prisma.userArtistCollection.findMany({
                where: { userId: dbUser.id, polishLevel: { lt: 3 } },
                include: { artist: true },
                take: 5
            });

            if (albums.length === 0 && artists.length === 0) {
                const msg = '❌ You have no items available to polish! Keep collecting or use a specific query.';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('polish_select')
                .setPlaceholder('Select an item to polish...');

            for (const a of albums) {
                selectMenu.addOptions(new StringSelectMenuOptionBuilder()
                    .setLabel(`${a.album.artist.name} - ${a.album.name}`.substring(0, 100))
                    .setDescription(`Lvl ${a.polishLevel} | Costs: ${a.polishLevel === 0 ? '1k' : a.polishLevel === 1 ? '5k' : '15k'}`)
                    .setValue(`ALBUM:${a.id}`)
                );
            }
            for (const a of artists) {
                selectMenu.addOptions(new StringSelectMenuOptionBuilder()
                    .setLabel(`Artist: ${a.artist.name}`.substring(0, 100))
                    .setDescription(`Lvl ${a.polishLevel} | Costs: ${a.polishLevel === 0 ? '1k' : a.polishLevel === 1 ? '5k' : '15k'}`)
                    .setValue(`ARTIST:${a.id}`)
                );
            }

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const msgObj = await (isSlash
                ? interactionOrMessage.editReply({ content: '✨ Select an item from your collection to upgrade:', components: [row] })
                : channel.send({ content: '✨ Select an item from your collection to upgrade:', components: [row] }));

            const collector = msgObj.createMessageComponentCollector({ time: 60000 });
            collector.on('collect', async (i: any) => {
                if (i.user.id !== discordId) return i.reply({ content: 'Not for you!', ephemeral: true });
                await i.deferUpdate();

                const [type, id] = i.values[0].split(':');
                let selectedItem = null;
                let isA = false;

                if (type === 'ALBUM') {
                    selectedItem = await prisma.userAlbumCollection.findUnique({ where: { id }, include: { album: { include: { artist: true } } } });
                } else {
                    selectedItem = await prisma.userArtistCollection.findUnique({ where: { id }, include: { artist: true } });
                    isA = true;
                }

                if (selectedItem) {
                    await executePolish(selectedItem, isA, i);
                    collector.stop();
                }
            });
            return;
        }

        // Direct Query mode
        let item: any = await prisma.userAlbumCollection.findFirst({
            where: { userId: dbUser.id, album: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { artist: { name: { contains: query, mode: 'insensitive' } } }] } },
            include: { album: { include: { artist: true } } }
        });

        let isArtist = false;
        if (!item) {
            item = await prisma.userArtistCollection.findFirst({
                where: { userId: dbUser.id, artist: { name: { contains: query, mode: 'insensitive' } } },
                include: { artist: true }
            });
            isArtist = true;
        }

        if (!item) {
            const msg = `❌ Couldn't find \`${query}\` in your collection.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        await executePolish(item, isArtist, interactionOrMessage);


    }

    private async handleLeaderboard(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();

        const topUsers = await prisma.userGameProfile.findMany({
            orderBy: { collectionValue: 'desc' },
            take: 10,
            include: { user: true }
        });

        const builder = new ComponentsV2()
            .setAccent(0xFFD700)
            .addText(`### 🏆 Collection Value Leaderboard\n`);

        if (topUsers.length === 0) builder.addText(`No collectors yet.`);

        for (let i = 0; i < topUsers.length; i++) {
            const profile = topUsers[i];
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🔹';
            builder.addText(`${medal} **<@${profile.user.discordId}>** — Value: **${profile.collectionValue.toLocaleString()}**`);
        }

        isSlash ? await interactionOrMessage.editReply(builder.build()) : await channel.send(builder.build());
    }

    private async handleQuests(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        const msg = `🚧 Daily Quests are currently under construction! Check back soon.`;
        isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
    }

    private async handleStore(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel): Promise<void> {
        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const builder = new ComponentsV2()
            .setAccent(0x5865F2)
            .addText(`### 🛒 BOOSTER PACK STORE\nSpend your Vinyls on guaranteed effects and rarities!\n\n`)
            .addText(`🥇 **Gold Booster** — \`1,000\` Vinyls\n-# Guaranteed Level 1 Gold Polish\n`)
            .addText(`💎 **Diamond Booster** — \`5,000\` Vinyls\n-# Guaranteed Level 2 Diamond Polish\n`)
            .addText(`🌈 **Rainbow Booster** — \`15,000\` Vinyls\n-# Guaranteed Level 3 Rainbow Polish\n`)
            .addText(`✨ **Holographic Pack** — \`25,000\` Vinyls\n-# Guaranteed Holographic Variant\n`)
            .addText(`⚠️ **Glitch Pack** — \`60,000\` Vinyls\n-# Guaranteed Error Variant\n`);

        const selectMenuId = `buy_pack:${discordId}:${Date.now()}`;
        builder.addRow([
            {
                type: ComponentType.StringSelect,
                custom_id: selectMenuId,
                placeholder: 'Select a pack to purchase...',
                options: [
                    { label: 'Gold Booster', value: 'pack_gold', emoji: { name: '🥇' }, description: '1,000 Vinyls' },
                    { label: 'Diamond Booster', value: 'pack_diamond', emoji: { name: '💎' }, description: '5,000 Vinyls' },
                    { label: 'Rainbow Booster', value: 'pack_rainbow', emoji: { name: '🌈' }, description: '15,000 Vinyls' },
                    { label: 'Holographic Pack', value: 'pack_holo', emoji: { name: '✨' }, description: '25,000 Vinyls' },
                    { label: 'Glitch Pack', value: 'pack_error', emoji: { name: '⚠️' }, description: '60,000 Vinyls' }
                ]
            }
        ]);

        const msg = isSlash ? await interactionOrMessage.editReply(builder.build()) : await channel.send(builder.build());

        const collector = msg.createMessageComponentCollector({
            filter: (i: any) => i.customId === selectMenuId && i.user.id === discordId,
            time: 60000,
            max: 1
        });

        collector.on('collect', async (i: any) => {
            await i.deferUpdate();
            const packId = i.values[0];
            const result = await AlbumGameService.buyPack(discordId, packId);

            if (!result.success) {
                await i.followUp({ content: `❌ ${result.msg}`, ephemeral: true });
                return;
            }

            // Remove the menu and show the result
            const loading = new ComponentsV2()
                .setAccent(0x5865F2)
                .addText('✨ **Opening your booster pack...**');
            await i.editReply(loading.build());
            
            if (result.roll) {
                await this.renderPackOpening(result.roll, discordId, channel, i, result.msg);
            } else {
                await i.followUp({ content: result.msg });
            }
        });
    }

    private async renderPackOpening(roll: GameRoll, discordId: string, channel: TextChannel, interaction: any, successMsg: string): Promise<void> {
        let color = AlbumGameService.getRarityColor(roll.rarity);
        if (roll.variant === 'HOLOGRAPHIC') color = 0x00FFFF;
        if (roll.variant === 'ERROR') color = 0xFF0000;

        const titleText = roll.type === 'ALBUM'
            ? `**${roll.artistName}** — **${roll.albumName}**`
            : `**${roll.artistName}**`;

        // RENDER CARD if special
        let displayImage = roll.image;
        let attachment: AttachmentBuilder | null = null;
        
        if (roll.variant === 'HOLOGRAPHIC' || roll.variant === 'ERROR') {
            const buffer = await AlbumRenderService.renderVariant({
                image: roll.image,
                variant: roll.variant
            });
            attachment = new AttachmentBuilder(buffer, { name: 'variant.png' });
            displayImage = 'attachment://variant.png';
        } else {
            const buffer = await AlbumRenderService.renderAlbumCard({
                artistName: roll.artistName,
                albumName: roll.albumName,
                image: roll.image,
                rarity: roll.rarity as any,
                variant: roll.variant,
                polishLevel: (roll as any).polishLevel || 0
            });
            attachment = new AttachmentBuilder(buffer, { name: 'card.png' });
            displayImage = 'attachment://card.png';
        }

        const builder = new ComponentsV2()
            .setAccent(color)
            .addText(`### ${successMsg}\n${titleText}`)
            .setImage(displayImage)
            .addFooter(`Rarity: ${roll.rarity} | Variant: ${roll.variant}`);

        const payload = builder.build();
        if (attachment) payload.files = [attachment];

        await interaction.followUp(payload);
    }

    private getRarityEmoji(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '🌟';
            case AlbumRarity.EPIC: return '💎';
            case AlbumRarity.RARE: return '🔵';
            default: return '⚪';
        }
    }

    private getFlavorText(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '✨ **A DIVINE DISCOVERY!** ✨';
            case AlbumRarity.EPIC: return '🔥 **AN EPIC FIND!**';
            case AlbumRarity.RARE: return '💎 **A RARE TREASURE!**';
            default: return '💿 **New discovery!**';
        }
    }

    private async proxyImage(url: string, client: any): Promise<string | null> {
        if (!url) return null;
        try {
            const stagingChannelId = config.CHART_STAGING_CHANNEL_ID;
            if (!stagingChannelId) return url;

            const stagingChannel = await client.channels.fetch(stagingChannelId) as TextChannel | null;
            if (!stagingChannel || (stagingChannel.type !== ChannelType.GuildText && stagingChannel.type !== ChannelType.PublicThread && stagingChannel.type !== ChannelType.PrivateThread)) {
                return url;
            }

            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');

            const attachment = new AttachmentBuilder(buffer, { name: 'roll-artwork.webp' });
            const msg = await stagingChannel.send({ files: [attachment] });
            const cdnUrl = msg.attachments.first()?.url || null;

            // Optional: delete after some time to save space, but Discord CDN links usually persist for a while
            setTimeout(() => msg.delete().catch(() => { }), 3600000); // 1 hour

            return cdnUrl;
        } catch (err) {
            console.error('[AlbumGame] Proxy failed:', err);
            return url;
        }
    }
}
