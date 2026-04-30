import { BaseCommand } from '../../structures/BaseCommand';
import { MusicPlayer } from '../../services/music/MusicPlayer';
import { QueueManager } from '../../services/music/QueueManager';
import { SlashCommandBuilder, VoiceChannel } from 'discord.js';

const votes = new Map<string, Set<string>>();

export default class VoteSkipCommand extends BaseCommand {
    name = 'voteskip';
    description = 'Vote to skip the current track';

    slashData = new SlashCommandBuilder()
        .setName(this.name)
        .setDescription(this.description);

    async execute(interaction: any) {
        if (!interaction.guildId) return;
        await VoteSkipCommand.handleVote(interaction, interaction.guildId);
    }

    static async handleVote(interaction: any, guildId: string) {
        const queue = QueueManager.getQueue(guildId);
        
        if (!queue?.isPlaying) {
            return interaction.reply({ content: '❌ Nothing is currently playing.', ephemeral: true });
        }

        const member = interaction.member as any;
        const voiceChannel = member.voice.channel as VoiceChannel;
        if (!voiceChannel || voiceChannel.id !== queue.voiceChannelId) {
            return interaction.reply({ content: '❌ You must be in the same voice channel to vote.', ephemeral: true });
        }

        // Instant skip for requester or admins
        const isRequester = queue.currentTrack?.requesterId === interaction.user.id;
        const isAdmin = member.permissions?.has('ManageGuild');

        if (isRequester || isAdmin) {
            votes.delete(guildId);
            MusicPlayer.skip(guildId);
            return interaction.reply({ content: `⏭️ ${isAdmin ? 'Admin' : 'Requester'} skipped the track.` });
        }

        const listeners = voiceChannel.members.filter(m => !m.user.bot).size;
        const required = Math.ceil(listeners / 2);
        
        if (!votes.has(guildId)) {
            votes.set(guildId, new Set());
        }

        const guildVotes = votes.get(guildId)!;
        if (guildVotes.has(interaction.user.id)) {
            return interaction.reply({ content: `⚠️ You have already voted! (${guildVotes.size}/${required})`, ephemeral: true });
        }

        guildVotes.add(interaction.user.id);

        if (guildVotes.size >= required) {
            votes.delete(guildId);
            MusicPlayer.skip(guildId);
            await interaction.reply({ content: `⏭️ Vote passed! Skipping... (${guildVotes.size}/${required})` });
        } else {
            await interaction.reply({ content: `✅ Vote added! (${guildVotes.size}/${required} required)` });
        }
    }

    // Reset votes on track start (hooked in MusicPlayer)
    static resetVotes(guildId: string) {
        votes.delete(guildId);
    }
}
