import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { triggerDeltaSync } from '../../services/bot/QueueWorker';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { SettingService } from '../../services/bot/SettingService';
import { SlashCommandBuilder, TextChannel } from 'discord.js';

export default class UpdateCommand extends BaseCommand {
    name = 'update';
    description = 'Update your Last.fm index with your latest scrobbles';
    aliases = ['u', 'refresh', 'index'];

    slashData = new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update your Last.fm index with your latest scrobbles');

    async execute(interactionOrMessage: any, isSlash = false): Promise<void> {
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });
        const embedColor = dbUser ? SettingService.resolveAccentColor(dbUser) : 0x8050ff;

        if (!dbUser?.lastfmUsername) {
            const payload = new ComponentsV2()
                .setAccent(0xff4444)
                .addText('❌ You are not linked to Last.fm yet. Use `/login` to connect your account.')
                .build();
            if (isSlash) await interactionOrMessage.reply({ ...payload, ephemeral: true });
            else await interactionOrMessage.channel.send(payload);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { (interactionOrMessage.channel as TextChannel).sendTyping(); } catch {} }

        try {
            // Fetch Last.fm live data + local DB count in parallel
            const [lfmInfo, localCount] = await Promise.all([
                LastFM.getUserInfo(dbUser.lastfmUsername, dbUser.lastfmSessionKey),
                prisma.userPlay.count({ where: { userId: dbUser.id } })
            ]);

            const lfmTotal = parseInt(lfmInfo?.playcount || '0', 10);
            const gap = Math.max(0, lfmTotal - localCount);

            const settings = (dbUser.settings as any) || {};
            const lastSyncUts: number = settings.lastSyncTimestamp || 0;

            // Queue a forced delta sync — fetches plays since lastSyncTimestamp and diffs them.
            // This is exactly what FMBot's /update does: surgical, not a full wipe.
            // The new (userId, timePlayed, artistName, trackName) unique constraint means
            // previously-dropped duplicate-timestamp plays will now be correctly inserted.
            await triggerDeltaSync(userId, true);

            // Build response
            const builder = new ComponentsV2().setAccent(embedColor);
            builder.addText(`### Last.fm Indexing Update for ${dbUser.lastfmUsername}`);

            builder.addText(
                `📊 **Last.fm:** ${lfmTotal.toLocaleString()} plays\n` +
                `💾 **Local DB:** ${localCount.toLocaleString()} plays`
            );

            if (gap > 0) {
                builder.addText(`⏳ **${gap.toLocaleString()} play${gap === 1 ? '' : 's'}** queued to be indexed.`);
            } else {
                builder.addText(`✅ Your index is already **up to date!**`);
            }

            if (lastSyncUts > 0) {
                builder.addText(`-# Last synced <t:${lastSyncUts}:R>`);
            }

            builder.addSeparator();
            builder.addText(`-# 🔄 Delta sync queued — fetching plays since last sync.`);


            const payload = builder.build();
            if (isSlash) await interactionOrMessage.editReply(payload);
            else await interactionOrMessage.channel.send(payload);

        } catch (err: any) {
            const errPayload = new ComponentsV2()
                .setAccent(0xff4444)
                .addText(`❌ **Update failed:** ${err.message || 'An unknown error occurred.'}`)
                .build();
            if (isSlash) await interactionOrMessage.editReply(errPayload);
            else await interactionOrMessage.channel.send(errPayload);
        }
    }
}
