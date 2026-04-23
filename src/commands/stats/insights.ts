import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { SlashCommandBuilder } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { OpenAiService } from '../../services/external/OpenAiService';
import { parseArgs } from '../../utils/prefixParser';
import { resolveTargetUser } from '../../utils/userResolver';

export default class InsightsCommand extends BaseCommand {
    name = 'insights';
    description = 'Get a deep AI analysis of your musical persona.';
    aliases = ['persona', 'judge'];

    slashData = new SlashCommandBuilder()
        .setName('insights')
        .setDescription('Get a deep AI analysis of your musical persona.')
        .addStringOption((opt: any) =>
            opt.setName('period').setDescription('Time period for the analysis').setRequired(false)
                .addChoices(
                    { name: 'Weekly', value: '7day' },
                    { name: 'Monthly', value: '1month' },
                    { name: 'Quarterly', value: '3month' },
                    { name: 'Half Year', value: '6month' },
                    { name: 'Yearly', value: '12month' },
                    { name: 'Overall', value: 'overall' }
                )
        )
        .addUserOption((opt: any) =>
            opt.setName('user').setDescription('View another user\'s musical persona').setRequired(false)
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        if (isSlash) await interactionOrMessage.deferReply();
        else {
            try { interactionOrMessage.channel.sendTyping(); } catch {}
        }

        const targetUser = await resolveTargetUser(interactionOrMessage, isSlash);
        const userId = targetUser.id;
        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });

        if (!dbUser?.lastfmUsername) {
            const isSelf = userId === (isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id);
            const msg = isSelf 
                ? '❌ Link your Last.fm account first using `/login`.'
                : `❌ **${targetUser.username}** is not linked to Last.fm yet.`;
            if (isSlash) await interactionOrMessage.editReply(msg);
            else await interactionOrMessage.channel.send(msg);
            return;
        }

        let lfmPeriod = '7day';
        if (isSlash) {
            lfmPeriod = interactionOrMessage.options?.getString('period') || '7day';
        } else if (args) {
            const { unnamed } = parseArgs(args);
            const definedPeriods: Record<string, string> = {
                'weekly': '7day', 'week': '7day', '7day': '7day',
                'monthly': '1month', 'month': '1month', '1month': '1month',
                'quarterly': '3month', '3month': '3month',
                'halfyear': '6month', '6month': '6month',
                'yearly': '12month', 'year': '12month', '12month': '12month',
                'overall': 'overall', 'all': 'overall'
            };
            if (unnamed.length > 0 && definedPeriods[unnamed[0].toLowerCase()]) {
                lfmPeriod = definedPeriods[unnamed[0].toLowerCase()];
            }
        }

        try {
            // 1. Fetch Top Artists & Tracks
            const [topArtists, topTracks] = await Promise.all([
                LastFM.getTopArtists(dbUser.lastfmUsername, lfmPeriod as any, 10, dbUser.lastfmSessionKey),
                LastFM.getTopTracks(dbUser.lastfmUsername, lfmPeriod as any, 10, dbUser.lastfmSessionKey)
            ]);

            if (!topArtists.length && !topTracks.length) {
                const msg = '😢 You haven\'t listened to enough music in this period for me to judge you.';
                if (isSlash) await interactionOrMessage.editReply(msg);
                else await interactionOrMessage.channel.send(msg);
                return;
            }

            // 2. AI Analysis
            const artistNames = topArtists.map(a => a.name);
            const trackNames = topTracks.map(t => `${t.name} by ${t.artist.name}`);
            
            const personaText = await OpenAiService.getInstance().generateDetailedPersona(
                artistNames, 
                trackNames, 
                lfmPeriod
            );

            // 3. Build UI
            const userObj = targetUser;
            const displayName = userObj.globalName || userObj.displayName || userObj.username;

            const periodLabels: Record<string, string> = {
                '7day': 'Current Week',
                '1month': 'Last 30 Days',
                '3month': 'Last Quarter',
                '6month': 'Half Year',
                '12month': 'Past Year',
                'overall': 'All Time'
            };

            const payload = new ComponentsV2()
                .setAccent(0xffffff)
                .addText(`## 🤖 Musical Persona Analysis`)
                .addText(`### ${displayName} — ${periodLabels[lfmPeriod] || 'Custom'}\n\n${personaText}`)
                .addSeparator()
                .addLinkButton("-# Your music profile", "Last.fm Profile", `https://www.last.fm/user/${dbUser.lastfmUsername}`, { name: '📊' })
                .build();

            if (isSlash) await interactionOrMessage.editReply(payload);
            else await interactionOrMessage.channel.send(payload);

        } catch (err: any) {
            console.error('[insights] error:', err);
            const msg = `❌ Failed to generate AI insights: ${err.message}`;
            if (isSlash) await interactionOrMessage.editReply(msg);
            else await interactionOrMessage.channel.send(msg);
        }
    }
}
