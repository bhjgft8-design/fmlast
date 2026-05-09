import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import { SlashCommandBuilder, TextChannel, EmbedBuilder } from "discord.js";
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { AlbumGameService } from '../../services/bot/AlbumGameService';

export default class TourCommand extends BaseCommand {
    name = 'tour';
    description = 'Send your collected artists on a global tour to earn Vinyl Scraps!';
    aliases = ['tours'];

    slashData = new SlashCommandBuilder()
        .setName('tour')
        .setDescription('Record Label Tour System')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Send an artist on a 12-hour tour')
                .addStringOption(opt => opt.setName('artist').setDescription('The exact name of the artist').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('claim')
                .setDescription('Claim rewards from a completed tour')
                .addStringOption(opt => opt.setName('artist').setDescription('The exact name of the artist').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View your active tours')
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const channel = interactionOrMessage.channel as TextChannel;
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const subcommand = isSlash ? interactionOrMessage.options.getSubcommand() : (args?.[0] || 'status');

        if (subcommand === 'start') {
            await this.handleStart(interactionOrMessage, isSlash, userId, channel, args);
        } else if (subcommand === 'claim') {
            await this.handleClaim(interactionOrMessage, isSlash, userId, channel, args);
        } else if (subcommand === 'status') {
            await this.handleStatus(interactionOrMessage, isSlash, userId, channel);
        }
    }

    private async handleStart(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, args?: string[]) {
        const artistQuery = isSlash ? interactionOrMessage.options.getString('artist') : args?.slice(1).join(' ');
        if (!artistQuery) {
            const msg = '❌ Please specify an artist: `/tour start <artist>`';
            isSlash ? await interactionOrMessage.reply(msg) : await channel.send(msg);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) {
            const msg = '❌ Link your account first with `/login`!';
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Check if user owns the artist
        const artist = await prisma.artist.findFirst({ where: { name: { equals: artistQuery, mode: 'insensitive' } } });
        if (!artist) {
            const msg = `❌ Artist **${artistQuery}** not found in the database.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        const ownedCard = await prisma.userArtistCollection.findFirst({
            where: { userId: dbUser.id, artistId: artist.id }
        });

        if (!ownedCard) {
            const msg = `❌ You don't own the **${artist.name}** card! You must collect them from rolls first.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Check if already on tour
        const existingTour = await prisma.activeTour.findUnique({
            where: { userId_artistId: { userId: dbUser.id, artistId: artist.id } }
        });

        if (existingTour) {
            const msg = `❌ **${artist.name}** is already on tour! Check \`/tour status\`.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Enforce max active tours limit (e.g., 3)
        const activeTours = await prisma.activeTour.count({ where: { userId: dbUser.id } });
        if (activeTours >= 3) {
            const msg = `❌ You already have 3 artists on tour! Wait for them to finish.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Get initial scrobbles
        const userArtist = await prisma.userArtist.findUnique({
            where: { userId_artistName: { userId: dbUser.id, artistName: artist.name } }
        });
        const initialScrobbles = userArtist?.playcount || 0;

        // Start tour
        await prisma.activeTour.create({
            data: {
                userId: dbUser.id,
                artistId: artist.id,
                startTime: new Date(),
                initialScrobbles
            }
        });

        const builder = new ComponentsV2()
            .setAccent(0xFFD700)
            .addText(`### ✈️ TOUR STARTED!\n**${artist.name}** has hit the road!`)
            .addText(`\nListen to their music over the next **12 hours** to generate Vinyl Scraps when they return.`);

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }

    private async handleClaim(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel, args?: string[]) {
        const artistQuery = isSlash ? interactionOrMessage.options.getString('artist') : args?.slice(1).join(' ');
        if (!artistQuery) {
            const msg = '❌ Please specify an artist: `/tour claim <artist>`';
            isSlash ? await interactionOrMessage.reply(msg) : await channel.send(msg);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return;

        const artist = await prisma.artist.findFirst({ where: { name: { equals: artistQuery, mode: 'insensitive' } } });
        if (!artist) {
            const msg = `❌ Artist **${artistQuery}** not found.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        const activeTour = await prisma.activeTour.findUnique({
            where: { userId_artistId: { userId: dbUser.id, artistId: artist.id } }
        });

        if (!activeTour) {
            const msg = `❌ **${artist.name}** is not currently on tour!`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        const now = new Date();
        const durationMs = now.getTime() - activeTour.startTime.getTime();
        const twelveHoursMs = 12 * 60 * 60 * 1000;

        if (durationMs < twelveHoursMs) {
            const remaining = Math.ceil((twelveHoursMs - durationMs) / (60 * 1000));
            const hours = Math.floor(remaining / 60);
            const mins = remaining % 60;
            const msg = `⏳ The tour isn't over yet! **${artist.name}** returns in **${hours}h ${mins}m**.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Calculate reward
        const userArtist = await prisma.userArtist.findUnique({
            where: { userId_artistName: { userId: dbUser.id, artistName: artist.name } }
        });
        const currentScrobbles = userArtist?.playcount || 0;
        const scrobblesGained = Math.max(0, currentScrobbles - activeTour.initialScrobbles);

        const ownedCard = await prisma.userArtistCollection.findFirst({
            where: { userId: dbUser.id, artistId: activeTour.artistId }
        });

        let multiplier = 1;
        if (ownedCard) {
            if (ownedCard.rarity === 'RARE') multiplier = 2;
            if (ownedCard.rarity === 'EPIC') multiplier = 5;
            if (ownedCard.rarity === 'LEGENDARY') multiplier = 15;
            
            if (ownedCard.polishLevel >= 1) multiplier *= 1.5;
            if (ownedCard.polishLevel >= 2) multiplier *= 2;
            if (ownedCard.polishLevel >= 3) multiplier *= 3;

            if (ownedCard.variant === 'HOLOGRAPHIC') multiplier *= 4;
            if (ownedCard.variant === 'GLITCH') multiplier *= 5;
        }

        // Base reward of 50 just for finishing + scrobble bonus
        const totalReward = 50 + (scrobblesGained * multiplier * 10);

        await prisma.$transaction([
            prisma.userGameProfile.update({
                where: { userId: dbUser.id },
                data: { vinylScraps: { increment: totalReward } }
            }),
            prisma.activeTour.delete({
                where: { id: activeTour.id }
            })
        ]);

        const builder = new ComponentsV2()
            .setAccent(0x4ade80)
            .addText(`### 🎉 TOUR COMPLETED!\n**${artist.name}** has returned from tour!`)
            .addText(`\n🎧 **Scrobbles Gained:** \`${scrobblesGained}\``)
            .addText(`📀 **Earnings:** **${totalReward} Vinyls** (x${multiplier} multiplier)`);

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }

    private async handleStatus(interactionOrMessage: any, isSlash: boolean, discordId: string, channel: TextChannel) {
        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const dbUser = await prisma.user.findUnique({ where: { discordId } });
        if (!dbUser) return;

        const activeTours = await prisma.activeTour.findMany({
            where: { userId: dbUser.id },
            include: { artist: true }
        });

        const builder = new ComponentsV2().setAccent(0x5865F2).addText(`### ✈️ ACTIVE TOURS (${activeTours.length}/3)\n`);

        if (activeTours.length === 0) {
            builder.addText(`\nYou have no artists on tour. Use \`/tour start <artist>\` to send them out!`);
        } else {
            const now = Date.now();
            for (const tour of activeTours) {
                const twelveHoursMs = 12 * 60 * 60 * 1000;
                const endTime = tour.startTime.getTime() + twelveHoursMs;
                
                if (now >= endTime) {
                    builder.addText(`✅ **${tour.artist.name}** — Ready to claim! (Use \`/tour claim ${tour.artist.name}\`)\n`);
                } else {
                    const remainingMs = endTime - now;
                    const hours = Math.floor(remainingMs / 3600000);
                    const mins = Math.floor((remainingMs % 3600000) / 60000);
                    builder.addText(`✈️ **${tour.artist.name}** — Returns in **${hours}h ${mins}m**\n`);
                }
            }
        }

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }
}
