import { Client, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { config } from '../config';
import { initBotProfile } from './services/bot/BotProfile';
import { PuppeteerService } from './services/external/PuppeteerService';
import { LoggerService } from './services/bot/LoggerService';
import { CronManager } from './services/bot/CronManager';
import { Shoukaku, Connectors } from 'shoukaku';
import http from 'http';
import dns from 'dns';
import './services/bot/QueueWorker'; // Initialize background worker immediately
import { lavaSrcNodes } from './services/music/NodeCapabilities';

// Force use of reliable DNS servers to bypass local ENOTFOUND issues
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
import { MongoService } from './database/mongo';

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

export const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), config.LAVALINK_NODES, {
    moveOnDisconnect: true,
    resume: true,
    reconnectTries: 100,
    reconnectInterval: 10000,
    restTimeout: 15000
});

// Override default node resolver to deprioritize degraded nodes
import { sortNodesByQuality } from './services/music/DegradedNodes';
shoukaku.options.nodeResolver = (nodes) => {
    const sorted = sortNodesByQuality(nodes);
    return sorted[0];
};

shoukaku.on('error', (name, error) => {
    // Silence common connection spam, only log critical errors
    const msg = error.message || String(error);
    if (msg.includes('ENOTFOUND') || msg.includes('429') || msg.includes('ECONNREFUSED')) {
        return; // Ignore unreachable/rate-limited nodes silently
    }
    console.error(`[Lavalink] Node ${name} error:`, msg);
});
shoukaku.on('ready', async (name) => {
    console.log(`[Lavalink] 🟢 Node ${name} is ready!`);
    
    // Probe for LavaSrc support
    const node = shoukaku.nodes.get(name);
    if (node) {
        try {
            const res = await node.rest.resolve('spsearch:test') as any;
            if (res && res.loadType !== 'error' && res.loadType !== 'empty') {
                lavaSrcNodes.add(name);
                console.log(`[Lavalink] ✅ Node ${name} supports LavaSrc (Spotify)`);
            }
        } catch {}
    }
});
shoukaku.on('close', (name, code, reason) => {
    if (code !== 1000) console.warn(`[Lavalink] 🟡 Node ${name} closed (Code: ${code})`);
});
shoukaku.on('disconnect', (name, players) => {
    // When a node drops, immediately try to recover any active guild playback on that node
    if (players && players > 0) {
        console.warn(`[Lavalink] 🔌 Node ${name} disconnected with ${players} active player(s). Triggering recovery...`);
        setTimeout(async () => {
            const { MusicPlayer } = await import('./services/music/MusicPlayer');
            const { QueueManager } = await import('./services/music/QueueManager');
            for (const [guildId, queue] of QueueManager.getAllQueues()) {
                if (queue.isPlaying && queue.player?.node?.name === name) {
                    console.log(`[Lavalink] 🔄 Recovering guild ${guildId} after node ${name} disconnect...`);
                    MusicPlayer.recoverPlayback(guildId).catch(() => {});
                }
            }
        }, 1500);
    }
});

// Periodic check to revive nodes that completely died after retries exhausted
setInterval(() => {
    for (const node of config.LAVALINK_NODES) {
        if (!shoukaku.nodes.has(node.name)) {
            try {
                shoukaku.addNode(node);
                // Silently attempt to re-add
            } catch (e) {
                // Ignore
            }
        }
    }
}, 60000); // Check every minute

// Periodic log of connected nodes and their ping/quality
const logNodes = () => {
    const activeNodes = Array.from(shoukaku.nodes.values());
    if (activeNodes.length === 0) return;
    
    console.log(`\n--- [Lavalink] Active Nodes Status ---`);
    activeNodes.forEach(node => {
        const penalty = node.penalties || 0;
        const players = node.stats ? node.stats.players : 0;
        console.log(`- ${node.name}: Penalty Score: ${penalty} | Active Players: ${players}`);
    });
    console.log(`--------------------------------------\n`);
};

setInterval(logNodes, 5 * 60 * 60 * 1000); // Check every 5 hours

// Proactive node probing every 2 minutes
setInterval(async () => {
    try {
        const { recordSuccess, recordFailure } = await import('./services/music/NodeCircuitBreaker');
        for (const node of shoukaku.nodes.values()) {
            if (node.state !== 1) continue;
            try {
                const res = await Promise.race([
                    node.rest.resolve('ytsearch:test'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500))
                ]);
                if (res) {
                    recordSuccess(node.name);
                } else {
                    recordFailure(node.name);
                }
            } catch {
                recordFailure(node.name);
            }
        }
    } catch { /* ignore */ }
}, 120000);

// Capture bot kicks and moves from voice channels
client.on('voiceStateUpdate', async (oldState, newState) => {
    const selfId = client.user?.id;
    if (!selfId) return;

    if (oldState.member?.id === selfId) {
        const guildId = oldState.guild.id;
        try {
            const { QueueManager } = await import('./services/music/QueueManager');
            const { MusicPlayer } = await import('./services/music/MusicPlayer');
            const queue = QueueManager.getQueue(guildId);
            if (!queue) return;

            // 1. Kicked from channel
            if (oldState.channelId && !newState.channelId) {
                console.log(`[VoiceState] Bot was kicked from voice channel in guild ${guildId}. Cleaning up.`);
                MusicPlayer.stop(guildId);
            }
            // 2. Moved to another channel
            else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                console.log(`[VoiceState] Bot was moved to channel ${newState.channelId} in guild ${guildId}. Recovering...`);
                queue.voiceChannelId = newState.channelId;
                MusicPlayer.recoverPlayback(guildId).catch(() => {});
            }
        } catch { /* ignore */ }
    }
});

async function bootstrap() {
    // 1. Initialize Databases
    await MongoService.connect();

    // 2. Load Command Registry
    await loadCommands(client);

    // 2. Load Modular Events
    await loadEvents(client);

    // 3. Warm up Puppeteer Pool
    PuppeteerService.warmUp().catch(err => LoggerService.error('Puppeteer Warmup Failed', err, 'Bootstrap'));

    // 4. Login
    await client.login(config.DISCORD_TOKEN);

    // Restore queue snapshots from database
    client.once('ready', async () => {
        setTimeout(async () => {
            try {
                const { prisma } = await import('./database/client');
                const { MusicPlayer } = await import('./services/music/MusicPlayer');
                const snaps = await prisma.queueSnapshot.findMany({});
                if (snaps.length > 0) {
                    console.log(`[Snapshot] Found ${snaps.length} queue snapshot(s) to restore.`);
                    for (const snap of snaps) {
                        console.log(`[Snapshot] Restoring queue for guild ${snap.guildId}...`);
                        await MusicPlayer.restoreFromSnapshot(snap).catch(e => {
                            console.error(`[Snapshot] Failed to restore guild ${snap.guildId}:`, e);
                        });
                    }
                    await prisma.queueSnapshot.deleteMany({});
                }
            } catch (err) {
                console.error('[Snapshot] Failed to restore queue snapshots:', err);
            }
        }, 5000);
    });

    // 5. Post-Login Initialization
    await initBotProfile();

    // 6. Start BullMQ Cron Jobs (stale sync, duration backfill, health checks, drift detection)
    await CronManager.start();

    // 6. Simple Health Check for Railway
    http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Bot is alive');
    }).listen(process.env.PORT || 3000);
}

async function handleShutdown() {
    console.log('[Bot] 🛑 Shutdown signal received. Saving queue snapshots...');
    try {
        const { QueueManager } = await import('./services/music/QueueManager');
        const { MusicPlayer } = await import('./services/music/MusicPlayer');
        const { prisma } = await import('./database/client');

        const activeQueues = QueueManager.getAllQueues();
        await prisma.queueSnapshot.deleteMany({});

        for (const [guildId, queue] of activeQueues) {
            if (queue.currentTrack) {
                const positionMs = MusicPlayer.getPosition(queue);
                await prisma.queueSnapshot.create({
                    data: {
                        guildId,
                        voiceChannelId: queue.voiceChannelId,
                        textChannelId: queue.textChannel.id,
                        currentTrack: JSON.stringify(queue.currentTrack),
                        tracks: JSON.stringify(queue.tracks),
                        positionMs
                    }
                });
                console.log(`[Snapshot] Saved queue snapshot for guild ${guildId} at position ${positionMs}ms`);
            }
        }
    } catch (err) {
        console.error('[Shutdown] Failed to save queue snapshots:', err);
    } finally {
        process.exit(0);
    }
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

bootstrap().catch(err => {
    console.error('Fatal bootstrap error:', err);
});
