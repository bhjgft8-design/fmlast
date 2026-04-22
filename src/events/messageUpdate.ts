import { Message, Client, Events } from 'discord.js';
import { handleUpdate } from '../handlers/interactionHandler';

export default {
    name: Events.MessageUpdate,
    async execute(oldMsg: Message, newMsg: Message, client: Client) {
        await handleUpdate(oldMsg, newMsg);
    }
};
