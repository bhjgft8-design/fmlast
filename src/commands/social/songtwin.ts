// src/commands/lastfm/songtwin.ts
import { BaseCommand } from '../../structures/BaseCommand';
import { LastFM } from '../../services/api/LastFM';
import { Deezer } from '../../services/api/Deezer';
import { AppleMusic } from '../../services/api/AppleMusic';
import { Spotify } from '../../services/api/Spotify';
import { prisma } from '../../database/client';
import { AttachmentBuilder, SlashCommandBuilder, TextChannel, ChannelType } from 'discord.js';
import { config } from '../../../config';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { PuppeteerService } from '../../services/external/PuppeteerService';
import { ArtistMetadataService } from '../../services/external/ArtistMetadataService';
import { TrackResolverService } from '../../services/api/TrackResolverService';

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

/** Compute Sørensen–Dice compatibility overlap between two string sets */
function computeCompatibility(setA: string[], setB: string[]): number {
    if (!setA.length || !setB.length) return 0;
    const a = new Set(setA.map(s => s.toLowerCase().trim()));
    const b = new Set(setB.map(s => s.toLowerCase().trim()));
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection++;
    }
    // Use Sørensen–Dice coefficient for a much fairer overlap metric
    const dice = (2 * intersection) / (a.size + b.size);
    // Apply a logarithmic scale/curve so modest overlaps yield higher scores (since sharing 15 of top 50 is massive)
    let score = Math.pow(dice, 0.6) * 100;
    return Math.min(100, Math.round(score));
}

/** Get top artist names from a list */
function getArtistNames(artists: any[]): string[] {
    return artists.map(a => a.name).filter(Boolean);
}



// ═══════════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════════

export default class SongTwinCommand extends BaseCommand {
    name = 'songtwin';
    description = 'Compare music taste with another user and see your sonic compatibility score.';
    aliases = ['twin', 'compare', 'musicmatch'];

    slashData = new SlashCommandBuilder()
        .setName('songtwin')
        .setDescription('Compare music taste with another user and see your compatibility score.')
        .addUserOption((opt: any) =>
            opt.setName('user')
                .setDescription('The Discord user to compare with (leave empty to compare with the server)')
                .setRequired(false)
        )
        .addStringOption((opt: any) =>
            opt.setName('period')
                .setDescription('Time period to compare')
                .setRequired(false)
                .addChoices(
                    { name: 'Week', value: '7day' },
                    { name: 'Month', value: '1month' },
                    { name: 'Year', value: '12month' },
                    { name: 'All Time', value: 'overall' }
                )
        );

    async execute(interactionOrMessage: any, isSlash = false, args?: string[]): Promise<void> {
        if (!isSlash) {
            try { (interactionOrMessage.channel as TextChannel).sendTyping(); } catch { }
        }

        const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;

        let period = '7day';
        if (isSlash) {
            period = interactionOrMessage.options.getString('period') || '7day';
        } else if (args && args.length > 0) {
            const joinedArgs = args.join(' ').toLowerCase();
            if (joinedArgs.includes('overall') || joinedArgs.includes('alltime') || joinedArgs.includes('all')) period = 'overall';
            else if (joinedArgs.includes('12month') || joinedArgs.includes('year')) period = '12month';
            else if (joinedArgs.includes('6month') || joinedArgs.includes('half')) period = '6month';
            else if (joinedArgs.includes('3month')) period = '3month';
            else if (joinedArgs.includes('1month') || joinedArgs.includes('month')) period = '1month';
            else period = '7day';
        }

        // ── Get initiating user ──
        const dbUser = await prisma.user.findUnique({ where: { discordId: userId } });
        if (!dbUser?.lastfmUsername || !dbUser?.lastfmSessionKey) {
            return this.replyError(interactionOrMessage, isSlash,
                '❌ You are not linked to Last.fm yet.\nRun `/login` or `+login` first!');
        }

        // ── Get target user ──
        let targetDiscordId: string | undefined = undefined;
        let targetDbUser: any = null;

        if (isSlash) {
            const targetUser = interactionOrMessage.options.getUser('user');
            if (targetUser) {
                targetDiscordId = targetUser.id;
                targetDbUser = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
                if (!targetDbUser?.lastfmUsername) {
                    return this.replyError(interactionOrMessage, isSlash,
                        `❌ **${targetUser.username}** hasn't linked their Last.fm account yet.`);
                }
            }
        } else if (args && args.length > 0) {
            // Prefix: try mention or last.fm username
            const mention = interactionOrMessage.mentions?.users?.first();
            if (mention) {
                targetDiscordId = mention.id;
                targetDbUser = await prisma.user.findUnique({ where: { discordId: mention.id } });
                if (!targetDbUser?.lastfmUsername) {
                    return this.replyError(interactionOrMessage, isSlash,
                        `❌ **${mention.username}** hasn't linked their Last.fm account yet.`);
                }
            }
        }

        if (isSlash) await interactionOrMessage.deferReply();
        else { try { (interactionOrMessage.channel as TextChannel).sendTyping(); } catch { } }

        try {
            // ── Fetch data for both users ── each independently to survive partial failures (Increased limit to 50 for deeper comparison)
            const artistsA = await LastFM.getTopArtists(dbUser.lastfmUsername, period, 50, dbUser.lastfmSessionKey).catch(() => []);
            const topTracksA = await LastFM.getTopTracks(dbUser.lastfmUsername, period, 50, dbUser.lastfmSessionKey).catch(() => []);
            let userInfoA = await LastFM.getUserInfo(dbUser.lastfmUsername, dbUser.lastfmSessionKey).catch(() => null);
            if (!userInfoA) userInfoA = await LastFM.getUserInfo(dbUser.lastfmUsername).catch(() => null); // Retry without session if authenticated fails

            const artistsB = targetDbUser
                ? await LastFM.getTopArtists(targetDbUser.lastfmUsername, period, 50, targetDbUser.lastfmSessionKey).catch(() => [])
                : [] as any[];
            const topTracksB = targetDbUser
                ? await LastFM.getTopTracks(targetDbUser.lastfmUsername, period, 50, targetDbUser.lastfmSessionKey).catch(() => [])
                : [] as any[];
            const topAlbumsA = await LastFM.getTopAlbums(dbUser.lastfmUsername, period, 20, dbUser.lastfmSessionKey).catch(() => []);
            const topAlbumsB = targetDbUser
                ? await LastFM.getTopAlbums(targetDbUser.lastfmUsername, period, 20, targetDbUser.lastfmSessionKey).catch(() => [])
                : [] as any[];

            const userInfoB = targetDbUser
                ? await LastFM.getUserInfo(targetDbUser.lastfmUsername, targetDbUser.lastfmSessionKey).catch(() => null)
                : null;

            const namesA = getArtistNames(artistsA);
            const namesB = getArtistNames(artistsB);

            // ── Shared / Unique artists ──
            const sharedArtists = namesA.filter(n => namesB.map(b => b.toLowerCase()).includes(n.toLowerCase())).slice(0, 6);
            const uniqueToA = namesA.filter(n => !namesB.map(b => b.toLowerCase()).includes(n.toLowerCase())).slice(0, 3);
            const uniqueToB = namesB.filter(n => !namesA.map(a => a.toLowerCase()).includes(n.toLowerCase())).slice(0, 3);

            // ── Compatibility score (artists + tracks combined) ──
            const trackNamesA = (topTracksA as any[]).map((t: any) => `${t.name}::${t.artist?.name || ''}`);
            const trackNamesB = (topTracksB as any[]).map((t: any) => `${t.name}::${t.artist?.name || ''}`);
            const artistScore = computeCompatibility(namesA, namesB);
            const trackScore = computeCompatibility(trackNamesA, trackNamesB);
            const compatScore = Math.round((artistScore * 0.6) + (trackScore * 0.4));

            // ── Bridge tracks recommendation (one per shared artist, up to 7) ──
            const bridgeTracks: { track: string; artist: string; cover: string | null }[] = [];

            const bridgePool = sharedArtists.slice(0, 7);
            for (const chosen of bridgePool) {
                try {
                    // 1. Find tracks by this artist that BOTH users have in their top lists
                    const sharedInUserHistory = topTracksA.filter(ta =>
                        ta.artist?.name?.toLowerCase() === chosen.toLowerCase() &&
                        topTracksB.some(tb => tb.name.toLowerCase() === ta.name.toLowerCase() && tb.artist?.name?.toLowerCase() === chosen.toLowerCase())
                    );

                    // 2. Find tracks by this artist that AT LEAST one user has
                    const eitherInUserHistory = [
                        ...topTracksA.filter(ta => ta.artist?.name?.toLowerCase() === chosen.toLowerCase()),
                        ...topTracksB.filter(tb => tb.artist?.name?.toLowerCase() === chosen.toLowerCase())
                    ];

                    // Unique tracks from history
                    const historyTracks = [...new Map([...sharedInUserHistory, ...eitherInUserHistory].map(t => [t.name.toLowerCase(), t])).values()];

                    // 3. Fallback to global top tracks if history is empty
                    const globalTop = historyTracks.length > 0 ? [] : await LastFM.getArtistTopTracks(chosen, 5);

                    const candidateTracks = [...historyTracks, ...globalTop];

                    if (candidateTracks.length > 0) {
                        let cover: string | null = null;
                        let source = 'none';
                        let trackName = '';

                        // ── GLOBAL RESOLUTION (UTR) ──
                        for (let i = 0; i < Math.min(candidateTracks.length, 5); i++) {
                            const pick = candidateTracks[i];
                            const res = await TrackResolverService.resolve(chosen, pick.name);
                            if (res.artworkUrl) {
                                cover = res.artworkUrl;
                                source = res.source;
                                trackName = res.title;
                                break;
                            }
                        }


                        if (cover && trackName) {
                            console.log(`[songtwin] Resolved Bridge Track: ${chosen} — ${trackName} (${source})`);
                            bridgeTracks.push({ track: trackName, artist: chosen, cover });
                        }
                    }
                } catch { }
            }

            // ── Name & display info ──
            const userObjA = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
            let displayNameA = userObjA.globalName || userObjA.displayName || userObjA.username;
            const usernameA = dbUser.lastfmUsername;

            // Use server nickname if possible (User A)
            if (interactionOrMessage.guild) {
                try {
                    const memberA = await interactionOrMessage.guild.members.fetch(userId);
                    displayNameA = memberA.displayName;
                } catch { }
            }

            const guildName = interactionOrMessage.guild?.name || 'Server';
            let displayNameB = targetDbUser?.lastfmUsername || guildName;
            const usernameB = targetDbUser?.lastfmUsername || 'server';

            const avatarAUrl = userObjA.displayAvatarURL({ extension: 'png', size: 256 });

            let avatarBUrl = 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
            if (targetDiscordId) {
                try {
                    const targetUserObj = await interactionOrMessage.client.users.fetch(targetDiscordId);
                    avatarBUrl = targetUserObj.displayAvatarURL({ extension: 'png', size: 256 });

                    if (interactionOrMessage.guild) {
                        try {
                            const memberB = await interactionOrMessage.guild.members.fetch(targetDiscordId);
                            displayNameB = memberB.displayName;
                        } catch {
                            displayNameB = targetUserObj.globalName || targetUserObj.displayName || targetUserObj.username;
                        }
                    } else {
                        displayNameB = targetUserObj.globalName || targetUserObj.displayName || targetUserObj.username;
                    }
                } catch { }
            }

            // ── Background Selection Logic ──
            const bgPool: { name: string; artist?: string; type: 'artist' | 'track' | 'album' }[] = [];
            artistsA.slice(0, 5).forEach(a => bgPool.push({ name: a.name, type: 'artist' }));
            artistsB.slice(0, 5).forEach(a => bgPool.push({ name: a.name, type: 'artist' }));
            topTracksA.slice(0, 5).forEach(t => bgPool.push({ name: t.name, artist: t.artist?.name, type: 'track' }));
            topTracksB.slice(0, 5).forEach(t => bgPool.push({ name: t.name, artist: t.artist?.name, type: 'track' }));
            topAlbumsA.slice(0, 5).forEach(a => bgPool.push({ name: a.name, artist: a.artist?.name, type: 'album' }));
            topAlbumsB.slice(0, 5).forEach(a => bgPool.push({ name: a.name, artist: a.artist?.name, type: 'album' }));

            // ── Prepare Data for Puppeteer ──
            const periodLabelMap: Record<string, string> = {
                '7day': 'the last 7 days',
                '1month': 'the last month',
                '12month': 'the last year',
                'overall': 'all time'
            };
            const periodLabelText = periodLabelMap[period] || 'LAST 7 DAYS';

            const renderData = {
                bgUrl: '', // Will populate below
                userA: {
                    avatarUrl: avatarAUrl,
                    displayName: displayNameA,
                    username: usernameA,
                    scrobbles: userInfoA?.playcount ? `${Number(userInfoA.playcount).toLocaleString()} scrobbles` : 'Scrobbles hidden',
                    topArtists: namesA.slice(0, 6).map((name, i) => ({
                        rank: i + 1,
                        name: truncate(name, 25),
                        isShared: namesB.map(b => b.toLowerCase()).includes(name.toLowerCase())
                    }))
                },
                userB: {
                    avatarUrl: avatarBUrl,
                    displayName: displayNameB,
                    username: usernameB,
                    scrobbles: targetDbUser && userInfoB?.playcount ? `${Number(userInfoB.playcount).toLocaleString()} scrobbles` : '',
                    topArtists: namesB.slice(0, 6).map((name, i) => ({
                        rank: i + 1,
                        name: truncate(name, 25),
                        isShared: namesA.map(a => a.toLowerCase()).includes(name.toLowerCase())
                    }))
                },
                compatScore,
                compatColor: compatScore >= 75 ? '#a8f0a0' : compatScore >= 50 ? '#f0e08a' : compatScore >= 25 ? '#f0b47a' : '#f07a7a',
                sharedArtists: sharedArtists.slice(0, 3),
                bridgeTracks: bridgeTracks.slice(0, 7).map(t => ({
                    track: truncate(t.track, 30),
                    artist: truncate(t.artist, 25),
                    coverUrl: t.cover
                })),
                periodLabel: periodLabelText.toUpperCase()
            };

            // ── Background URL ──
            if (bgPool.length > 0) {
                const choice = bgPool[Math.floor(Math.random() * bgPool.length)];
                const itemName = choice.name;
                const artistName = choice.artist || choice.name;

                try {
                    let bgUrl: string | null = null;
                    if (choice.type === 'artist') {
                        const res = await TrackResolverService.resolveArtist(itemName);
                        bgUrl = res.avatarUrl;
                    } else if (choice.type === 'album') {
                        const res = await TrackResolverService.resolveAlbum(artistName, itemName);
                        bgUrl = res.artworkUrl;
                    } else {
                        const res = await TrackResolverService.resolve(artistName, itemName);
                        bgUrl = res.artworkUrl;
                    }
                    if (bgUrl) renderData.bgUrl = bgUrl;
                } catch (e) {
                    console.warn('[songtwin] Background resolution failed:', e);
                }
            }

            // ── Render with Puppeteer ──
            const buffer = await PuppeteerService.render('songtwin', renderData, { width: 900, height: 600 });

            // ── Upload via staging ──
            let cdnUrl: string | null = null;
            const stagingChannelId = config.CHART_STAGING_CHANNEL_ID;
            if (stagingChannelId && interactionOrMessage.client) {
                try {
                    const stagingChannel = await interactionOrMessage.client.channels.fetch(stagingChannelId) as TextChannel;
                    if (stagingChannel?.type === ChannelType.GuildText) {
                        const att = new AttachmentBuilder(buffer, { name: 'songtwin.webp' });
                        const msg = await stagingChannel.send({ files: [att] });
                        cdnUrl = msg.attachments.first()?.url || null;
                        // Deleting after 24 hours to keep the CDN link alive for a while
                        setTimeout(() => msg.delete().catch(() => { }), 86400000);
                    }
                } catch (e) {
                    console.warn('⚠️ SongTwin staging failed:', e);
                }
            }

            // ── Build score label ──
            const scoreLabel = compatScore >= 80 ? '🔥 Sonic Soulmates'
                : compatScore >= 60 ? '💜 Great Taste Overlap'
                    : compatScore >= 40 ? '🎵 Some Common Ground'
                        : compatScore >= 20 ? '🎧 Different Worlds'
                            : '👽 Complete Opposites';

            const contentText = [
                `###  Song Twin — ${scoreLabel}`,
                `**${displayNameA}** and **${displayNameB}** share **${compatScore}%** compatibility over **${periodLabelText}**`,
                sharedArtists.length > 0
                    ? `-# Common artists: ${sharedArtists.slice(0, 7).join(', ')}${sharedArtists.length > 7 ? ' + more' : ''}`
                    : `-# No shared artists in this period`
            ].join('\n');

            // ── Payload ──
            const builder = new ComponentsV2().setAccent(0x8050ff);

            if (cdnUrl) {
                builder.addMedia(cdnUrl, `${displayNameA} vs ${displayNameB} — ${compatScore}% compatibility`)
                    .addSeparator()
                    .addText(contentText);

                const payload = builder.build();
                if (isSlash) await interactionOrMessage.editReply(payload);
                else await interactionOrMessage.channel.send(payload);
            } else {
                // Fallback: direct attachment
                const payload: any = {
                    content: contentText,
                    files: [new AttachmentBuilder(buffer, { name: 'songtwin.webp' })],
                    flags: 32768
                };
                if (isSlash) await interactionOrMessage.editReply(payload);
                else await interactionOrMessage.channel.send(payload);
            }

        } catch (err: any) {
            console.error('[songtwin] error:', err);
            await this.replyError(interactionOrMessage, isSlash, `❌ ${err.message || 'Failed to generate Song Twin card.'}`);
        }
    }

    private async replyError(interactionOrMessage: any, isSlash: boolean, msg: string): Promise<void> {
        const payload = new ComponentsV2()
            .setAccent(0xff4444)
            .addText(msg)
            .build();

        if (isSlash) {
            if (interactionOrMessage.deferred || interactionOrMessage.replied) {
                await interactionOrMessage.editReply({ ...payload, ephemeral: true });
            } else {
                await interactionOrMessage.reply({ ...payload, ephemeral: true });
            }
        } else {
            await interactionOrMessage.channel.send(payload);
        }
    }
}

function truncate(str: string, maxLen: number): string {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
}
