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
import { AlbumGameService, AlbumRarity } from '../../services/bot/AlbumGameService';
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
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const channel = interactionOrMessage.channel as TextChannel;
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const subcommand = isSlash ? interactionOrMessage.options.getSubcommand() : (args?.[0] || 'roll');

        if (subcommand === 'roll' || subcommand === 'r') {
            await this.handleRoll(interactionOrMessage, isSlash, userId, channel);
        } else if (subcommand === 'collection' || subcommand === 'c' || subcommand === 'inv') {
            await this.handleCollection(interactionOrMessage, isSlash, userId, channel, 0);
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

            // 2. Roll for Album
            const roll = await AlbumGameService.rollAlbum(discordId);
            if (!roll) {
                const msg = '😢 No albums found in the pool. Try again later.';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            // Increment rolls
            const newRolls = rolls + 1;
            await prisma.user.update({
                where: { discordId },
                data: { 
                    albumRolls: newRolls,
                    lastAlbumRoll: newRolls >= MAX_ROLLS ? new Date() : dbUser.lastAlbumRoll
                }
            });

            // Proxy the image to Discord CDN to prevent "Invalid Form Body" errors
            const proxiedImage = await this.proxyImage(roll.image, interactionOrMessage.client);

            // 3. Build Card UI
            const color = AlbumGameService.getRarityColor(roll.rarity);
            const flavorText = this.getFlavorText(roll.rarity);
            
            const builder = new ComponentsV2()
                .setAccent(color)
                .addText(`### 🎲 ALBUM ROLL\n${flavorText}\n**${roll.artistName}** — **${roll.albumName}**`)
                .setImage(proxiedImage || roll.image)
                .addFooter(`Rarity: ${roll.rarity} • Rolls Left: ${MAX_ROLLS - newRolls} • Roll for <@${discordId}>`);

            // Claim Button
            const claimId = `claim_album:${roll.albumId}:${roll.rarity}`;
            builder.addAction(`-# Click below to add this to your collection!`, {
                type: ComponentType.Button,
                custom_id: claimId,
                label: 'Claim Album',
                emoji: { name: '📥' },
                style: ButtonStyle.Primary
            });

            const rollMsg = isSlash 
                ? await interactionOrMessage.editReply(builder.build())
                : await channel.send(builder.build());

            // 4. Interaction Collector
            const collector = rollMsg.createMessageComponentCollector({
                filter: (i: any) => i.customId === claimId,
                time: 60000,
                max: 1
            });

            collector.on('collect', async (i: any) => {
                // Anyone can claim? Or only the roller? 
                // Let's make it so anyone can snipe it for more fun, but priority to the roller?
                // Actually, let's keep it personal for now to avoid toxicity.
                if (i.user.id !== discordId) {
                    return i.reply({ content: '❌ This roll belongs to someone else!', ephemeral: true });
                }

                await i.deferUpdate();
                const success = await AlbumGameService.claimAlbum(i.user.id, roll.albumId, roll.rarity);

                if (success) {
                    const claimedBuilder = new ComponentsV2()
                        .setAccent(0x4ade80) // Success Green
                        .addText(`### ✅ ALBUM CLAIMED!\n**${roll.artistName}** — **${roll.albumName}** has been added to <@${i.user.id}>'s collection.`)
                        .setThumbnail(roll.image)
                        .addFooter(`Rarity: ${roll.rarity}`);
                    
                    await i.editReply(claimedBuilder.build());
                } else {
                    await i.followUp({ content: '❌ Failed to claim album. You might already own it!', ephemeral: true });
                }
            });

            collector.on('end', async (collected: any) => {
                if (collected.size === 0) {
                    const expiredBuilder = new ComponentsV2()
                        .setAccent(0x333333)
                        .addText(`### 🎲 ALBUM ROLL\n❌ **Claim period expired.**\n**${roll.artistName}** — **${roll.albumName}** returned to the pool.`)
                        .addFooter(`Rarity: ${roll.rarity}`);
                    
                    if (isSlash) await interactionOrMessage.editReply(expiredBuilder.build());
                    else await rollMsg.edit(expiredBuilder.build()).catch(() => {});
                }
            });

        } catch (err) {
            console.error('Album Roll Error:', err);
            const msg = '⚠️ Failed to generate roll.';
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
        }
    }

    private async handleCollection(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, page = 0): Promise<void> {
        const targetId = isSlash ? (interactionOrMessage.options.getUser('user')?.id || discordId) : discordId;
        const LIMIT = 10;
        
        if (isSlash && !interactionOrMessage.deferred && !interactionOrMessage.replied) await interactionOrMessage.deferReply();
        else if (!isSlash) { try { channel.sendTyping(); } catch { } }

        const collection = await AlbumGameService.getCollection(targetId, page, LIMIT);
        if (!collection || collection.count === 0) {
            const msg = targetId === discordId ? '❌ Your collection is empty! Use `/album roll` to start.' : `❌ <@${targetId}>'s collection is empty.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        const totalPages = Math.ceil(collection.count / LIMIT);

        const builder = new ComponentsV2()
            .setAccent(0x5865F2)
            .addText(`### 🗃️ ALBUM COLLECTION\nViewing collection for <@${targetId}>`);

        // Rarity Summary
        const counts = { [AlbumRarity.LEGENDARY]: 0, [AlbumRarity.EPIC]: 0, [AlbumRarity.RARE]: 0, [AlbumRarity.COMMON]: 0 };
        for (const item of collection.items) {
            counts[item.rarity as AlbumRarity]++;
        }

        const summaryText = `🌟 **${counts[AlbumRarity.LEGENDARY]}**  💎 **${counts[AlbumRarity.EPIC]}**  🔵 **${counts[AlbumRarity.RARE]}**  ⚪ **${counts[AlbumRarity.COMMON]}**`;
        builder.addText(`${summaryText}\n\n`);

        let listText = '';
        for (const item of collection.items) {
            const rarityEmoji = this.getRarityEmoji(item.rarity as AlbumRarity);
            listText += `${rarityEmoji} **${item.album.artist.name}** — *${item.album.name}*\n`;
        }
        builder.addText(listText || '_No albums in this page_');
        builder.addFooter(`Page ${page + 1}/${totalPages} • Total Collected: ${collection.count}`);

        // Pagination Buttons
        if (totalPages > 1) {
            const row = [];
            if (page > 0) {
                row.push({
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: 'Back',
                    custom_id: `album_page:${targetId}:${page - 1}`
                });
            }
            if (page < totalPages - 1) {
                row.push({
                    type: ComponentType.Button,
                    style: ButtonStyle.Secondary,
                    label: 'Next',
                    custom_id: `album_page:${targetId}:${page + 1}`
                });
            }
            builder.addRow(row);
        }

        const payload = builder.build();
        const msg = (isSlash && (interactionOrMessage.deferred || interactionOrMessage.replied))
            ? await interactionOrMessage.editReply(payload)
            : await channel.send(payload);

        // Collector for pagination
        if (totalPages > 1) {
            const collector = msg.createMessageComponentCollector({
                filter: (i: any) => i.customId.startsWith('album_page:'),
                time: 120000
            });

            collector.on('collect', async (i: any) => {
                if (i.user.id !== discordId) return i.reply({ content: '❌ Use the command yourself to browse!', ephemeral: true });
                await i.deferUpdate();
                const [_, tid, newPage] = i.customId.split(':');
                await this.handleCollection(i, true, discordId, channel, parseInt(newPage));
            });
        }
    }

    private getRarityEmoji(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '🌟';
            case AlbumRarity.EPIC:      return '💎';
            case AlbumRarity.RARE:      return '🔵';
            default:                    return '⚪';
        }
    }

    private getFlavorText(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '✨ **A DIVINE DISCOVERY!** ✨';
            case AlbumRarity.EPIC:      return '🔥 **AN EPIC FIND!**';
            case AlbumRarity.RARE:      return '💎 **A RARE TREASURE!**';
            default:                    return '💿 **New discovery!**';
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
            setTimeout(() => msg.delete().catch(() => {}), 3600000); // 1 hour

            return cdnUrl;
        } catch (err) {
            console.error('[AlbumGame] Proxy failed:', err);
            return url;
        }
    }
}
