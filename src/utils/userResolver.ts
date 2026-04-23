import { User } from 'discord.js';

/**
 * Resolves a target user from a message or slash interaction.
 * Handles mentions in messages and a 'user' option in slash commands.
 * Falls back to the command executor.
 */
export async function resolveTargetUser(interactionOrMessage: any, isSlash: boolean): Promise<User> {
    if (isSlash) {
        // Slash commands: check 'user' option
        const userOption = interactionOrMessage.options.getUser('user');
        return userOption || interactionOrMessage.user;
    } else {
        // Message commands: check for mentions in the message content
        // We filter out the user if the only reason they are mentioned is a reply.
        // mentions.users contains both text-mentions and the user being replied to.
        const mentions = interactionOrMessage.mentions;
        const firstMention = mentions?.users?.first();

        if (firstMention) {
            // Check if the user's ID is actually present in the message text as a mention
            const mentionRegex = new RegExp(`<@!?${firstMention.id}>`);
            if (mentionRegex.test(interactionOrMessage.content)) {
                return firstMention;
            }
        }

        return interactionOrMessage.author;
    }
}
