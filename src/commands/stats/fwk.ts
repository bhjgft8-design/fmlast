import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { prisma } from '../../database/client';
import { TextChannel } from 'discord.js';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { triggerDeltaSync } from '../../services/bot/QueueWorker';
import { FriendService } from '../../services/bot/FriendService';
import { TrackResolverService } from '../../services/api/TrackResolverService';

interface LocalUser {
    id: string;
    discordId: string;
    lastfmUsername: string | null;
    displayName: string;
    playcount: number;
}

export default class FriendWhoKnowsCommand extends BaseCommand {
    name = 'fwk';
    description = 'Find out who listens to an artist the most among your friends';

    slashData = new (require('discord.js').SlashCommandBuilder)()
        .setName('fwk')
        .setDescription('Find out who listens to an artist the most among your friends')
        .addStringOption((o: any) => o.setName('artist').setDescription('Artist name to search').setRequired(false));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        let artistName = args?.join(' ') || '';

        if (isSlash) {
            artistName = interactionOrMessage.options.getString('artist') || '';
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

        // Fire & Forget: Background sync
        triggerDeltaSync(authorId);

        if (!artistName) {
            try {
                const tracks = await LastFM.getRecentTracks(dbUser.lastfmUsername, 1, dbUser.lastfmSessionKey);
                if (tracks.length > 0) {
                    artistName = tracks[0].artist?.['#text'] || tracks[0].artist?.name;
                }
            } catch (e: any) {
                const reply = `❌ Error: ${e.message}`;
                return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
            }
        }

        if (!artistName) {
            const reply = '❌ Could not determine artist. Are you currently playing anything?';
            return isSlash ? interactionOrMessage.editReply(reply) : interactionOrMessage.reply(reply);
        }

        const friends = await FriendService.getFriends(authorId);
        const friendUserIds = friends.map((f: any) => f.id);
        friendUserIds.push(dbUser.id); // Include the author

        const localResults = await prisma.userArtist.findMany({
            where: { 
                artistName: { equals: artistName, mode: 'insensitive' },
                userId: { in: friendUserIds } 
            },
            include: { user: true },
            orderBy: { playcount: 'desc' },
            take: 15
        });

        // Resolve capitalizing artistName to whatever the top DB result is
        if (localResults.length > 0) {
            artistName = localResults[0].artistName;
        }

        const localUsers: LocalUser[] = localResults.map(r => ({
            id: r.user.id,
            discordId: r.user.discordId,
            lastfmUsername: r.user.lastfmUsername,
            displayName: r.user.lastfmUsername || r.user.discordId,
            playcount: r.playcount
        }));

        // ── 1. GLOBAL RESOLUTION (UTR) ──
        const resolved = await TrackResolverService.resolveArtist(artistName);
        
        artistName = resolved.artist;
        const thumbnail = resolved.avatarUrl;
        const tagsText = resolved.tags.filter(n => n.toLowerCase() !== 'seen live').slice(0, 4).join(' - ').toLowerCase();

        if (localUsers.length === 0) {
            const reply = `None of your friends know **${artistName}**.`;
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

        let content = `### [${artistName} among Friends](https://www.last.fm/music/${encodeURIComponent(artistName)})\n${topDesc}`;
        
        if (tagsText) {
            content += `\n-# *${tagsText}*`;
        }

        const builder = new ComponentsV2()
            .setAccent(0xffb84d); // Custom accent for friends
            
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
