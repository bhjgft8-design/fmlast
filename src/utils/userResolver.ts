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
        // Message commands: check mentions
        const mention = interactionOrMessage.mentions?.users?.first();
        if (mention) return mention;

        // Message commands: check if an ID or username was provided?
        // For now, sticking to mentions to keep it simple and safe.
        return interactionOrMessage.author;
    }
}
