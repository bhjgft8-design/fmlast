import { Client, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { config } from '../config';
import { initBotProfile } from './services/bot/BotProfile';
import { PuppeteerService } from './services/external/PuppeteerService';
import { LoggerService } from './services/bot/LoggerService';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

async function bootstrap() {
    // 1. Load Command Registry
    await loadCommands(client);

    // 2. Load Modular Events
    await loadEvents(client);

    // 3. Warm up Puppeteer Pool
    PuppeteerService.warmUp().catch(err => LoggerService.error('Puppeteer Warmup Failed', err, 'Bootstrap'));

    // 4. Login
    await client.login(config.DISCORD_TOKEN);

    // 5. Post-Login Initialization
    await initBotProfile();
}

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
});
