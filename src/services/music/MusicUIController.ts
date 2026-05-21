import {
  ComponentsV2 } from '../../utils/ComponentsV2';
import { QueueManager,
  GuildQueue } from './QueueManager';
import { YoutubeResult } from '../api/Youtube';
import { createProgressBar,
  formatDuration } from '../../utils/formatDuration';
import { Message,
  TextChannel,
  ComponentType,
  ButtonStyle
} from "discord.js";

export class MusicUIController {

    /**
     * Builds and sends the playback UI to the queue's text channel.
     * Replaces the old message if it exists.
     */
    static async sendPlaybackUI(guildId: string, track: YoutubeResult, isRetry = false): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (!queue) return;

        if (isRetry && queue.nowPlayingMessage) {
            const ui = await this.buildPlaybackUI(guildId, track, 0, false);
            try {
                await queue.nowPlayingMessage.edit(ui);
                return;
            } catch (err) {
                // Message might have been deleted, fall back to normal path
            }
        }

        if (queue.nowPlayingMessage) {
            queue.nowPlayingMessage.delete().catch(() => { });
            queue.nowPlayingMessage = undefined;
        }

        // Initialize lyrics flag (background worker will populate this async)
        queue.hasLyrics = false;

        const ui = await this.buildPlaybackUI(guildId, track, 0, false);

        try {
            const msg = await queue.textChannel.send(ui);
            queue.nowPlayingMessage = msg;
        } catch (err) {
            console.error('[MusicUIController] Failed to send playback UI:', err);
        }
    }

    /**
     * Updates the existing now playing message (progress bar, pause state, etc)
     */
    static async updateNowPlayingMessage(guildId: string): Promise<void> {
        const queue = QueueManager.getQueue(guildId);
        if (!queue || !queue.nowPlayingMessage || !queue.isPlaying) return;

        const track = queue.currentTrack;
        if (!track) return;

        const { MusicPlayer } = await import('./MusicPlayer');
        const elapsedMs = MusicPlayer.getPosition(queue);
        const elapsed = Math.floor(elapsedMs / 1000);

        const ui = await this.buildPlaybackUI(guildId, track, elapsed, queue.isPaused);

        try {
            await queue.nowPlayingMessage.edit(ui);
        } catch (err) {
            // Message might be deleted
            if (queue.progressInterval) {
                clearInterval(queue.progressInterval);
                queue.progressInterval = undefined;
            }
        }
    }

    private static async buildPlaybackUI(guildId: string, track: YoutubeResult, elapsed: number, isPaused: boolean) {
        const queue = QueueManager.getQueue(guildId);
        const total = track.durationSeconds || 0;
        const progressBar = createProgressBar(elapsed, total, 12);

        const timeInfo = `\`${formatDuration(elapsed)} / ${track.duration || '0:00'}\``;

        let repeatInfo = '';
        let autoplayInfo = '';
        if (queue) {
            if (queue.repeatMode === 'one') repeatInfo = ' 🔂';
            else if (queue.repeatMode === 'all') repeatInfo = ' 🔁';
            if (queue.autoplay) autoplayInfo = ' 🤖';
        }

        const scrobbleInfo = (track as any).scrobbleCount ? ` •  Scrobbling for ${(track as any).scrobbleCount} users` : '';
        const statsLine = track.statsText ? track.statsText.trim() : '';

        const artistDisplay = track.artistName || (track.channelTitle || '').replace(' - Topic', '') || 'Unknown Artist';
        const titleDisplay = (track.trackTitle || track.title || 'Unknown Track').replace(/\[.*?\]|\(.*?\)/g, '').trim();

        let embedColor = isPaused ? 0xFFA500 : 0x1DB954;
        if (!isPaused && track.requesterId) {
            const { prisma } = await import('../../database/client');
            const { SettingService } = await import('../bot/SettingService');
            const dbAuthor = await prisma.user.findUnique({ where: { discordId: track.requesterId } });
            if (dbAuthor) embedColor = SettingService.resolveAccentColor(dbAuthor);
        }

        const builder = new ComponentsV2()
            .setAccent(embedColor)
            .addText(
                `**${titleDisplay}** - ${artistDisplay}${repeatInfo}${autoplayInfo}\n` +
                `${statsLine ? `${statsLine}\n` : ''}` +
                `${progressBar}  ${timeInfo}\n` +
                `-# Requested by ${track.requesterName || 'Unknown'}${scrobbleInfo}`
            );

        const repeatEmojis: Record<string, string> = { 'off': '🔁', 'one': '🔂', 'all': '🔁' };
        const repeatMode = queue?.repeatMode || 'off';

        // ROW 1: Core Playback Controls (5 Buttons)
        builder.addRow([
            { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '', emoji: isPaused ? '▶️' : '⏸️', custom_id: isPaused ? `mp-resume:${guildId}` : `mp-pause:${guildId}` },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '', emoji: '⏭️', custom_id: `mp-skip:${guildId}` },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '', emoji: repeatEmojis[repeatMode] || '🔁', custom_id: `mp-repeat:${guildId}` },
            { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '', emoji: '🔀', custom_id: `mp-shuffle:${guildId}` },
            { type: ComponentType.Button, style: ButtonStyle.Danger, label: '', emoji: '🛑', custom_id: `mp-stop:${guildId}` }
        ]);

        // ROW 2: Combined Actions & Audio Filters Select Menu
        const selectOptions: any[] = [
            // Actions
            { label: 'View Queue', value: 'action:queue', emoji: '📄', description: 'Show the upcoming tracks in the queue' },
            { label: 'Track Details', value: 'action:trackinfo', emoji: 'ℹ️', description: 'Show metadata and details of the current track' },
            { label: `Autoplay: ${queue?.autoplay ? 'Enabled 🟢' : 'Disabled 🔴'}`, value: 'action:autoplay', emoji: '🤖', description: 'Toggle automatic recommendation mode' },
            { label: 'Adjust Volume', value: 'action:volume', emoji: '🔊', description: 'Open volume adjustment modal' }
        ];

        if (queue?.hasLyrics) {
            selectOptions.push({ label: 'Show Live Lyrics', value: 'action:lyrics', emoji: '🎤', description: 'Display real-time synchronized lyrics' });
        }

        // Add separator-like filter options
        selectOptions.push(
            { label: 'Clear All Filters', value: 'filter:clear', emoji: '❌', description: 'Reset all active audio filters and effects' },
            { label: 'Bass Boost', value: 'filter:bassboost', emoji: '🔊', description: 'Enhance low-end bass frequencies' },
            { label: 'Nightcore', value: 'filter:nightcore', emoji: '⚡', description: 'Increase speed and pitch' },
            { label: 'Vaporwave', value: 'filter:vaporwave', emoji: '🌊', description: 'Slowed and pitch-lowered aesthetic' },
            { label: 'Daycore', value: 'filter:daycore', emoji: '🕰️', description: 'Slowed and slightly bass boosted' },
            { label: '8D Audio', value: 'filter:8d', emoji: '🎧', description: '360 degree rotating sound effect' },
            { label: 'Pop Equalizer', value: 'filter:pop', emoji: '🎸', description: 'Optimized preset for pop/rock music' },
            { label: 'Treble Boost', value: 'filter:treble', emoji: '🎼', description: 'Boost high-frequency clarity' },
            { label: 'Tremolo', value: 'filter:tremolo', emoji: '📳', description: 'Dynamic volume wave modulation' },
            { label: 'Vibrato', value: 'filter:vibrato', emoji: '〰️', description: 'Dynamic pitch wave modulation' },
            { label: 'Distortion', value: 'filter:distortion', emoji: '💢', description: 'Aggressive gritty audio overdrive' }
        );

        builder.addRow([{
            type: ComponentType.StringSelect,
            custom_id: `mp-action-filter-select:${guildId}`,
            placeholder: '⚙️ Actions & Audio Filters...',
            options: selectOptions
        }]);

        return builder.build();
    }
}
