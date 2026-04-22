import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { TextChannel } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { triggerDeltaSync } from '../../services/bot/QueueWorker';
import { config } from '../../../config';

interface LocalUser {
    id: string;
    discordId: string;
    lastfmUsername: string | null;
    displayName: string;
    playcount: number;
}

export default class WhoKnowsAlbumCommand extends BaseCommand {
    name = 'wka';
    description = 'Find out who listens to an album the most in this server';

    slashData = new (require('discord.js').SlashCommandBuilder)()
        .setName('wka')
        .setDescription('Find out who listens to an album the most in this server')
        .addStringOption((o: any) => o.setName('query').setDescription('Album name (or "album by artist")').setRequired(false));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        let searchQuery = args?.join(' ') || '';

        if (isSlash) {
            searchQuery = interactionOrMessage.options.getString('query') || '';
            await interactionOrMessage.deferReply();
        } else {
            try { (interactionOrMessage.channel as TextChannel).sendTyping(); } catch {}
        }

        const authorId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
        const guild = interactionOrMessage.guild;

        if (!guild) {
            const reply = '❌ This command can only be used in a server.';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        const dbUser = await prisma.user.findUnique({ where: { discordId: authorId } });
        if (!dbUser || !dbUser.lastfmUsername) {
            const reply = '❌ You must link your Last.fm account first! Use `/login`.';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        // Fire & Forget background sync
        triggerDeltaSync(authorId);

        let artistName = '';
        let albumName = '';

        if (!searchQuery) {
            try {
                const tracks = await LastFM.getRecentTracks(dbUser.lastfmUsername, 1, dbUser.lastfmSessionKey);
                if (tracks.length > 0) {
                    artistName = tracks[0].artist?.['#text'] || tracks[0].artist?.name || '';
                    albumName = tracks[0].album?.['#text'] || tracks[0].album?.name || '';
                }
            } catch (e: any) {
                const reply = `❌ Error: ${e.message}`;
                return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
            }
        } else {
            const byIndex = searchQuery.toLowerCase().lastIndexOf(' by ');
            if (byIndex !== -1) {
                albumName = searchQuery.substring(0, byIndex).trim();
                artistName = searchQuery.substring(byIndex + 4).trim();
            } else {
                let foundMatch = false;
                const lowerQuery = searchQuery.toLowerCase();
                try {
                    const recent = await LastFM.getRecentTracks(dbUser.lastfmUsername, 200, dbUser.lastfmSessionKey);
                    const exactMatch = recent.find((t: any) => t.album?.['#text']?.toLowerCase() === lowerQuery);
                    const partialMatch = !exactMatch ? recent.find((t: any) => t.album?.['#text']?.toLowerCase().includes(lowerQuery)) : null;
                    const match = exactMatch || partialMatch;

                    if (match) {
                        albumName = match.album?.['#text'];
                        artistName = match.artist?.name || match.artist?.['#text'] || '';
                        foundMatch = true;
                    }
                } catch {}

                if (!foundMatch) {
                    try {
                        const lfmAlbums = await LastFM.searchAlbums(searchQuery, 1);
                        if (lfmAlbums && lfmAlbums.length > 0) {
                            albumName = lfmAlbums[0].name;
                            artistName = lfmAlbums[0].artist;
                        } else {
                            albumName = searchQuery;
                        }
                    } catch {
                        albumName = searchQuery;
                    }
                }
            }
        }

        if (!albumName) {
            const reply = '❌ Could not determine album. Are you currently playing anything?';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        const globalResults = await prisma.userAlbum.findMany({
            where: { 
                albumName: { equals: albumName, mode: 'insensitive' },
                ...(artistName ? { artistName: { equals: artistName, mode: 'insensitive' } } : {})
            },
            include: { user: true },
            orderBy: { playcount: 'desc' }
        });

        // Use exact capitalization from DB or fallback to queried
        if (globalResults.length > 0) {
            albumName = globalResults[0].albumName;
            artistName = globalResults[0].artistName;
        }

        const globalIds = globalResults.map(r => r.user.discordId);
        let cachedMembers;
        try {
            cachedMembers = await guild.members.fetch({ user: globalIds });
        } catch (e) {
             console.error("Failed to fetch guild members:", e);
        }
        
        const localUsers: LocalUser[] = [];
        for (const row of globalResults) {
            const isBot = row.user.discordId === config.BOT_DISCORD_ID;
            const isAuthor = row.user.discordId === authorId;
            const inGuild = cachedMembers && cachedMembers.has(row.user.discordId);

            if (inGuild || isBot) {
                const member = inGuild ? cachedMembers.get(row.user.discordId) : null;
                localUsers.push({
                    id: row.user.id,
                    discordId: row.user.discordId,
                    lastfmUsername: row.user.lastfmUsername,
                    displayName: member?.displayName || row.user.lastfmUsername, 
                    playcount: row.playcount
                });
            } else if (!cachedMembers && isAuthor) {
                localUsers.push({
                    id: row.user.id,
                    discordId: row.user.discordId,
                    lastfmUsername: row.user.lastfmUsername,
                    displayName: (interactionOrMessage.guild?.members.cache.get(dbUser.discordId)?.displayName as string) || (dbUser.lastfmUsername as string),
                    playcount: row.playcount
                });
            }
        }

        let thumbnail = null;
        try {
            const { Spotify } = await import('../../services/api/Spotify');
            const { Deezer } = await import('../../services/api/Deezer');

            const spInfo = await Spotify.getAlbumInfo(albumName, artistName);
            let url = spInfo.coverUrl;
            
            if (!url) {
                url = await Deezer.getAlbumCover(albumName, artistName);
            }
            
            thumbnail = url || null;
        } catch {
            thumbnail = null;
        }

        if (localUsers.length === 0) {
            const titleStr = artistName ? `${albumName} by ${artistName}` : albumName;
            const reply = `Nobody knows **${titleStr}**.`;
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        localUsers.sort((a, b) => b.playcount - a.playcount);

        let topDesc = '';
        for (let i = 0; i < Math.min(localUsers.length, 10); i++) {
            const u = localUsers[i];
            topDesc += `\u2005${i + 1}.\u2004\u2005**[${u.displayName}](https://last.fm/user/${encodeURIComponent(u.lastfmUsername!)})\u200E** - **${u.playcount}** plays\n`;
        }

        const titleDisplay = artistName ? `${albumName} by ${artistName}` : albumName;
        const fmLink = artistName ? `https://www.last.fm/music/${encodeURIComponent(artistName)}/${encodeURIComponent(albumName)}` : `https://www.last.fm/search?q=${encodeURIComponent(albumName)}`;
        
        let content = `### [${titleDisplay} in ${guild.name}](${fmLink})\n${topDesc}`;
        
        const builder = new ComponentsV2()
            .setAccent(0x4f010b);
            
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
