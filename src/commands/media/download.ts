import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { BaseCommand } from "../../structures/BaseCommand";
import { Spotify } from "../../services/api/Spotify";
import { TrackResolverService } from "../../services/api/TrackResolverService";
import { CobaltDownloader } from "../../services/api/CobaltDownloader";
import { UploaderService } from "../../services/bot/UploaderService";
import { RateLimitService } from "../../services/bot/RateLimitService";
import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';

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
        const id = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const allowed = await RateLimitService.checkCommand(id);
        if (!allowed) {
            const msg = "⚠️ You are sending commands too fast!";
            return isSlash ? interactionOrMessage.reply(msg) : interactionOrMessage.channel.send(msg);
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else await interactionOrMessage.channel.sendTyping();

        let tempDir = '';

        try {
            // 1. Parse Link
            const trackMatch = link.match(/track\/([a-zA-Z0-9]+)/);
            const albumMatch = link.match(/album\/([a-zA-Z0-9]+)/);
            const playlistMatch = link.match(/playlist\/([a-zA-Z0-9]+)/);

            let tracks: { name: string; artist: string; artworkUrl?: string; spotifyUrl: string }[] = [];
            let collectionName = "Download";
            let collectionArt: string | null = null;

            if (trackMatch) {
                const meta = await Spotify.getTrackMetadataById(trackMatch[1]);
                if (meta) {
                    const resolved = await TrackResolverService.resolve(meta.artist, meta.name);
                    tracks.push({
                        name: resolved.title,
                        artist: resolved.artist,
                        artworkUrl: resolved.artworkUrl || undefined,
                        spotifyUrl: `https://open.spotify.com/track/${trackMatch[1]}`
                    });
                    collectionName = resolved.title;
                    collectionArt = resolved.artworkUrl;
                }
            } else if (albumMatch) {
                const meta = await Spotify.getAlbumMetadataById(albumMatch[1]);
                if (meta) {
                    const resolved = await TrackResolverService.resolveAlbum(meta.artist, meta.name);
                    collectionName = resolved.album;
                    collectionArt = resolved.artworkUrl;
                    
                    const albumTracks = await Spotify.getAlbumTracks(albumMatch[1]);
                    for (const t of albumTracks) {
                        tracks.push({
                            name: t.name,
                            artist: t.artist,
                            artworkUrl: collectionArt || undefined,
                            spotifyUrl: `https://open.spotify.com/track/${t.id}`
                        });
                    }
                }
            } else if (playlistMatch) {
                const playlistTracks = await Spotify.getPlaylistTracks(playlistMatch[1]);
                for (const t of playlistTracks) {
                    tracks.push({
                        name: t.name,
                        artist: t.artist,
                        spotifyUrl: `https://open.spotify.com/track/${t.id}`
                    });
                }
                collectionName = "Playlist";
            }

            if (tracks.length === 0) {
                throw new Error("Could not find any tracks in that link.");
            }

            // Limit tracks
            if (tracks.length > 20) tracks = tracks.slice(0, 20);

            const statusEmbed = new EmbedBuilder()
                .setTitle(`📥 ${collectionName}`)
                .setDescription(`🔍 Found **${tracks.length}** tracks. Requesting MP3s...`)
                .setColor(0x00FF00);

            if (collectionArt) statusEmbed.setThumbnail(collectionArt);

            let statusMsg = isSlash 
                ? await interactionOrMessage.editReply({ embeds: [statusEmbed] }) 
                : await interactionOrMessage.channel.send({ embeds: [statusEmbed] });

            // 2. Setup Temp Dir
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-dl-'));
            const downloadedFiles: string[] = [];

            // 3. Download Tracks
            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i];
                try {
                    const progress = `Processing **${i + 1}/${tracks.length}**: *${track.name}*...`;
                    statusEmbed.setDescription(progress);
                    await statusMsg.edit({ embeds: [statusEmbed] }).catch(() => {});

                    const fileName = `${track.artist} - ${track.name}.mp3`.replace(/[\\/:*?"<>|]/g, "");
                    const outputPath = path.join(tempDir, fileName);

                    // Use UTR for artwork if not resolved
                    let artworkUrl = track.artworkUrl;
                    if (!artworkUrl && playlistMatch) {
                        const resolved = await TrackResolverService.resolve(track.artist, track.name).catch(() => null);
                        artworkUrl = resolved?.artworkUrl || undefined;
                    }

                    await CobaltDownloader.downloadTrack(outputPath, {
                        name: track.name,
                        artist: track.artist,
                        album: collectionName,
                        artworkUrl: artworkUrl,
                        spotifyUrl: track.spotifyUrl
                    });

                    downloadedFiles.push(outputPath);
                } catch (err: any) {
                    console.error(`Failed to download ${track.name}:`, err.message);
                }
            }

            if (downloadedFiles.length === 0) {
                throw new Error("Failed to download any tracks. Check your RapidAPI subscription.");
            }

            // 4. Final Processing
            statusEmbed.setDescription(`📦 Uploading **${downloadedFiles.length}** files...`);
            await statusMsg.edit({ embeds: [statusEmbed] }).catch(() => {});

            let finalFilePath = '';
            if (downloadedFiles.length === 1) {
                finalFilePath = downloadedFiles[0];
            } else {
                const zipPath = path.join(tempDir, `${collectionName}.zip`);
                const output = fs.createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                const zipTask = new Promise((resolve, resolveErr) => {
                    output.on('close', resolve);
                    archive.on('error', resolveErr);
                });

                archive.pipe(output);
                for (const file of downloadedFiles) {
                    archive.file(file, { name: path.basename(file) });
                }
                await archive.finalize();
                await zipTask;
                finalFilePath = zipPath;
            }

            const downloadUrl = await UploaderService.uploadToGoFile(finalFilePath);

            const finalEmbed = new EmbedBuilder()
                .setTitle(`✅ ${collectionName} Ready`)
                .setDescription(`Successfully downloaded **${downloadedFiles.length}** tracks.\n\n[**Click here to download**](${downloadUrl})`)
                .setColor(0x00FF00)
                .setTimestamp();
            
            if (collectionArt) finalEmbed.setThumbnail(collectionArt);

            await statusMsg.edit({ embeds: [finalEmbed] });

        } catch (err: any) {
            const errMsg = `❌ Error: ${err.message}`;
            if (isSlash) await interactionOrMessage.editReply(errMsg).catch(() => {});
            else await interactionOrMessage.channel.send(errMsg).catch(() => {});
        } finally {
            if (tempDir && fs.existsSync(tempDir)) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
            }
        }
    }
}
