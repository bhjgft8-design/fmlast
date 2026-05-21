import { shoukaku, client } from '../../index';
import { Player } from 'shoukaku';
import { UserHistory } from '../../models/UserHistory';
import { YoutubeResult } from '../api/Youtube';
import { VoiceChannel, TextChannel } from 'discord.js';
import { ScrobbleService } from '../bot/ScrobbleService';
import { config } from '../../../config';
import { QueueManager, GuildQueue } from './QueueManager';
import { VoiceStatusService } from './VoiceStatusService';
import VoteSkipCommand from '../../commands/music/voteskip';
import { MusicUIController } from './MusicUIController';
import { degradedNodes, sortNodesByQuality, recordNodeResult } from './DegradedNodes';
import { ResolutionCache } from '../../utils/ResolutionCache';
import { lavaSrcNodes } from './NodeCapabilities';
import { playbackLock } from '../../utils/AsyncLock';
import { prisma } from '../../database/client';

const ARTIST_OVERRIDES: Record<string, { cluster: string, related?: string[] }> = {
    'zaf': {
        cluster: 'arabic',
        related: ['young giza', 'HAITHAM', 'ZDAN', 'zalka', 'ZIEN4L', 'ghassan', 'dokshan', 'Wg sad', 'kingoo', 'omar gangster', 'begad', '$savage', 'karim enzo', 'salah tayer', 'qetoo']
    },
};

export class MusicPlayer {
    private static resolveWithTimeout(node: any, query: string, timeoutMs = 2000): Promise<any> {
        return Promise.race([
            node.rest.resolve(query),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
        ]);
    }

    private static async resolveOnBestNode(
        nodes: any[],
        query: string,
        currentPlayerNodeName?: string,
        player?: any
    ): Promise<any | null> {
        if (nodes.length === 0) return null;

        // Race all nodes simultaneously instead of sequential await
        const raceResults = await Promise.any(
            nodes.map(async (node) => {
                const startTime = Date.now();
                try {
                    const res = await this.resolveWithTimeout(node, query, 2000);
                    if (!res?.data || res.loadType === 'empty' || res.loadType === 'error') {
                        throw new Error(`Node ${node.name} returned no data`);
                    }
                    recordNodeResult(node.name, true, Date.now() - startTime);
                    return { node, res };
                } catch (err: any) {
                    recordNodeResult(node.name, false, Date.now() - startTime);
                    degradedNodes.set(node.name, Date.now());
                    throw err;
                }
            })
        ).catch(() => null);

        if (!raceResults) return null;

        const { node, res } = raceResults;
        const track = Array.isArray(res.data) ? res.data[0] : res.data;

        // Migrate player to the winning node if it's different
        if (player && currentPlayerNodeName && node.name !== currentPlayerNodeName) {
            console.log(`[MusicPlayer] 🔀 Migrating player from "${currentPlayerNodeName}" to "${node.name}"`);
            (player as any).track = null; // Clear track to prevent Shoukaku from auto-resuming the old failed track
            await player.move(node.name).catch(() => {});
        }

        return track;
    }

    private static prefetchCache = new Map<string, string>(); // url/title -> encoded

    private static async prefetchNextTrack(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return;
        
        let next = queue.tracks[0];
        if (!next && queue.mixContext) {
            const { songs, index } = queue.mixContext;
            if (index < songs.length) {
                next = songs[index];
            }
        }
        
        if (!next) return;
        const cacheKey = next.url || next.title;
        if (this.prefetchCache.has(cacheKey)) return;

        let nodes = sortNodesByQuality(shoukaku.nodes);
        const isSpotifyUrl = next.url?.includes('open.spotify.com');

        if (isSpotifyUrl) {
            nodes = nodes.filter(n => lavaSrcNodes.has(n.name));
        }

        let query = next.url || `spsearch:${next.artistName} ${next.trackTitle}`;
        if (isSpotifyUrl && nodes.length === 0) {
            console.warn(`[Prefetch] No LavaSrc nodes available for ${next.title}, falling back to search`);
            query = `spsearch:${next.artistName} ${next.trackTitle}`;
            nodes = sortNodesByQuality(shoukaku.nodes);
        }
        
        const result = await this.resolveOnBestNode(nodes, query).catch(() => null);
        if (result?.encoded) {
            this.prefetchCache.set(cacheKey, result.encoded);
            console.log(`[Prefetch] ✅ Pre-resolved next track: ${next.title}`);
        }
    }

    static async join(guildId: string, voiceChannelId: string, textChannel: TextChannel): Promise<GuildQueue> {
        let queue = QueueManager.getQueue(guildId);

        if (!queue || !queue.player) {
            let player: Player | undefined;

            try {
                console.log(`[MusicPlayer] 🛰️ Attempting to join voice...`);
                const guild = client.guilds.cache.get(guildId);
                const shardId = guild?.shardId ?? 0;

                player = await shoukaku.joinVoiceChannel({
                    guildId: guildId,
                    channelId: voiceChannelId,
                    shardId: shardId,
                    deaf: true
                });
                console.log(`[MusicPlayer] ✅ Successfully joined using node: ${player.node.name}`);
            } catch (err: any) {
                console.error(`[MusicPlayer] ❌ Failed to join voice channel: ${err.message}`);
                throw err;
            }

            if (!queue) {
                queue = QueueManager.createQueue(guildId, textChannel, voiceChannelId, player);
            } else {
                queue.player = player;
            }

            this.setupPlayerEvents(guildId);
        }

        return queue;
    }

    static async play(guildId: string, track?: YoutubeResult): Promise<number> {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return 0;

        const wasEmpty = queue.tracks.length === 0 && !queue.isPlaying;

        if (track) {
            QueueManager.addTrack(guildId, track);
        }

        // Proactively prefetch the next track if we are already playing to ensure gapless transitions and instant skips
        if (track && queue.isPlaying) {
            this.prefetchNextTrack(guildId).catch(() => {});
        }

        // Kickstart the queue process
        this.processQueue(guildId).catch(err => {
            console.error(`[MusicPlayer] play() processQueue error:`, err);
        });

        return wasEmpty ? 0 : queue.tracks.length;
    }

    static skip(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player) {
            this.stopProgressUpdate(guildId);
            queue.player.stopTrack().catch(() => {});
            return true;
        }
        return false;
    }

    static cleanupGuild(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return;

        // Intervals
        if (queue.progressInterval) {
            clearInterval(queue.progressInterval);
            queue.progressInterval = undefined;
        }
        if (queue.inactivityTimer) {
            clearTimeout(queue.inactivityTimer);
            queue.inactivityTimer = undefined;
        }

        // Watchdog
        const watchdog = this.watchdogIntervals.get(guildId);
        if (watchdog) {
            clearInterval(watchdog);
            this.watchdogIntervals.delete(guildId);
        }

        // Player listeners
        queue.player?.removeAllListeners();

        // Prefetch cache entries for this guild's tracks
        queue.tracks.forEach(t => MusicPlayer.prefetchCache.delete(t.url || t.title));
    }

    static getPosition(queue: GuildQueue): number {
        if (!queue.lastKnownPosition || !queue.lastPositionTimestamp) return 0;
        if (queue.state.is('paused')) return queue.lastKnownPosition;
        return queue.lastKnownPosition + (Date.now() - queue.lastPositionTimestamp);
    }

    static stop(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue) {
            queue.state.transition('stopped');
            VoiceStatusService.clearStatus(client, queue.voiceChannelId);
            VoiceStatusService.updatePresence(client, null);
            this.cleanupGuild(guildId);
        }
        QueueManager.deleteQueue(guildId);
        return true;
    }

    static shuffle(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue) {
            QueueManager.shuffleQueue(guildId);
            MusicUIController.updateNowPlayingMessage(guildId);
            return true;
        }
        return false;
    }

    static pause(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player && !queue.state.is('paused')) {
            queue.player.setPaused(true);
            queue.state.transition('paused');
            queue.isPaused = true;
            this.stopProgressUpdate(guildId);
            MusicUIController.updateNowPlayingMessage(guildId);
            return true;
        }
        return false;
    }

    static resume(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player && queue.state.is('paused')) {
            queue.player.setPaused(false);
            queue.state.transition('playing');
            queue.isPaused = false;
            this.startProgressUpdate(guildId);
            MusicUIController.updateNowPlayingMessage(guildId);
            return true;
        }
        return false;
    }

    static async restoreFromSnapshot(snap: any) {
        const guild = client.guilds.cache.get(snap.guildId);
        if (!guild) return;

        const textChannel = guild.channels.cache.get(snap.textChannelId) as TextChannel;
        if (!textChannel) return;

        try {
            const currentTrack = JSON.parse(snap.currentTrack);
            const tracks = JSON.parse(snap.tracks);
            
            // Join channel
            const queue = await this.join(snap.guildId, snap.voiceChannelId, textChannel);
            if (!queue) return;

            // Re-populate queue
            queue.currentTrack = currentTrack;
            queue.tracks = tracks;
            
            // Resolve track on the best available node
            const nodes = sortNodesByQuality(shoukaku.nodes);
            let lavalinkTrack = null;
            if (currentTrack.url) {
                lavalinkTrack = await this.resolveOnBestNode(nodes, currentTrack.url);
            }
            if (!lavalinkTrack) {
                const searchStr = currentTrack.artistName && currentTrack.trackTitle ? `${currentTrack.artistName} ${currentTrack.trackTitle}` : currentTrack.title;
                lavalinkTrack = await this.resolveOnBestNode(nodes, `spsearch:${searchStr}`);
            }

            if (lavalinkTrack?.encoded) {
                queue.isPlaying = true;
                queue.state.transition('playing');
                queue.lastPlayedTrack = currentTrack;
                this.setupPlayerEvents(snap.guildId);
                
                await queue.player?.playTrack({ track: { encoded: lavalinkTrack.encoded } });
                
                if (snap.positionMs > 2000) {
                    await new Promise(r => setTimeout(r, 1000));
                    await queue.player?.seekTo(snap.positionMs).catch(() => {});
                }
                
                const mins = Math.floor(snap.positionMs / 60000);
                const secs = String(Math.floor((snap.positionMs % 60000) / 1000)).padStart(2, '0');
                textChannel.send(
                    `🔄 **Playback restored** after bot restart — resuming **${currentTrack.artistName || ''} ${currentTrack.trackTitle || currentTrack.title}** from \`${mins}:${secs}\``
                ).catch(() => {});
            }
        } catch (err: any) {
            console.error(`[Snapshot] Restore failed for guild ${snap.guildId}:`, err);
        }
    }

    static async getLyrics(guildId: string): Promise<any | null> {
        const queue = QueueManager.getQueue(guildId);
        if (!queue?.currentTrack) return null;

        const track = queue.currentTrack;
        const artist = track.artistName || track.channelTitle.replace(' - Topic', '');
        const title = track.trackTitle || track.title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
        const duration = track.durationSeconds || 0;

        try {
            const params = new URLSearchParams({
                artist_name: artist,
                track_name: title,
                ...(duration ? { duration: String(duration) } : {})
            });

            const res = await fetch(`https://lrclib.net/api/get?${params}`, {
                headers: { 'User-Agent': 'fm-discord-bot/1.0' }
            });

            if (!res.ok) return null;
            const data = await res.json() as any;

            if (data.syncedLyrics) {
                const lines = data.syncedLyrics
                    .split('\n')
                    .filter((l: string) => l.match(/^\[\d+:\d+/))
                    .map((l: string) => {
                        const match = l.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
                        if (!match) return null;
                        const ms = (parseInt(match[1]) * 60 + parseFloat(match[2])) * 1000;
                        return { timestamp: Math.floor(ms), line: match[3].trim() };
                    })
                    .filter(Boolean);

                return { lines, text: data.plainLyrics };
            }

            if (data.plainLyrics) {
                return { lines: null, text: data.plainLyrics };
            }

            return null;
        } catch (err: any) {
            console.warn('[MusicPlayer] LRCLib lyrics failed:', err.message);
            return null;
        }
    }

    static async setFilters(guildId: string, filters: any): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player) {
            await queue.player.setFilters(filters);
        }
    }

    static async seek(guildId: string, positionMs: number): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player) {
            await queue.player.seekTo(positionMs);
        }
    }

    static async setVolume(guildId: string, volume: number): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (queue && queue.player) {
            await queue.player.setGlobalVolume(volume);
        }
    }

    static toggleAutoplay(guildId: string): boolean {
        const queue = QueueManager.getQueue(guildId);
        if (queue) {
            queue.autoplay = !queue.autoplay;
            this.updateNowPlayingMessage(guildId);
            return queue.autoplay;
        }
        return false;
    }

    static async updateNowPlayingMessage(guildId: string): Promise<void> {
        return MusicUIController.updateNowPlayingMessage(guildId);
    }

    private static async handleAutoplay(guildId: string, queue: GuildQueue) {
        if (!queue.autoplay || !queue.currentTrack) return null;

        try {
            console.log(`[MusicPlayer] 🤖 Last.fm Autoplay triggered for guild ${guildId}`);
            const currentArtist = queue.currentTrack.artistName || '';
            const currentTitle = queue.currentTrack.trackTitle || queue.currentTrack.title;
            if (!currentArtist) return null;

            // Notify user
            queue.textChannel.send('🎵 **Autoplay**: Finding similar tracks...').then(m => setTimeout(() => m.delete().catch(() => {}), 5000));

            const { LastFM } = await import('../api/LastFM');
            const { TrackResolverService } = await import('../api/TrackResolverService');
            const { MetadataService } = await import('../bot/MetadataService');

            let similar: any[] = [];
            const manualOverride = ARTIST_OVERRIDES[currentArtist.toLowerCase()];
            
            if (manualOverride?.related) {
                const randomRelated = manualOverride.related.sort(() => Math.random() - 0.5).slice(0, 5);
                for (const relatedArtist of randomRelated) {
                    try {
                        const top = await LastFM.getArtistTopTracks(relatedArtist, 3);
                        similar.push(...top);
                    } catch {}
                }
            }

            if (similar.length === 0) {
                similar = await LastFM.getSimilarTracks(currentArtist, currentTitle, 20);
            }
            if (!similar || similar.length === 0) {
                similar = await LastFM.getArtistTopTracks(currentArtist, 20);
            }

            if (similar && similar.length > 0) {
                // Deduplicate
                const seen = new Set<string>();
                const uniqueSimilar = similar.filter(t => {
                    const key = `${t.artist?.name || t.artist?.['#text']}-${t.name}`.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).sort(() => Math.random() - 0.5);

                const recentlyPlayed = [currentTitle.toLowerCase()];
                const filtered = uniqueSimilar.filter((t: any) => {
                    const tName = t.name.toLowerCase();
                    return !recentlyPlayed.includes(tName);
                });

                const candidates = filtered.slice(0, 15);
                let firstTrack: YoutubeResult | null = null;
                
                console.log(`[MusicPlayer] 🤖 Checking ${candidates.length} candidates for autoplay...`);

                for (const t of candidates) {
                    const artist = t.artist?.name || t.artist?.['#text'] || currentArtist;
                    try {
                        const resolved = await TrackResolverService.resolve(artist, t.name);
                        if (!resolved.links.youtube) continue;

                        const trackObj: YoutubeResult = {
                            id: t.mbid || String(Math.random()),
                            title: `${artist} - ${t.name}`,
                            url: resolved.links.youtube,
                            thumbnail: resolved.artworkUrl || '',
                            channelTitle: artist,
                            artistName: artist,
                            trackTitle: t.name,
                            requesterName: 'Autoplay'
                        };

                        await MetadataService.enrich(trackObj, null, null);
                        
                        if (!firstTrack) {
                            firstTrack = trackObj;
                            console.log(`[MusicPlayer] 🤖 Autoplay match found: ${trackObj.title}. Starting playback.`);
                            
                            // Background resolve 2 more tracks
                            this.backgroundAutoplayResolve(guildId, candidates.slice(candidates.indexOf(t) + 1));
                            break; 
                        }
                    } catch { continue; }
                }

                return firstTrack;
            }
        } catch (err) {
            console.error('[MusicPlayer] Last.fm Autoplay failed:', err);
        }
        return null;
    }

    private static async backgroundAutoplayResolve(guildId: string, candidates: any[]) {
        const { TrackResolverService } = await import('../api/TrackResolverService');
        const { MetadataService } = await import('../bot/MetadataService');
        
        let addedCount = 0;
        for (const t of candidates) {
            const artist = t.artist?.name || t.artist?.['#text'];
            if (!artist) continue;
            try {
                const resolved = await TrackResolverService.resolve(artist, t.name);
                if (!resolved.links.youtube) continue;

                const trackObj: YoutubeResult = {
                    id: t.mbid || String(Math.random()),
                    title: `${artist} - ${t.name}`,
                    url: resolved.links.youtube,
                    thumbnail: resolved.artworkUrl || '',
                    channelTitle: artist,
                    artistName: artist,
                    trackTitle: t.name,
                    requesterName: 'Autoplay'
                };

                await MetadataService.enrich(trackObj, null, null);
                QueueManager.addTrack(guildId, trackObj);
                addedCount++;
                if (addedCount >= 2) break;
            } catch { continue; }
        }
        console.log(`[MusicPlayer] 🤖 Background autoplay resolve finished. Added ${addedCount} tracks.`);
    }

    private static async processQueue(guildId: string, _skipCount = 0): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return;

        const release = await playbackLock.acquire(guildId);
        try {
            if (_skipCount > 5) {
                console.warn(`[MusicPlayer] 🛑 Too many consecutive failures for guild ${guildId}, stopping.`);
                this.stop(guildId);
                return;
            }

            if (queue.state.is('playing') || queue.state.is('loading')) {
                console.log(`[MusicPlayer] ⏩ Already playing/loading in guild ${guildId}, skipping processQueue.`);
                return;
            }

            queue.state.transition('loading');
            this.stopProgressUpdate(guildId);

            let track = QueueManager.getNextTrack(guildId) || QueueManager.getNextMixTrack(guildId);

            if (!track) {
                console.log(`[MusicPlayer] 🤖 Queue empty, triggering autoplay for guild ${guildId}...`);
                track = await this.handleAutoplay(guildId, queue);
            }

            if (!track) {
                console.log(`[MusicPlayer] 🏁 Queue concluded for guild ${guildId}.`);
                queue.currentTrack = null;
                queue.isPlaying = false;
                queue.state.transition('idle');
                queue.textChannel.send('✅ **Queue concluded.** Disconnecting in 5 minutes if inactive.').catch(() => { });

                if (queue.inactivityTimer) clearTimeout(queue.inactivityTimer);
                queue.inactivityTimer = setTimeout(() => {
                    const refreshed = QueueManager.getQueue(guildId);
                    if (refreshed && !refreshed.state.is('playing') && refreshed.tracks.length === 0) {
                        this.stop(guildId);
                    }
                }, config.INACTIVITY_TIMEOUT * 1000);
                return;
            }

            if (queue.inactivityTimer) {
                clearTimeout(queue.inactivityTimer);
                queue.inactivityTimer = undefined;
            }

            // Reset prefetchTriggered for the new track
            (queue as any).prefetchTriggered = false;

            console.log(`[MusicPlayer] 🎵 Preparing to play: ${track.title}`);
            const { LyricsService } = await import('./LyricsService');
            LyricsService.cleanupForGuild(guildId);

            if (!queue.player) throw new Error('Player not initialized');
            
            let lavalinkTrack = null;
            const cacheKey = track.url || track.title;
            const cachedEncoded = MusicPlayer.prefetchCache.get(cacheKey) || ResolutionCache.get(cacheKey);
            
            if (cachedEncoded) {
                lavalinkTrack = { encoded: cachedEncoded };
                MusicPlayer.prefetchCache.delete(cacheKey);
                console.log(`[Prefetch] ⚡ Cache hit for: ${track.title}`);
            }

            if (!lavalinkTrack) {
                let nodes = sortNodesByQuality(shoukaku.nodes);
                const isSpotifyUrl = track.url?.includes('open.spotify.com');

                if (isSpotifyUrl) {
                    nodes = nodes.filter(n => lavaSrcNodes.has(n.name));
                }

                if (isSpotifyUrl && nodes.length === 0) {
                    console.warn(`[MusicPlayer] No LavaSrc nodes available for ${track.title}, falling back to search`);
                    track.url = ''; // force search path
                    nodes = sortNodesByQuality(shoukaku.nodes);
                }

                const attempts = track._fallbackAttempts || 0;

                // 1. Prioritize resolving the exact URL across all healthy nodes first in parallel!
                if (track.url && attempts === 0) {
                    lavalinkTrack = await this.resolveOnBestNode(
                        nodes, track.url, queue.player?.node.name, queue.player
                    );
                }

                // 2. Fall back to search querying in parallel across all healthy nodes if exact URL failed or wasn't provided
                if (!lavalinkTrack) {
                    const searchStr = track.artistName && track.trackTitle ? `${track.artistName} ${track.trackTitle}` : track.title;
                    
                    const prefixes = attempts > 0
                        ? ['spsearch:', 'ytmsearch:', 'ytsearch:', 'scsearch:']
                        : ['spsearch:', 'ytmsearch:', 'ytsearch:'];

                    for (const prefix of prefixes) {
                        lavalinkTrack = await this.resolveOnBestNode(
                            nodes, `${prefix}${searchStr}`, queue.player?.node.name, queue.player
                        );
                        if (lavalinkTrack) break;
                    }
                }

                if (lavalinkTrack?.encoded) {
                    ResolutionCache.set(cacheKey, lavalinkTrack.encoded);
                }
            }

            if (!lavalinkTrack || !lavalinkTrack.encoded) {
                console.warn(`[MusicPlayer] ⚠️ Failed to resolve ${track.title} on all nodes. Skipping...`);
                queue.isPlaying = false;
                queue.state.transition('idle');
                release();
                return this.processQueue(guildId, _skipCount + 1);
            }

            queue.isPlaying = true;
            queue.currentTrack = track; // Set BEFORE playTrack to avoid race condition
            queue.lastPlayedTrack = track;
            
            // 1. Send UI in background (non-blocking) to eliminate Discord API roundtrip latency
            const isRetry = _skipCount > 0;
            MusicUIController.sendPlaybackUI(guildId, track, isRetry)
                .catch(e => console.error(`[MusicPlayer] UI Error:`, e));

            // 2. Start audio playback immediately in parallel
            queue.player.playTrack({ track: { encoded: lavalinkTrack.encoded } })
                .then(() => queue.player.setFilters({}).catch(() => {}))
                .catch(err => console.error(`[MusicPlayer] playTrack failed:`, err));
            
            console.log(`[MusicPlayer] ✅ Playback started instantly: ${track.title}`);

            // Background metadata enrichment and lyrics check (Non-blocking)
            (async () => {
                try {
                    const promises: Promise<any>[] = [];
                    
                    if (!track.artworkUrl) {
                        console.log(`[MusicPlayer] ⚡ Background UTR metadata enrichment for: ${track.title}`);
                        const { MetadataService } = await import('../bot/MetadataService');
                        promises.push(
                            MetadataService.enrich(track, null, null).catch(err => {
                                console.warn(`[MusicPlayer] Dynamic enrichment failed for ${track.title}:`, err);
                            })
                        );
                    }

                    if (!queue.hasLyrics) {
                        promises.push(
                            (async () => {
                                const artist = track.artistName || (track.channelTitle || '').replace(' - Topic', '') || 'Unknown Artist';
                                const title = track.trackTitle || (track.title || '').replace(/\(.*?\)|\[.*?\]/g, '').trim() || 'Unknown Track';
                                const duration = track.durationSeconds || 0;
                                const params = new URLSearchParams({
                                    artist_name: artist,
                                    track_name: title,
                                    ...(duration ? { duration: String(duration) } : {})
                                });
                                const res = await fetch(`https://lrclib.net/api/get?${params}`, {
                                    headers: { 'User-Agent': 'fm-discord-bot/1.0' }
                                });
                                if (res.ok) {
                                    queue.hasLyrics = true;
                                }
                            })().catch(() => {})
                        );
                    }

                    if (promises.length > 0) {
                        await Promise.all(promises);

                        // Once enrichment and lyrics check completes, update the now playing message if this track is still active
                        const activeQueue = QueueManager.getQueue(guildId);
                        if (activeQueue && activeQueue.currentTrack?.id === track.id) {
                            console.log(`[MusicPlayer] ✨ Enrichment & Lyrics check completed for ${track.title}. Updating UI.`);
                            await MusicUIController.updateNowPlayingMessage(guildId).catch(() => {});
                            
                            // Update discord presence/status with cleaned name
                            const cleanTitle = track.artistName ? `${track.artistName} - ${track.trackTitle || track.title}` : track.title;
                            VoiceStatusService.setTrackStatus(client, activeQueue.voiceChannelId, cleanTitle).catch(() => {});
                            VoiceStatusService.updatePresence(client, cleanTitle).catch(() => {});
                        }
                    }
                } catch (err) {
                    console.error(`[MusicPlayer] Background enrichment task failed:`, err);
                }
            })();
            
            // Background status updates
            const displayTitle = track.artistName ? `${track.artistName} - ${track.trackTitle || track.title}` : track.title;
            VoiceStatusService.setTrackStatus(client, queue.voiceChannelId, displayTitle).catch(() => {});
            VoiceStatusService.updatePresence(client, displayTitle).catch(() => {});

            if (track.artistName && track.trackTitle) {
                this.handleScrobbling(guildId, track).catch(e => console.error(`[MusicPlayer] Scrobbling Error:`, e));
            }
        } catch (err: any) {
            console.error(`[MusicPlayer] ❌ Critical Playback Error for guild ${guildId}:`, err);
            queue.textChannel.send(`❌ **Playback Failed**: ${err.message || 'Unknown error'}. Skipping...`);
            queue.isPlaying = false;
            queue.state.transition('idle');
            release();
            this.processQueue(guildId, _skipCount + 1).catch(() => { });
        } finally {
            release();
        }
    }

    private static setupPlayerEvents(guildId: string): void {
        const queue = QueueManager.getQueue(guildId);
        if (!queue || !queue.player) return;

        queue.player.removeAllListeners();

        let exceptionPending = false;
        let endTimeout: NodeJS.Timeout | null = null;

        queue.player.on('start', async () => {
            console.log(`[Lavalink] Playback started in guild ${guildId}`);
            queue.state.transition('playing');
            queue.isPlaying = true;
            queue.isPaused = false;
            queue.lastUpdate = Date.now();
            queue.lastStart = Date.now();
            queue.lastHeartbeat = Date.now();
            
            const nodeName = queue.player?.node.name;
            if (nodeName) {
                const { recordSuccess } = await import('./NodeCircuitBreaker');
                recordSuccess(nodeName);
            }

            VoteSkipCommand.resetVotes(guildId);
            this.startProgressUpdate(guildId);
            MusicUIController.updateNowPlayingMessage(guildId).catch(() => {});

            // Pre-resolve next track in background
            this.prefetchNextTrack(guildId).catch(() => {});
        });

        queue.player.on('update', (data) => {
            queue.lastUpdate = Date.now();
            if (queue.state.is('playing')) {
                queue.lastHeartbeat = Date.now();
            }

            if (data.state?.position !== undefined) {
                queue.lastKnownPosition = data.state.position;
                queue.lastPositionTimestamp = Date.now();
            }

            const position = data.state?.position ?? 0;
            const duration = queue.currentTrack?.durationSeconds
                ? queue.currentTrack.durationSeconds * 1000
                : 0;

            // 4 seconds before end, start pre-resolving next track
            if (duration > 0 && (duration - position) < 4000 && !(queue as any).prefetchTriggered) {
                (queue as any).prefetchTriggered = true;
                this.prefetchNextTrack(guildId).catch(() => {});
            }
        });

        queue.player.on('stuck', async () => {
            console.warn(`[Lavalink] Track stuck in guild ${guildId}, skipping...`);
            const nodeName = queue.player?.node.name;
            if (nodeName) {
                const { recordFailure } = await import('./NodeCircuitBreaker');
                recordFailure(nodeName);
            }
            if (queue.player) queue.player.stopTrack().catch(() => {});
        });

        queue.player.on('end', (data) => {
            console.log(`[Lavalink] Track ended in guild ${guildId}. Reason: ${data.reason}`);
            if (queue.state.is('recovering')) {
                console.log(`[MusicPlayer] 🔄 End event ignored — player is recovering.`);
                return;
            }
            if (data.reason === 'replaced') return;
            if (exceptionPending) {
                console.log(`[MusicPlayer] ⏭ End event suppressed — exception is handling retry.`);
                return;
            }
            
            // Check for silent stream failure (finished instantly)
            const playDuration = Date.now() - (queue.lastStart || 0);
            const attempts = queue.lastPlayedTrack?._fallbackAttempts || 0;
            if (data.reason === 'finished' && playDuration < 2000 && queue.lastPlayedTrack && attempts < 2) {
                console.log(`[MusicPlayer] ⚠️ Track finished instantly (possible silent stream failure). Triggering fallback...`);
                const failedTrack = queue.lastPlayedTrack;
                failedTrack._fallbackAttempts = attempts + 1;
                failedTrack.url = ''; 
                queue.tracks.unshift(failedTrack);
                
                if (endTimeout) clearTimeout(endTimeout);
                this.processQueue(guildId, 1).catch(() => {});
                return;
            }

            // Check for premature stream finish (connection drop / closed prematurely by YouTube/Lavalink)
            const expectedDuration = queue.currentTrack?.durationSeconds ? queue.currentTrack.durationSeconds * 1000 : 0;
            const currentPosition = this.getPosition(queue);
            const remainingMs = expectedDuration - currentPosition;
            if (data.reason === 'finished' && expectedDuration > 15000 && currentPosition > 5000 && remainingMs > 20000 && currentPosition < expectedDuration * 0.95) {
                console.warn(`[MusicPlayer] ⚠️ Track ended prematurely at ${Math.round(currentPosition / 1000)}s of ${Math.round(expectedDuration / 1000)}s. Recovering...`);
                if (endTimeout) clearTimeout(endTimeout);
                this.recoverPlayback(guildId).catch(err => {
                    console.error(`[MusicPlayer] Premature end recovery failed:`, err);
                });
                return;
            }
            
            queue.isPlaying = false;
            queue.state.transition('idle');
            this.stopProgressUpdate(guildId);
            
            VoiceStatusService.clearStatus(client, queue.voiceChannelId);
            VoiceStatusService.updatePresence(client, null);

            endTimeout = setTimeout(() => {
                if (exceptionPending) return;
                this.processQueue(guildId).catch(err => {
                    console.error(`[MusicPlayer] End event processQueue error:`, err);
                });
            }, 100);
        });

        queue.player.on('exception', async (data) => {
            console.error(`[Lavalink] Playback exception in guild ${guildId}:`, data.exception);
            exceptionPending = true;
            queue.isPlaying = false;
            queue.state.transition('idle');

            const nodeName = queue.player?.node.name;
            if (nodeName) {
                const { recordFailure } = await import('./NodeCircuitBreaker');
                recordFailure(nodeName);
            }
            
            if (endTimeout) {
                clearTimeout(endTimeout);
                endTimeout = null;
                console.log(`[MusicPlayer] ⏭ End event processQueue cancelled due to incoming exception.`);
            }

            const failedTrack = queue.lastPlayedTrack;
            const attempts = failedTrack?._fallbackAttempts || 0;
            if (failedTrack && attempts < 2) {
                console.log(`[MusicPlayer] 🔄 Retrying track with fallback sources (Attempt ${attempts + 1}/2)...`);
                failedTrack._fallbackAttempts = attempts + 1;
                failedTrack.url = ''; // Clear URL to force search
                queue.tracks.unshift(failedTrack);
            }
            
            setTimeout(() => {
                exceptionPending = false;
                this.processQueue(guildId, 1).catch(() => {});
            }, 100);
        });

        this.startWatchdog(guildId);
    }

    private static watchdogIntervals = new Map<string, NodeJS.Timeout>();

    private static startWatchdog(guildId: string) {
        this.stopWatchdog(guildId);

        const interval = setInterval(async () => {
            const queue = QueueManager.getQueue(guildId);
            if (!queue || !queue.state.is('playing')) return;

            const now = Date.now();
            const lastHb = queue.lastHeartbeat || 0;
            const silenceDuration = now - lastHb;

            // If playing but no heartbeat for >30 seconds, playback is frozen
            if (lastHb > 0 && silenceDuration > 30000) {
                console.warn(`[Watchdog] ⚠️ Guild ${guildId}: Frozen playback detected (${Math.round(silenceDuration / 1000)}s silence). Recovering...`);
                await this.recoverPlayback(guildId);
            }
        }, 10000);

        this.watchdogIntervals.set(guildId, interval);
    }

    private static stopWatchdog(guildId: string) {
        const interval = this.watchdogIntervals.get(guildId);
        if (interval) {
            clearInterval(interval);
            this.watchdogIntervals.delete(guildId);
        }
    }

    /**
     * Recovers frozen/dead playback by re-joining voice on the best available node
     * and seeking back to the exact timestamp the player stopped at.
     */
    static async recoverPlayback(guildId: string) {
        let queue = QueueManager.getQueue(guildId);
        if (!queue || !queue.currentTrack || queue.state.is('recovering')) return;

        queue.state.transition('recovering');

        // Snapshot position + track NOW before any async gap
        const seekToMs = Math.max(0, this.getPosition(queue) - 500);
        const track = { ...queue.currentTrack }; // deep-copy so we keep it if queue is deleted

        console.log(`[Watchdog] 🔄 Recovering "${track.title}" at ${Math.round(seekToMs / 1000)}s for guild ${guildId}`);

        try {
            // Gracefully stop + leave before rejoining
            try {
                queue.player?.stopTrack().catch(() => {});
                await new Promise(r => setTimeout(r, 300));
            } catch { /* ignore */ }

            // Re-check: user may have manually stopped during the 300ms wait
            queue = QueueManager.getQueue(guildId)!;
            if (!queue) {
                console.log(`[Watchdog] Guild ${guildId} queue gone during recovery — aborting.`);
                return;
            }

            try {
                await shoukaku.leaveVoiceChannel(guildId);
            } catch { /* ignore */ }
            await new Promise(r => setTimeout(r, 600));

            // Re-check again after another await
            queue = QueueManager.getQueue(guildId)!;
            if (!queue) {
                console.log(`[Watchdog] Guild ${guildId} queue gone during recovery — aborting.`);
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            const shardId = guild?.shardId ?? 0;

            const player = await shoukaku.joinVoiceChannel({
                guildId,
                channelId: queue.voiceChannelId,
                shardId,
                deaf: true
            });

            // Final check after the join await
            queue = QueueManager.getQueue(guildId)!;
            if (!queue) {
                console.log(`[Watchdog] Guild ${guildId} queue gone after re-join — aborting.`);
                shoukaku.leaveVoiceChannel(guildId).catch(() => {});
                return;
            }

            console.log(`[Watchdog] ✅ Re-joined on node: ${player.node.name}`);
            queue.player = player;
            queue.lastHeartbeat = Date.now();
            this.setupPlayerEvents(guildId);

            // Re-resolve the track on the best available node using exact-URL prioritizing loop
            const nodes = Array.from(shoukaku.nodes.values())
                .filter(n => n.state === 1)
                .sort((a, b) => (a.penalties || 0) - (b.penalties || 0));

            let lavalinkTrack: any = null;

            // 1. Try resolving exact URL in parallel across all healthy nodes first!
            if (track.url) {
                lavalinkTrack = await this.resolveOnBestNode(
                    nodes, track.url, queue.player?.node.name, queue.player
                );
            }

            // 2. Fall back to search querying in parallel across all nodes if exact URL failed
            if (!lavalinkTrack) {
                const searchStr = track.artistName && track.trackTitle ? `${track.artistName} ${track.trackTitle}` : track.title;
                const prefixes = ['spsearch:', 'ytsearch:'];
                for (const prefix of prefixes) {
                    lavalinkTrack = await this.resolveOnBestNode(
                        nodes, `${prefix}${searchStr}`, queue.player?.node.name, queue.player
                    );
                    if (lavalinkTrack) break;
                }
            }

            // Re-check queue is still alive after all those node awaits
            queue = QueueManager.getQueue(guildId)!;
            if (!queue) return;

            if (!lavalinkTrack?.encoded) {
                console.error(`[Watchdog] ❌ Could not re-resolve track. Skipping.`);
                queue.state.transition('idle');
                queue.currentTrack = null;
                queue.isPlaying = false;
                this.processQueue(guildId).catch(() => {});
                return;
            }

            // Play — isolated try/catch so a stale player doesn't crash the process
            try {
                await queue.player.playTrack({ track: { encoded: lavalinkTrack.encoded } });
            } catch (e: any) {
                console.warn(`[Watchdog] playTrack failed (player gone?): ${e.message}`);
                queue.state.transition('idle');
                return;
            }

            // Seek — isolated so failure here doesn't kill anything
            if (seekToMs > 2000) {
                try {
                    await new Promise(r => setTimeout(r, 500));
                    // One last queue check before seek
                    queue = QueueManager.getQueue(guildId)!;
                    if (queue?.player) {
                        await queue.player.seekTo(seekToMs);
                        console.log(`[Watchdog] ⏩ Seeked to ${Math.round(seekToMs / 1000)}s`);
                    }
                } catch (e: any) {
                    console.warn(`[Watchdog] seekTo failed (non-fatal): ${e.message}`);
                }
            }

            if (!queue) return;
            queue.isPlaying = true;
            queue.state.transition('playing');
            queue.lastHeartbeat = Date.now();

            const mins = Math.floor(seekToMs / 60000);
            const secs = String(Math.floor((seekToMs % 60000) / 1000)).padStart(2, '0');
            queue.textChannel.send(
                `🔄 **Playback recovered** — resuming **${track.artistName || ''} ${track.trackTitle || track.title}** from \`${mins}:${secs}\``
            ).catch(() => {});

        } catch (err: any) {
            console.error(`[Watchdog] ❌ Recovery failed for guild ${guildId}:`, err.message);
            const q = QueueManager.getQueue(guildId);
            if (q) {
                q.state.transition('idle');
                q.isPlaying = false;
                q.currentTrack = null;
                this.processQueue(guildId).catch(() => {});
            }
        }
    }

    private static startProgressUpdate(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (!queue || queue.progressInterval) return;

        queue.progressInterval = setInterval(() => {
            MusicUIController.updateNowPlayingMessage(guildId).catch(() => {});
        }, 10000);
    }

    private static stopProgressUpdate(guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        if (queue?.progressInterval) {
            clearInterval(queue.progressInterval);
            queue.progressInterval = undefined;
        }
    }

    private static async handleScrobbling(guildId: string, track: YoutubeResult) {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return;
        try {
            const guild = queue.textChannel.guild;
            const voiceChannel = guild.channels.cache.get(queue.voiceChannelId) as VoiceChannel;
            if (voiceChannel) {
                const listeners = voiceChannel.members.filter(m => !m.user.bot).map(m => m.id);
                if (listeners.length === 0) return;

                const art = track.artistName || track.channelTitle.replace(' - Topic', '');
                const tit = track.trackTitle || track.title;

                if (art && tit) {
                    const res = await ScrobbleService.scrobbleForUsers(listeners, { artist: art, track: tit });
                    const successCount = res.filter(r => r.status === 'fulfilled').length;
                    (track as any).scrobbleCount = successCount;
                    MusicUIController.updateNowPlayingMessage(guildId).catch(() => {});
                }
            }
        } catch (err: any) {
            console.error(`[MusicPlayer] Scrobble error:`, err.message);
        }
    }
}
