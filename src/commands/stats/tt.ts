import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { TextChannel, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { resolveTargetUser } from '../../utils/userResolver';

export default class TopTracksCommand extends BaseCommand {
    name = 'tt';
    description = 'View your top tracks for a time period';
    aliases = ['toptracks'];

    slashData = new SlashCommandBuilder()
        .setName('tt')
        .setDescription('View top tracks for a time period')
        .addStringOption((opt: any) =>
            opt.setName('period')
                .setDescription('Time period')
                .setRequired(false)
                .addChoices(
                    { name: 'Day', value: 'day' },
                    { name: 'Week', value: '7day' },
                    { name: 'Month', value: '1month' },
                    { name: 'Year', value: '12month' },
                    { name: 'Overall', value: 'overall' }
                )
        )
        .addUserOption((opt: any) => opt.setName('user').setDescription('The user to view top tracks for').setRequired(false));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        if (!isSlash) {
            try { (interactionOrMessage.channel as TextChannel).sendTyping(); } catch { }
        }

        const targetUser = await resolveTargetUser(interactionOrMessage, isSlash);
        const targetUserId = targetUser.id;
        const authorId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;

        let period = '7day';
        const periodMap: Record<string, string> = {
            'd': 'day', 'day': 'day', 'daily': 'day',
            'w': '7day', 'week': '7day', 'weekly': '7day',
            'm': '1month', 'month': '1month', 'monthly': '1month',
            'y': '12month', 'year': '12month', 'yearly': '12month',
            'o': 'overall', 'overall': 'overall', 'all': 'overall', 'alltime': 'overall'
        };

        if (isSlash) {
            period = interactionOrMessage.options.getString('period') || '7day';
        } else if (args && args.length > 0) {
            for (const arg of args) {
                const clean = arg.toLowerCase().replace(/<@!?\d+>/g, '').trim();
                if (periodMap[clean]) {
                    period = periodMap[clean];
                    break;
                }
            }
        }

        const dbUser = await prisma.user.findUnique({ where: { discordId: targetUserId } });
        if (!dbUser || !dbUser.lastfmUsername) {
            const isSelf = targetUserId === authorId;
            const msg = isSelf 
                ? '❌ You must link your Last.fm account first! Use `/login`.'
                : `❌ **${targetUser.username}** is not linked to Last.fm yet.`;
            const payload = new ComponentsV2().setAccent(0xff0000).addText(msg).build();
            if (isSlash) await interactionOrMessage.reply({ ...payload, ephemeral: true });
            else await interactionOrMessage.channel.send(payload);
            return;
        }

        if (isSlash && !interactionOrMessage.deferred) await interactionOrMessage.deferReply();

        // Initial Data Fetch
        let tracks: any[] = [];
        if (period === 'day') {
            const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
            const recent = await LastFM.getRecentTracksPaginated(dbUser.lastfmUsername, 200, 1, dbUser.lastfmSessionKey, false, oneDayAgo);
            const counts = new Map<string, any>();
            for (const t of recent.tracks) {
                const trackName = t.name;
                const artistName = t.artist?.name || t.artist?.['#text'];
                if (!trackName || !artistName) continue;
                const key = `${trackName}|${artistName}`;
                if (!counts.has(key)) counts.set(key, { name: trackName, artist: { name: artistName }, playcount: 0 });
                counts.get(key).playcount++;
            }
            tracks = Array.from(counts.values())
                .sort((a, b) => b.playcount - a.playcount)
                .map(t => ({ ...t, playcount: String(t.playcount) }));
        } else {
            tracks = await LastFM.getTopTracks(dbUser.lastfmUsername, period, 100, dbUser.lastfmSessionKey);
        }

        const perPage = 10;
        let currentPage = 1;
        const totalPages = Math.ceil(tracks.length / perPage) || 1;

        const periodLabels: Record<string, string> = {
            'day': 'Daily', '7day': 'Weekly', '1month': 'Monthly', '12month': 'Yearly', 'overall': 'Overall'
        };

        const generatePayload = (page: number) => {
            const builder = new ComponentsV2().setAccent(0x5d010b);
            const start = (page - 1) * perPage;
            const slice = tracks.slice(start, start + perPage);

            if (tracks.length === 0) {
                builder.addText(`### Top ${periodLabels[period]} Tracks\n**${targetUser.displayName}** doesn't have any data for this period.`);
                return builder.build();
            }

            const list = slice.map((t: any, i: number) => {
                const rank = start + i + 1;
                const artist = t.artist?.name || 'Unknown Artist';
                const url = `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(t.name)}`;
                return `${rank}.\u2004\u2005**[${t.name}](${url})\u200E** by **${artist}** - **${parseInt(t.playcount).toLocaleString()}** plays`;
            }).join('\n');

            builder.addText(`### Top ${periodLabels[period]} Tracks for ${targetUser.displayName}\n${list}`);
            builder.addText(`-# Page ${page}/${totalPages} - ${tracks.length} total tracks`);

            if (totalPages > 1) {
                builder.addRow([
                    { type: 2, style: 2, custom_id: 'paginator_first', emoji: { id: '883825508633182208' }, disabled: page === 1 },
                    { type: 2, style: 2, custom_id: 'paginator_prev', emoji: { id: '883825508507336704' }, disabled: page === 1 },
                    { type: 2, style: 2, custom_id: 'paginator_next', emoji: { id: '883825508087922739' }, disabled: page === totalPages },
                    { type: 2, style: 2, custom_id: 'paginator_last', emoji: { id: '883825508482183258' }, disabled: page === totalPages }
                ]);
            }

            return builder.build();
        };

        const initialPayload = generatePayload(currentPage);
        let message: any;
        if (isSlash) message = await interactionOrMessage.editReply(initialPayload);
        else message = await interactionOrMessage.channel.send(initialPayload);

        if (totalPages <= 1) return;

        const collector = message.createMessageComponentCollector({
            filter: (i: any) => i.user.id === authorId,
            time: 120000
        });

        collector.on('collect', async (i: any) => {
            if (i.customId === 'paginator_first') currentPage = 1;
            else if (i.customId === 'paginator_prev') currentPage = Math.max(1, currentPage - 1);
            else if (i.customId === 'paginator_next') currentPage = Math.min(totalPages, currentPage + 1);
            else if (i.customId === 'paginator_last') currentPage = totalPages;

            await i.update(generatePayload(currentPage));
        });

        collector.on('end', () => {
            try {
                const disabledPayload = generatePayload(currentPage);
                if (disabledPayload.components && disabledPayload.components[0]) {
                    const container = disabledPayload.components[0];
                    if (container.components) {
                        container.components.forEach((comp: any) => {
                            if (comp.type === 1 && comp.components) {
                                comp.components.forEach((btn: any) => btn.disabled = true);
                            }
                        });
                    }
                }
                message.edit(disabledPayload).catch(() => {});
            } catch {}
        });
    }
}
