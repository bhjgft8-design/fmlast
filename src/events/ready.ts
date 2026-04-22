import { Client, Events } from 'discord.js';
import { LoggerService } from '../services/bot/LoggerService';
import { commands } from '../handlers/commandHandler';

export default {
    name: Events.ClientReady,
    once: true,
    execute(client: Client) {
        const commandCount = commands.size;
        LoggerService.banner(client.user?.tag ?? 'Unknown', commandCount);
    }
};
