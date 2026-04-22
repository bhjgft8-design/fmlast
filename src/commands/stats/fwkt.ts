import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { TextChannel } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { triggerDeltaSync } from '../../services/bot/QueueWorker';
import { FriendService } from '../../services/bot/FriendService';

interface LocalUser {
    id: string;
    discordId: string;
    lastfmUsername: string | null;
    displayName: string;
    playcount: number;
}

export default class FriendWhoKnowsTrackCommand extends BaseCommand {
    name = 'fwkt';
    description = 'Find out who listens to a track the most among your friends';

    slashData = new (require('discord.js').SlashCommandBuilder)()
        .setName('fwkt')
        .setDescription('Find out who listens to a track the most among your friends')
        .addStringOption((o: any) => o.setName('query').setDescription('Track name (or "track by artist")').setRequired(false));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        let searchQuery = args?.join(' ') || '';

        if (isSlash) {
            searchQuery = interactionOrMessage.options.getString('query') || '';
            await interactionOrMessage.deferReply();
        } else {
            try { if (interactionOrMessage.channel) (interactionOrMessage.channel as TextChannel).sendTyping(); } catch {}
        }

        const authorId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;

        const dbUser = await prisma.user.findUnique({ where: { discordId: authorId } });
        if (!dbUser || !dbUser.lastfmUsername) {
            const reply = '❌ You must link your Last.fm account first! Use `/login`.';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        triggerDeltaSync(authorId);

        let artistName = '';
        let trackName = '';

        if (!searchQuery) {
            try {
                const tracks = await LastFM.getRecentTracks(dbUser.lastfmUsername, 1, dbUser.lastfmSessionKey);
                if (tracks.length > 0) {
                    artistName = tracks[0].artist?.['#text'] || tracks[0].artist?.name || '';
                    trackName = tracks[0].name || '';
                }
            } catch (e: any) {
                const reply = `❌ Error: ${e.message}`;
                return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
            }
        } else {
            const byIndex = searchQuery.toLowerCase().lastIndexOf(' by ');
            if (byIndex !== -1) {
                trackName = searchQuery.substring(0, byIndex).trim();
                artistName = searchQuery.substring(byIndex + 4).trim();
            } else {
                let foundMatch = false;
                const lowerQuery = searchQuery.toLowerCase();
                try {
                    const recent = await LastFM.getRecentTracks(dbUser.lastfmUsername, 200, dbUser.lastfmSessionKey);
                    const exactMatch = recent.find((t: any) => t.name?.toLowerCase() === lowerQuery);
                    const partialMatch = !exactMatch ? recent.find((t: any) => t.name?.toLowerCase().includes(lowerQuery)) : null;
                    const match = exactMatch || partialMatch;

                    if (match) {
                        trackName = match.name;
                        artistName = match.artist?.name || match.artist?.['#text'] || '';
                        foundMatch = true;
                    }
                } catch {}

                if (!foundMatch) {
                    try {
                        const lfmTracks = await LastFM.searchTracks(searchQuery, 1);
                        if (lfmTracks && lfmTracks.length > 0) {
                            trackName = lfmTracks[0].name;
                            artistName = lfmTracks[0].artist;
                        } else {
                            trackName = searchQuery;
                        }
                    } catch {
                        trackName = searchQuery;
                    }
                }
            }
        }

        if (!trackName) {
            const reply = '❌ Could not determine track. Are you currently playing anything?';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        const friends = await FriendService.getFriends(authorId);
        const friendUserIds = friends.map((f: any) => f.id);
        friendUserIds.push(dbUser.id);

        const localResults = await prisma.userTrack.findMany({
            where: { 
                trackName: { equals: trackName, mode: 'insensitive' },
                ...(artistName ? { artistName: { equals: artistName, mode: 'insensitive' } } : {}),
                userId: { in: friendUserIds }
            },
            include: { user: true },
            orderBy: { playcount: 'desc' },
            take: 15
        });

        if (localResults.length > 0) {
            trackName = localResults[0].trackName;
            artistName = localResults[0].artistName;
        }

        const localUsers: LocalUser[] = localResults.map(r => ({
            id: r.user.id,
            discordId: r.user.discordId,
            lastfmUsername: r.user.lastfmUsername,
            displayName: r.user.lastfmUsername || r.user.discordId,
            playcount: r.playcount
        }));

        let thumbnail = null;
        try {
            const { Spotify } = await import('../../services/api/Spotify');
            const { Deezer } = await import('../../services/api/Deezer');

            const spInfo = await Spotify.getTrackInfo(trackName, artistName);
            let url = spInfo.coverUrl;
            
            if (!url) {
                url = await Deezer.getTrackCover(trackName, artistName);
            }
            
            thumbnail = url || null;
        } catch {
            thumbnail = null;
        }

        if (localUsers.length === 0) {
            const titleStr = artistName ? `${trackName} by ${artistName}` : trackName;
            const reply = `None of your friends know **${titleStr}**.`;
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        let topDesc = '';
        for (let i = 0; i < localUsers.length; i++) {
            const u = localUsers[i];
            const isMe = u.discordId === authorId;
            const prefix = isMe ? '🔥' : `${i + 1}.`;
            const spacing = isMe ? '\u200A\u2005' : '\u2004\u2005';
            
            topDesc += `\u2005${prefix}${spacing}**[${u.displayName}](https://last.fm/user/${encodeURIComponent(u.lastfmUsername!)})\u200E** - **${u.playcount}** plays\n`;
        }

        const titleDisplay = artistName ? `${trackName} by ${artistName}` : trackName;
        const fmLink = artistName ? `https://www.last.fm/music/${encodeURIComponent(artistName)}/_/${encodeURIComponent(trackName)}` : `https://www.last.fm/search?q=${encodeURIComponent(trackName)}`;
        
        let content = `### [${titleDisplay} among Friends](${fmLink})\n${topDesc}`;
        
        const builder = new ComponentsV2()
            .setAccent(0xffb84d);
            
        if (thumbnail) {
            builder.addThumbnail(thumbnail, content);
        } else {
            builder.addText(content);
        }

        const componentPayload = builder.build();

        if (isSlash) {
            await interactionOrMessage.editReply(componentPayload);
        } else {
            await interactionOrMessage.reply(componentPayload);
        }
    }
}
