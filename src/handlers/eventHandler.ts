import { Client } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { LoggerService } from '../services/bot/LoggerService';

export async function loadEvents(client: Client) {
    const eventsPath = join(__dirname, '../events');
    const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of eventFiles) {
        const fileUrl = pathToFileURL(join(eventsPath, file)).href;
        const imported = await import(fileUrl);
        const event = imported.default?.default || imported.default || imported;

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }

    // Global Error Listeners
    client.on('error', (err) => LoggerService.error('Discord Client Error', err, 'Discord'));
    client.on('warn', (m) => LoggerService.warn(m, 'Discord'));

    LoggerService.info('Event handlers loaded', 'EventHandler');
}
