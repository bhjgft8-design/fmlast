import { BaseCommand } from '../../structures/BaseCommand';
import { FriendService } from '../../services/bot/FriendService';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { SlashCommandBuilder } from 'discord.js';

export default class TasteCommand extends BaseCommand {
    name = 'taste';
    description = 'Compare your musical taste affinity with a friend';

    slashData = new SlashCommandBuilder()
        .setName('taste')
        .setDescription('Compare your musical taste affinity with a friend')
        .addUserOption(opt => opt.setName('user').setDescription('The user to compare with').setRequired(true));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        let targetUser: any = null;

        if (isSlash) {
            targetUser = interactionOrMessage.options.getUser('user');
            await interactionOrMessage.deferReply();
        } else {
            const mentionStr = args?.[0] || '';
            const mentionMatch = mentionStr.match(/<@!?(\d+)>/);
            const targetId = mentionMatch ? mentionMatch[1] : mentionStr;

            if (targetId) {
                targetUser = await interactionOrMessage.client.users.fetch(targetId).catch(() => null);
            }
        }

        const author = isSlash ? interactionOrMessage.user : interactionOrMessage.author;

        if (!targetUser) {
            const reply = '❌ Please mention a valid user to compare taste with (`/taste @user`).';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        if (targetUser.id === author.id) {
            const reply = '❌ You have a 100% taste match with yourself!';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        try {
            const result = await FriendService.getTasteAffinity(author.id, targetUser.id);
            
            let color = 0x8a2be2; // Purple default
            if (result.percent > 85) color = 0x00ff00; // Green for high match
            else if (result.percent > 50) color = 0xffff00; // Yellow for mid
            else if (result.percent < 20) color = 0xff0000; // Red for low

            let desc = result.sharedArtists.length === 0 
                ? "You two literally have completely different taste. Nothing in common!" 
                : `You share **${result.sharedArtists.length}** artists in your top 150!`;

            if (result.sharedArtists.length > 0) {
                desc += `\n\n**Top Overlapping Artists:**\n`;
                for (let i = 0; i < Math.min(result.sharedArtists.length, 10); i++) {
                    const artist = result.sharedArtists[i];
                    desc += `🎧 **${artist.name}**\n`;
                }
            }

            const builder = new ComponentsV2()
                .setAccent(color)
                .addText(`### 🎼 Taste Affinity: **${result.percent}%**\n**${result.u1Name}** & **${result.u2Name}**\n\n${desc}`);

            const payload = builder.build();

            if (isSlash) {
                await interactionOrMessage.editReply(payload);
            } else {
                await interactionOrMessage.reply(payload);
            }

        } catch (err: any) {
            const reply = `❌ **Error:** ${err.message}`;
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }
    }
}
