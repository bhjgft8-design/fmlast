import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { HistoryFillerService } from '../../services/bot/HistoryFillerService';
import { TextChannel } from 'discord.js';

export default class FillCommand extends BaseCommand {
    name = 'fill';
    description = 'fill';
    aliases = ['inject'];

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;

        // Restriction: Only specific user ID can use this command
        if (userId !== '687636049576722472') {
            return; // Silently ignore if not authorized
        }

        if (!isSlash) {
            try {
                (interactionOrMessage.channel as TextChannel).sendTyping();
            } catch (err) { }
        }

        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });

        if (!dbUser?.lastfmSessionKey) {
            const payload = new ComponentsV2()
                .setAccent(0xff0000)
                .addText('❌ **Not Linked**\nYou need to link your Last.fm account using `-login` before you can use the filler.')
                .build();
            if (isSlash) await interactionOrMessage.reply({ ...payload, ephemeral: true });
            else await interactionOrMessage.channel.send(payload);
            return;
        }

        if (!args || args.length === 0) {
            const payload = new ComponentsV2()
                .setAccent(0x5865F2)
                .addText('### 📥 History Filler\nBoost your playcounts or fill missing gaps with organic-looking scrobbles.')
                .addText('**Usage**: `-fill <artist1, artist2, ...> [--day YYYY-MM-DD] [--count 100]`')
                .addText('> **Example**: `-fill tv girl, cigarettes after sex --day yesterday`')
                .build();
            if (isSlash) await interactionOrMessage.reply(payload);
            else await interactionOrMessage.channel.send(payload);
            return;
        }

        // Smarter Argument Parsing
        let targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 1); // Default to yesterday
        let countPerArtist = 100;
        const artistParts: string[] = [];

        for (let i = 0; i < args.length; i++) {
            const arg = args[i].toLowerCase();
            if (arg === '--day' && args[i+1]) {
                const dayStr = args[++i].toLowerCase();
                if (dayStr === 'today') targetDate = new Date();
                else if (dayStr === 'yesterday') { /* already yesterday */ }
                else {
                    const parsed = new Date(dayStr);
                    if (!isNaN(parsed.getTime())) targetDate = parsed;
                }
            } else if (arg === '--count' && args[i+1]) {
                const c = parseInt(args[++i]);
                if (!isNaN(c)) countPerArtist = c;
            } else if (arg === '--yesterday' || (arg === 'yesterday' && i === args.length - 1)) {
                targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - 1);
            } else if (arg === '--today' || (arg === 'today' && i === args.length - 1)) {
                targetDate = new Date();
            } else if (arg.match(/^\d+$/) && args[i+1]?.toLowerCase() === 'days' && args[i+2]?.toLowerCase() === 'ago') {
                // Support "X days ago"
                const days = parseInt(arg);
                targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - days);
                i += 2; // Skip "days ago"
            } else {
                artistParts.push(args[i]);
            }
        }

        const artistNames = artistParts.join(' ').split(',').map(a => a.trim()).filter(a => a.length > 0);

        if (artistNames.length === 0) {
            if (isSlash) await interactionOrMessage.reply('Please provide at least one artist name.');
            else await interactionOrMessage.channel.send('Please provide at least one artist name.');
            return;
        }

        // Validate date (must be within 14 days)
        const diffDays = Math.ceil(Math.abs(Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 14) {
            const payload = new ComponentsV2()
                .setAccent(0xff0000)
                .addText('❌ **Invalid Date**\nLast.fm only allows scrobbling up to 14 days in the past.')
                .build();
            if (isSlash) await interactionOrMessage.reply(payload);
            else await interactionOrMessage.channel.send(payload);
            return;
        }

        // Send initial confirmation
        const initialPayload = new ComponentsV2()
            .setAccent(0x5865F2)
            .addText(`⚙️ **Initializing Filler...**\nPreparing to inject history for **${artistNames.length}** artists on **${targetDate.toDateString()}**.`)
            .addText(`> This process uses randomized organic timing patterns and may take a moment.`)
            .build();
        
        let statusMsg: any;
        if (isSlash) statusMsg = await interactionOrMessage.reply({ ...initialPayload, fetchReply: true });
        else statusMsg = await interactionOrMessage.channel.send(initialPayload);

        // Execute filling
        const result = await HistoryFillerService.fill({
            userId: dbUser.id,
            sessionKey: dbUser.lastfmSessionKey,
            artistNames,
            countPerArtist,
            targetDate,
            stealthLevel: 'NORMAL'
        });

        const finalPayload = new ComponentsV2()
            .setAccent(result.success ? 0x1DB954 : 0xff0000)
            .addText(result.success ? `✅ **History Injection Complete**` : `❌ **Injection Failed**`)
            .addText(result.message)
            .build();

        if (isSlash) await interactionOrMessage.editReply(finalPayload);
        else await statusMsg.edit(finalPayload);
    }
}
