import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import { TextChannel, ComponentType, ButtonStyle } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';

export default class LogoutCommand extends BaseCommand {
    name = 'logout';
    description = 'Unlink your Last.fm account from the bot';
    aliases = ['lo'];

    slashData = new (require('discord.js').SlashCommandBuilder)()
        .setName('logout')
        .setDescription('Unlink your Last.fm account from the bot');

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {

        if (!isSlash) {
            try {
                (interactionOrMessage.channel as TextChannel).sendTyping();
            } catch (err) { }
        }

        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;

        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });

        if (!dbUser?.lastfmSessionKey) {
            const payload = new ComponentsV2()
                .setAccent(0xff0000) // Red
                .addText(`❌ **Not Linked**\nYou aren't currently linked to a Last.fm account.`)
                .build();

            if (isSlash) {
                await interactionOrMessage.reply({ ...payload, ephemeral: true });
            } else {
                await interactionOrMessage.channel.send(payload);
            }
            return;
        }

        const confirmPayload = new ComponentsV2()
            .setAccent(0xffcc00) // Warning accent (gold/yellow)
            .addText(`⚠️ **Confirm Last.fm Logout**\n\nAre you sure you want to unlink your Last.fm account (**${dbUser.lastfmUsername}**) from the bot?\n\n**Warning: This action is permanent!** This will delete your local records, including custom settings, stats, RPG progress, and scrobble cache.`)
            .addRow([
                { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Unlink Account', custom_id: 'confirm_logout', emoji: { name: '🗑️' } },
                { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Cancel', custom_id: 'cancel_logout', emoji: { name: '❌' } }
            ])
            .build();

        let message: any;
        if (isSlash) {
            message = await interactionOrMessage.reply({ ...confirmPayload, ephemeral: true, fetchReply: true });
        } else {
            message = await interactionOrMessage.channel.send(confirmPayload);
        }

        const collector = message.createMessageComponentCollector({
            filter: (i: any) => i.user.id === userId,
            time: 30000
        });

        collector.on('collect', async (i: any) => {
            if (i.customId === 'confirm_logout') {
                // Completely delete the user record. 
                // Cascade deletes in schema.prisma will handle wiping plays, collections, contributions, etc.
                await prisma.user.delete({
                    where: { discordId: userId }
                }).catch(() => {});

                const successPayload = new ComponentsV2()
                    .setAccent(0x5865F2) // Blurple
                    .addText(`✅ **Successfully Logged Out**\nYour Last.fm account (**${dbUser.lastfmUsername}**) has been unlinked from the bot.`)
                    .build();

                await i.update(successPayload);
                collector.stop('confirmed');
            } else if (i.customId === 'cancel_logout') {
                const cancelPayload = new ComponentsV2()
                    .setAccent(0x5865F2) // Blurple
                    .addText(`❌ **Logout Cancelled**\nYour account remains linked.`)
                    .build();

                await i.update(cancelPayload);
                collector.stop('cancelled');
            }
        });

        collector.on('end', async (collected: any, reason: string) => {
            if (reason === 'time') {
                try {
                    const timeoutPayload = new ComponentsV2()
                        .setAccent(0x747f8d) // Grey
                        .addText(`⌛ **Logout Request Timed Out**\nNo confirmation received. Your account remains linked.`)
                        .build();

                    if (isSlash) {
                        await interactionOrMessage.editReply(timeoutPayload);
                    } else {
                        await message.edit(timeoutPayload);
                    }
                } catch (err) {
                    // Ignore errors (e.g. if the message was deleted)
                }
            }
        });
    }
}
