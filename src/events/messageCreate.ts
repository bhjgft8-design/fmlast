import { Message, Client, Events } from 'discord.js';
import { handleMessage } from '../handlers/interactionHandler';

export default {
    name: Events.MessageCreate,
    async execute(message: Message, client: Client) {
        await handleMessage(message, client);
    }
};
