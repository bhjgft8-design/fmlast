import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { AppleMusic } from '../../services/api/AppleMusic';
import { prisma } from '../../database/client';
import { TextChannel, SlashCommandBuilder } from 'discord.js';

export default class AppleMusicCommand extends BaseCommand {
    name = 'applemusic';
    description = 'Share your currently playing track as an Apple Music link.';
    aliases = ['am', 'apple'];

    slashData = new SlashCommandBuilder()
        .setName('applemusic')
        .setDescription('Share your currently playing track as an Apple Music link.')
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
                console.error('Error fetching Last.fm track for Apple Music command:', err);
                const msg = '⚠️ Could not fetch your current track from Last.fm.';
                isSlash ? await interactionOrMessage.reply(msg) : await interactionOrMessage.channel.send(msg);
                return;
            }
        }

        try {
            const amInfo = await AppleMusic.searchTrack(artist, trackName);

            if (!amInfo?.storeUrl) {
                const msg = `❌ Couldn’t find **${trackName}** by **${artist}** on Apple Music.`;
                isSlash ? await interactionOrMessage.reply(msg) : await interactionOrMessage.channel.send(msg);
                return;
            }

            if (isSlash) {
                await interactionOrMessage.reply(amInfo.storeUrl);
            } else {
                await interactionOrMessage.channel.send(amInfo.storeUrl);
            }

        } catch (err) {
            console.error('Error in applemusic command:', err);
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
