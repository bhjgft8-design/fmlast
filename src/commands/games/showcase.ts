import { BaseCommand } from '../../structures/BaseCommand';
import { prisma } from '../../database/client';
import { SlashCommandBuilder, TextChannel, AttachmentBuilder, ChannelType } from "discord.js";
import { ShowcaseRenderService, ShowcaseData } from '../../services/bot/ShowcaseRenderService';
import { LastFM } from '../../services/api/LastFM';
import { Spotify } from '../../services/api/Spotify';
import { TrackResolverService } from '../../services/api/TrackResolverService';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { config } from '../../../config';

export default class ShowcaseCommand extends BaseCommand {
    name = 'showcase';
    description = 'Display your premium gamer profile and top collected cards!';
    aliases = ['binder', 'sc'];

    slashData = new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('Display your gamer profile and top cards')
        .addUserOption(opt => opt.setName('user').setDescription('User to view the showcase of'));

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        const channel = interactionOrMessage.channel as TextChannel;
        const targetId = isSlash 
            ? (interactionOrMessage.options.getUser('user')?.id || interactionOrMessage.user.id)
            : (interactionOrMessage.mentions?.users?.first()?.id || interactionOrMessage.author.id);

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { channel.sendTyping(); } catch { } }

        const dbUser = await prisma.user.findUnique({
            where: { discordId: targetId },
            include: { gameProfile: true }
        });

        if (!dbUser) {
            const msg = '❌ User not found or has not registered yet.';
            isSlash ? await interactionOrMessage.editReply(msg) : await channel.send(msg);
            return;
        }

        // Fetch user data
        const discordUser = await interactionOrMessage.client.users.fetch(targetId);
        const avatarUrl = discordUser.displayAvatarURL({ extension: 'png', size: 256 });
        const username = discordUser.username;

        const crowns = await prisma.crown.count({ where: { userId: dbUser.id } });
        const vinylScraps = dbUser.gameProfile?.vinylScraps || 0;

        // Fetch Now Playing from Last.fm
        let nowPlaying = null;
        if (dbUser.lastfmUsername) {
            try {
                const recentTracks = await LastFM.getRecentTracks(dbUser.lastfmUsername, 1, dbUser.lastfmSessionKey);
                if (recentTracks && recentTracks.length > 0 && recentTracks[0]['@attr']?.nowplaying) {
                    const np = recentTracks[0];
                    const artist = typeof np.artist === 'string' ? np.artist : np.artist['#text'];
                    nowPlaying = {
                        artist,
                        track: np.name,
                        image: np.image?.find((i: any) => i.size === 'extralarge')?.['#text'] || ''
                    };
                }
            } catch { }
        }

        // Fetch Top 3 Cards
        // We'll combine Albums and Artists, sort by XP, and take top 3
        const albums = await prisma.userAlbumCollection.findMany({
            where: { userId: dbUser.id },
            include: { album: { include: { artist: true } } },
            orderBy: { masteryXp: 'desc' },
            take: 3
        });

        const artists = await prisma.userArtistCollection.findMany({
            where: { userId: dbUser.id },
            include: { artist: true },
            orderBy: { masteryXp: 'desc' },
            take: 3
        });

        let allCards = [
            ...albums.map(a => ({
                artistName: a.album.artist.name,
                albumName: a.album.name,
                image: a.album.imageLarge || '',
                rarity: a.rarity,
                variant: a.variant,
                masteryXp: a.masteryXp,
                type: 'ALBUM'
            })),
            ...artists.map(a => ({
                artistName: 'OFFICIAL ARTIST',
                albumName: a.artist.name,
                image: '', 
                rarity: a.rarity,
                variant: a.variant,
                masteryXp: a.masteryXp,
                type: 'ARTIST'
            }))
        ];

        allCards.sort((a, b) => b.masteryXp - a.masteryXp);
        const topCards = allCards.slice(0, 3);

        // Resolve images for top cards
        for (const card of topCards) {
            if (card.type === 'ALBUM' && !card.image) {
                const res = await TrackResolverService.resolveAlbum(card.artistName, card.albumName);
                card.image = res.artworkUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
            } else if (card.type === 'ARTIST' && !card.image) {
                try {
                    const res = await TrackResolverService.resolveArtist(card.albumName);
                    card.image = res.avatarUrl || 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
                } catch {
                    card.image = 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
                }
            }
        }

        const data: ShowcaseData = {
            username,
            avatarUrl,
            nowPlaying,
            vinylScraps,
            crowns,
            topCards: topCards.map(c => ({
                artistName: c.artistName,
                albumName: c.albumName,
                image: c.image,
                rarity: c.rarity,
                variant: c.variant,
                masteryXp: c.masteryXp
            }))
        };

        const buffer = await ShowcaseRenderService.renderShowcase(data);
        
        // ── Upload to Staging Channel ──
        let cdnUrl: string | null = null;
        const stagingChannelId = config.CHART_STAGING_CHANNEL_ID;
        const client = interactionOrMessage.client;
        
        if (stagingChannelId && client) {
            try {
                const stagingChannel = await client.channels.fetch(stagingChannelId) as TextChannel;
                if (stagingChannel?.type === ChannelType.GuildText) {
                    const att = new AttachmentBuilder(buffer, { name: `showcase_${targetId}.webp` });
                    const stagingMsg = await stagingChannel.send({ files: [att] });
                    cdnUrl = stagingMsg.attachments.first()?.url || null;
                    
                    // Auto-delete after 24h to keep staging clean
                    setTimeout(() => stagingMsg.delete().catch(() => {}), 86400000);
                }
            } catch (e) {
                console.error('[Showcase] Staging upload failed:', e);
            }
        }

        const builder = new ComponentsV2()
            .setAccent(0x6366f1)
            .setImage(cdnUrl || 'attachment://showcase.webp')
            .addFooter(`Generated for ${username} • Binder v2`);

        const payload: any = builder.build();
        if (!cdnUrl) {
            payload.files = [new AttachmentBuilder(buffer, { name: 'showcase.webp' })];
        }

        isSlash 
            ? await interactionOrMessage.editReply(payload)
            : await channel.send(payload);
    }
}
