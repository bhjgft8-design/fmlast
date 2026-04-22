import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { Deezer } from '../../services/api/Deezer';
import { prisma } from '../../database/client';
import { TextChannel, SlashCommandBuilder } from 'discord.js';

export default class DeezerCommand extends BaseCommand {
    name = 'deezer';
    description = 'Share your currently playing track as a Deezer link.';
    aliases = ['dz', 'deez'];

    slashData = new SlashCommandBuilder()
        .setName('deezer')
        .setDescription('Share your currently playing track as a Deezer link.')
        .addStringOption(opt => opt.setName('query').setDescription('Manual search query (track, artist, etc.)').setRequired(false));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        if (!isSlash) {
            try {
                (interactionOrMessage.channel as TextChannel).sendTyping();
            } catch (err) { }
        }

        const manualQuery = isSlash ? interactionOrMessage.options.getString('query') : (args && args.length > 0 ? args.join(' ') : null);
        let artist = '';
        let trackName = '';

        if (manualQuery) {
            trackName = manualQuery;
        } else {
            const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
            const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });

            if (!dbUser?.lastfmUsername) {
                const msg = '❌ You haven’t linked your Last.fm account yet. Use `/login` first.';
                if (isSlash) {
                    await interactionOrMessage.reply({ content: msg, ephemeral: true });
                } else {
                    await interactionOrMessage.channel.send(msg);
                }
                return;
            }

            try {
                const tracks = await LastFM.getRecentTracks(dbUser.lastfmUsername, 1, dbUser.lastfmSessionKey);

                if (!tracks?.length) {
                    const msg = '😢 No recent tracks found.';
                    isSlash ? await interactionOrMessage.reply(msg) : await interactionOrMessage.channel.send(msg);
                    return;
                }

                artist = tracks[0].artist?.['#text'] || 'Unknown Artist';
                trackName = tracks[0].name || 'Unknown Track';
            } catch (err) {
                console.error('Error fetching Last.fm track for Deezer command:', err);
                const msg = '⚠️ Could not fetch your current track from Last.fm.';
                isSlash ? await interactionOrMessage.reply(msg) : await interactionOrMessage.channel.send(msg);
                return;
            }
        }

        try {
            const dzInfo = await Deezer.searchTrack(artist, trackName);

            if (!dzInfo?.url) {
                const msg = `❌ Couldn’t find **${trackName}** by **${artist}** on Deezer.`;
                isSlash ? await interactionOrMessage.reply(msg) : await interactionOrMessage.channel.send(msg);
                return;
            }

            if (isSlash) {
                await interactionOrMessage.reply(dzInfo.url);
            } else {
                await interactionOrMessage.channel.send(dzInfo.url);
            }

        } catch (err) {
            console.error('Error in deezer command:', err);
            const msg = '⚠️ Something went wrong fetching your track.';
            if (isSlash) {
                if (interactionOrMessage.deferred || interactionOrMessage.replied) {
                    await interactionOrMessage.editReply(msg);
                } else {
                    await interactionOrMessage.reply({ content: msg, ephemeral: true });
                }
            } else {
                await interactionOrMessage.channel.send(msg);
            }
        }
    }
}
