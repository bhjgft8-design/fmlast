import { Interaction, Client, Events } from 'discord.js';
import { handleInteraction } from '../handlers/interactionHandler';

export default {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction, client: Client) {
        await handleInteraction(interaction, client);
    }
};
