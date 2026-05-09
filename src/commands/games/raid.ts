import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import { SlashCommandBuilder, TextChannel, PermissionFlagsBits } from "discord.js";
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { AlbumGameService } from '../../services/bot/AlbumGameService';
import { triggerDeltaSync } from '../../services/bot/QueueWorker';

export default class RaidCommand extends BaseCommand {
    name = 'raid';
    description = 'Cooperate with the server to defeat the Raid Boss by scrobbling!';
    aliases = ['boss'];

    slashData = new SlashCommandBuilder()
        .setName('raid')
        .setDescription('Global Server Raid Boss')
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View the current active Raid Boss')
        )
        .addSubcommand(sub =>
            sub.setName('spawn')
                .setDescription('ADMIN: Spawn a new Raid Boss')
                .addStringOption(opt => opt.setName('artist').setDescription('Artist name').setRequired(true))
                .addIntegerOption(opt => opt.setName('target').setDescription('Target scrobbles').setRequired(true))
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const channel = interactionOrMessage.channel as TextChannel;
        const subcommand = isSlash ? interactionOrMessage.options.getSubcommand() : (args?.[0] || 'status');

        if (subcommand === 'spawn') {
            await this.handleSpawn(interactionOrMessage, isSlash, channel, args);
        } else {
            await this.handleStatus(interactionOrMessage, isSlash, channel);
        }
    }

    private async handleStatus(interactionOrMessage: any, isSlash: boolean, channel: TextChannel) {
        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const guildId = channel.guildId;
        if (!guildId) return;

        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        
        // ── Pro Sync: Force delta sync to ensure damage is recorded immediately ──
        await triggerDeltaSync(userId, true, true).catch(() => {});

        // Check for active boss
        let boss = await prisma.raidBoss.findFirst({
            where: {
                OR: [
                    { guildId: channel.guildId },
                    { guildId: null }
                ],
                status: 'ACTIVE'
            },
            include: { artist: true },
            orderBy: { endTime: 'asc' }
        });

        // ── LIVE RECONCILIATION ──
        // If there's an active boss, sync the top 5 contributors to ensure HP is live
        if (boss) {
            const top5 = await prisma.raidContribution.findMany({
                where: { raidId: boss.id },
                orderBy: { scrobbles: 'desc' },
                take: 5,
                include: { user: true }
            });

            // Sync top participants in parallel and wait for completion
            // This ensures the damage they dealt in the last 3 hours is in the DB before we recalculate
            await Promise.all(top5.map(p => triggerDeltaSync(p.user.discordId, true, true).catch(() => {})));
        }

        const builder = new ComponentsV2().setAccent(0xFF0000);

        if (!boss) {
            // Check for most recent completed boss
            boss = await prisma.raidBoss.findFirst({
                where: {
                    OR: [
                        { guildId: channel.guildId },
                        { guildId: null }
                    ],
                    status: { in: ['DEFEATED', 'FAILED'] }
                },
                include: { artist: true },
                orderBy: { endTime: 'desc' }
            });

            if (!boss) {
                const msg = '❌ There is no active Raid Boss right now. Wait for the next global event!';
                isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
                return;
            }

            builder.setAccent(boss.status === 'DEFEATED' ? 0x39FF14 : 0x71717a);
            builder.addText(`### ⚔️ LATEST RAID: ${boss.status === 'DEFEATED' ? 'VICTORY' : 'FAILED'}\n**Artist:** ${boss.artist.name}`);
            builder.addText(`**Target:** ${boss.targetScrobbles.toLocaleString()} HP`);
            builder.addText(`**Final Progress:** ${boss.currentScrobbles.toLocaleString()} (${Math.floor((boss.currentScrobbles / boss.targetScrobbles) * 100)}%)`);
            
            const payload = builder.build();
            isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
            return;
        }

        const now = new Date();
        if (now > boss.endTime) {
            await prisma.raidBoss.update({ where: { id: boss.id }, data: { status: 'FAILED' } });
            const msg = `💀 The raid against **${boss.artist.name}** has failed! The timer ran out.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // ── Pro Sync Reconciliation ──
        // Ensure the global counter hasn't drifted from the individual contributions
        const totalDamage = await AlbumGameService.recalculateRaidProgress(boss.id);
        if (totalDamage !== boss.currentScrobbles) {
            boss = await prisma.raidBoss.update({
                where: { id: boss.id },
                data: { currentScrobbles: totalDamage },
                include: { artist: true }
            });
        }

        const pct = Math.min(100, Math.floor((boss.currentScrobbles / boss.targetScrobbles) * 100));
        const bars = Math.floor(pct / 10);
        const progress = '🟩'.repeat(bars) + '⬛'.repeat(10 - bars);

        // Fetch Leaderboard
        const topParticipants = await AlbumGameService.getRaidLeaderboard(boss.id, 5);
        const userDb = await prisma.user.findUnique({ where: { discordId: userId } });
        const userDmg = userDb ? await AlbumGameService.getUserRaidContribution(boss.id, userDb.id) : null;

        builder
            .setAccent(0xFF4500)
            .addText(`## ⚔️ RAID BOSS: ${boss.artist.name}`)
            .addText(`*The server must damage this boss by scrobbling their tracks!*`)
            .addText(`\n### 🏮 BOSS STATS`)
            .addText(`**Health Points:** \`${boss.currentScrobbles.toLocaleString()} / ${boss.targetScrobbles.toLocaleString()}\` HP (${pct}%)`)
            .addText(`${progress}`)
            .addText(`\n⏳ **Time Remaining:** <t:${Math.floor(boss.endTime.getTime() / 1000)}:R>`);

        if (topParticipants.length > 0) {
            let lbText = '\n### 🏆 TOP HEROES (DAMAGE)';
            topParticipants.forEach((p, i) => {
                const icon = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : '👤';
                lbText += `\n${icon} **${p.user.lastfmUsername || 'Unknown'}** — \`${p.scrobbles.toLocaleString()}\` HP damage`;
            });
            builder.addText(lbText);
        }

        if (userDmg) {
            builder.addText(`\n> **🗡️ YOUR CONTRIBUTION:** \`${userDmg.scrobbles.toLocaleString()}\` damage dealt`);
        }

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }

    private async handleSpawn(interactionOrMessage: any, isSlash: boolean, channel: TextChannel, args?: string[]) {
        const isAdmin = isSlash 
            ? (interactionOrMessage.member?.permissions as any)?.has(PermissionFlagsBits.Administrator)
            : interactionOrMessage.member?.permissions?.has(PermissionFlagsBits.Administrator);

        // Allow bot owners
        const botOwnerIds = ['YOUR_DISCORD_ID_HERE']; // TODO: Get from config
        const isOwner = botOwnerIds.includes(interactionOrMessage.user?.id || interactionOrMessage.author?.id);

        if (!isAdmin && !isOwner) {
            const msg = '❌ You need Administrator permissions to spawn a raid boss.';
            isSlash ? await interactionOrMessage.reply({content: msg, ephemeral: true}) : await channel.send(msg);
            return;
        }

        const artistQuery = isSlash ? interactionOrMessage.options.getString('artist') : args?.slice(1, -1).join(' ');
        const target = isSlash ? interactionOrMessage.options.getInteger('target') : parseInt(args?.[args.length - 1] || '0');

        if (!artistQuery || !target || target <= 0) {
            const msg = '❌ Usage: `/raid spawn <artist> <target>`';
            isSlash ? await interactionOrMessage.reply(msg) : await channel.send(msg);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const artist = await prisma.artist.findFirst({ where: { name: { equals: artistQuery, mode: 'insensitive' } } });
        if (!artist) {
            const msg = `❌ Artist **${artistQuery}** not found in the database.`;
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Deactivate old bosses for this guild
        await prisma.raidBoss.updateMany({
            where: { guildId: channel.guildId, status: 'ACTIVE' },
            data: { status: 'FAILED' }
        });

        const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.raidBoss.create({
            data: {
                guildId: channel.guildId,
                artistId: artist.id,
                targetScrobbles: target,
                endTime,
                status: 'ACTIVE',
                notificationChannelId: channel.id
            }
        });

        const builder = new ComponentsV2()
            .setAccent(0xFF0000)
            .addText(`### 🚨 WARNING: A RAID BOSS HAS SPAWNED! 🚨\n**${artist.name}** has invaded the server!`)
            .addText(`\nWe need **${target.toLocaleString()} scrobbles** to defeat them! Everyone start listening to ${artist.name}!`);

        const payload = builder.build();
        isSlash ? await interactionOrMessage.editReply(payload) : await channel.send(payload);
    }
}
