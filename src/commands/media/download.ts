import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { BaseCommand } from "../../structures/BaseCommand";
import { Spotify } from "../../services/api/Spotify";
import { RateLimitService } from "../../services/bot/RateLimitService";

export default class DownloadCommand extends BaseCommand {
    name = "download";
    description = "Download a Spotify track or album.";
    aliases = ["dl"];

    slashData = new SlashCommandBuilder()
        .setName("download")
        .setDescription("Download a Spotify track or album.")
        .addStringOption(option =>
            option.setName("link")
                .setDescription("The Spotify track, album, or playlist link")
                .setRequired(true)
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]) {
        const link = isSlash 
            ? interactionOrMessage.options.getString("link") 
            : args?.[0];

        if (!link) {
            const msg = "❌ Please provide a Spotify link.";
            return isSlash ? interactionOrMessage.reply(msg) : interactionOrMessage.channel.send(msg);
        }

        // Rate Limit check
        const allowed = await RateLimitService.checkCommand(interactionOrMessage.member?.id || interactionOrMessage.author?.id);
        if (!allowed) {
            const msg = "⚠️ You are sending commands too fast!";
            return isSlash ? interactionOrMessage.reply(msg) : interactionOrMessage.channel.send(msg);
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else await interactionOrMessage.channel.sendTyping();

        try {
            // 1. Parse Link
            const trackMatch = link.match(/track\/([a-zA-Z0-9]+)/);
            const albumMatch = link.match(/album\/([a-zA-Z0-9]+)/);
            const playlistMatch = link.match(/playlist\/([a-zA-Z0-9]+)/);

            let tracks: any[] = [];
            let collectionName = "Download";

            if (trackMatch) {
                const meta = await Spotify.getTrackMetadataById(trackMatch[1]);
                if (meta) tracks.push(meta);
            } else if (albumMatch) {
                const meta = await Spotify.getAlbumMetadataById(albumMatch[1]);
                if (meta) {
                    collectionName = meta.name;
                    tracks = await Spotify.getAlbumTracks(albumMatch[1]);
                }
            } else if (playlistMatch) {
                tracks = await Spotify.getPlaylistTracks(playlistMatch[1]);
                collectionName = "Playlist";
            }

            if (tracks.length === 0) {
                throw new Error("Could not find any tracks in that link.");
            }

            const embed = new EmbedBuilder()
                .setTitle(`📥 ${collectionName}`)
                .setDescription(`The downloader is currently being reconfigured. Found **${tracks.length}** tracks, but the download engine is temporarily disabled.`)
                .setColor(0xFFFF00);

            await (isSlash ? interactionOrMessage.editReply({ embeds: [embed] }) : interactionOrMessage.channel.send({ embeds: [embed] }));

        } catch (err: any) {
            const errMsg = `❌ Error: ${err.message}`;
            if (isSlash) await interactionOrMessage.editReply(errMsg).catch(() => {});
            else await interactionOrMessage.channel.send(errMsg).catch(() => {});
        }
    }
}
