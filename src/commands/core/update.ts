import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { triggerDeltaSync, triggerFullSync } from '../../services/bot/QueueWorker';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { SettingService } from '../../services/bot/SettingService';
import { SlashCommandBuilder, TextChannel } from 'discord.js';

export default class UpdateCommand extends BaseCommand {
    name = 'update';
    description = 'Update your Last.fm index with your latest scrobbles';
    aliases = ['up', 'refresh', 'index'];

    slashData = new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update your Last.fm index with your latest scrobbles')
        .addStringOption(opt => opt.setName('type').setDescription('Full re-index (caution)').addChoices({ name: 'full', value: 'full' }));

    async execute(interactionOrMessage: any, isSlash = false, channel?: any, args: string[] = []): Promise<void> {
        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });
        const embedColor = dbUser ? SettingService.resolveAccentColor(dbUser) : 0x8050ff;

        const isFull = isSlash ? interactionOrMessage.options.getString('type') === 'full' : args[0]?.toLowerCase() === 'full';

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
            // Fetch Last.fm live data + local DB count in parallel (Bypass cache for accuracy)
            const [lfmInfo, localCount] = await Promise.all([
                LastFM.getUserInfo(dbUser.lastfmUsername, dbUser.lastfmSessionKey, true),
                prisma.userPlay.count({ where: { userId: dbUser.id } })
            ]);

            const lfmTotal = parseInt(lfmInfo?.playcount || '0', 10);
            const gap = lfmTotal - localCount;

            const settings = (dbUser.settings as any) || {};
            const lastSyncUts: number = settings.lastSyncTimestamp || 0;

            // Build response
            const builder = new ComponentsV2().setAccent(embedColor);
            builder.addText(`### Last.fm Indexing Update for ${dbUser.lastfmUsername}`);

            if (isFull) {
                await triggerFullSync(userId);
                builder.addText(`🚀 **Full Re-index Triggered!**\nYour local data is being wiped and re-built from Last.fm to fix major drift. This may take a few minutes.`);
            } else {
                await triggerDeltaSync(userId, true);
                builder.addText(
                    `📊 **Last.fm:** ${lfmTotal.toLocaleString()} plays\n` +
                    `💾 **Local DB:** ${localCount.toLocaleString()} plays`
                );

                if (gap > 0) {
                    builder.addText(`⏳ **${gap.toLocaleString()} play${gap === 1 ? '' : 's'}** missing from local index. Syncing now...`);
                } else if (gap < 0) {
                    builder.addText(`⚠️ **Drift Detected:** Local DB is ahead by **${Math.abs(gap).toLocaleString()}** plays. This happens if you delete scrobbles on Last.fm. ` +
                        `Run \`-update full\` to perform a clean re-index.`);
                } else {
                    builder.addText(`✅ Your index is perfectly **up to date!**`);
                }
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
