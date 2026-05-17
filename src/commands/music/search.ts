import {
  BaseCommand } from '../../structures/BaseCommand';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { SlashCommandBuilder,
  ChatInputCommandInteraction,
  Message,
  ComponentType,
  TextChannel,
  ButtonStyle
} from "discord.js";
import { Youtube, YoutubeResult } from '../../services/api/Youtube';
import { MusicPlayer } from '../../services/music/MusicPlayer';
import { QueueManager } from '../../services/music/QueueManager';
import { MetadataService } from '../../services/bot/MetadataService';
import { prisma } from '../../database/client';

const searchCache = new Map<string, { results: YoutubeResult[]; expiresAt: number }>();

export default class SearchCommand extends BaseCommand {
    name = 'search';
    description = 'Search YouTube and pick a song to play';
    aliases = ['s'];

    slashData = new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search YouTube and pick a song to play')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Search keywords')
                .setRequired(true));

    async execute(interactionOrMessage: any, isSlash = false, args: string[] = []): Promise<void> {

        const guildId = interactionOrMessage.guildId;
        if (!guildId) return;

        if (!isSlash) await interactionOrMessage.channel.sendTyping().catch(() => {});

        const query = isSlash 
            ? interactionOrMessage.options.getString('query', true)
            : args?.join(' ');

        if (!query) {
            const builder = new ComponentsV2().addText('❌ Please provide a search query.');
            await interactionOrMessage.reply(builder.build());
            return;
        }

        const member = interactionOrMessage.member;
        if (!member?.voice?.channel) {
            const builder = new ComponentsV2().addText('❌ You must be in a voice channel.');
            await interactionOrMessage.reply({ ...builder.build(), ephemeral: true });
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply();

        try {
            const cacheKey = query.toLowerCase().trim();
            const cached = searchCache.get(cacheKey);
            const results = (cached && Date.now() < cached.expiresAt)
                ? cached.results
                : await Youtube.searchByQuery(query);

            if (!cached || Date.now() >= cached.expiresAt) {
                searchCache.set(cacheKey, { results, expiresAt: Date.now() + 60_000 });
            }

            if (results.length === 0) {
                const builder = new ComponentsV2().addText(`❌ No results found for **${query}**.`);
                if (isSlash) await interactionOrMessage.editReply(builder.build());
                else await interactionOrMessage.reply(builder.build());
                return;
            }

            // Filter already-queued tracks from results
            const queue = QueueManager.getQueue(guildId);
            const queuedUrls = new Set([
                queue?.currentTrack?.url,
                ...(queue?.tracks.map(t => t.url) ?? [])
            ].filter(Boolean));

            const filteredResults = results.filter(r => !queuedUrls.has(r.url));
            const displayResults = filteredResults.length > 0 ? filteredResults : results;

            const options = displayResults.slice(0, 10).map((track, i) => ({
                label: `${i + 1}. ${track.title}`.substring(0, 100),
                description: `${track.channelTitle} • ${track.duration}`.substring(0, 100),
                value: i.toString()
            }));

            const authorId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
            const dbAuthor = await prisma.user.findUnique({ where: { discordId: authorId } });
            const embedColor = dbAuthor ? (await import('../../services/bot/SettingService')).SettingService.resolveAccentColor(dbAuthor) : 0x0a0a0b;

            const builder = new ComponentsV2()
                .setAccent(embedColor)
                .addText(`## 🔍 Search Results for "${query}"`)
                .addText(`Select a song from the menu below to add it to the queue.`)
                .addRow([
                    {
                        type: ComponentType.StringSelect, // StringSelect
                        customId: 'search_select',
                        placeholder: 'Choose a song...',
                        options
                    }
                ]);

            let message: Message;
            if (isSlash) {
                message = await interactionOrMessage.editReply(builder.build()) as Message;
            } else {
                message = await interactionOrMessage.reply(builder.build());
            }

            const userId = isSlash ? interactionOrMessage.user.id : interactionOrMessage.author.id;
            const collector = message.createMessageComponentCollector({
                filter: (i) => i.customId === 'search_select' && i.user.id === userId,
                time: 30000,
                max: 1
            });

            // Cancel collector if bot leaves or queue is cleared mid-search
            const leaveHandler = (gId: string) => {
                if (gId === guildId) collector.stop('bot_left');
            };
            QueueManager.on('queueDeleted', leaveHandler);

            collector.on('collect', async (i: any) => {
                const currentMember = await interactionOrMessage.guild.members.fetch(i.user.id).catch(() => null);
                if (!currentMember?.voice?.channel) {
                    await i.update(new ComponentsV2().addText('❌ You left the voice channel.').build());
                    return;
                }

                const index = parseInt(i.values[0]);
                const track = displayResults[index];

                const loading = new ComponentsV2().addText(`⏳ Adding **${track.title}** to queue...`);
                await i.update(loading.build());

                // Fetch DB user for metadata enrichment
                const dbUser = await prisma.user.findUnique({ where: { discordId: i.user.id } });

                // Join and play immediately without waiting for enrichment
                await MusicPlayer.join(guildId, member.voice.channel.id, interactionOrMessage.channel as TextChannel);
                const pos = await MusicPlayer.play(guildId, track);

                // Enrich concurrently in the background so search selection is instant!
                MetadataService.enrich(track, member, dbUser).catch(() => {});

                const displayName = track.title;
                const finalBuilder = new ComponentsV2()
                    .addText(`✅ **${displayName}** added to queue! ${pos > 0 ? `(Position: ${pos})` : '(Starting playback...)'}`);
                
                await i.editReply(finalBuilder.build());
            });

            collector.on('end', (collected, reason) => {
                QueueManager.off('queueDeleted', leaveHandler);
                if (collected.size === 0 && reason !== 'bot_left') {
                    const timeout = new ComponentsV2().addText('❌ Search timed out.');
                    message.edit(timeout.build()).catch(() => {});
                }
            });

        } catch (err) {
            console.error('[SearchCommand] Error:', err);
            const builder = new ComponentsV2().addText('❌ An error occurred during search.');
            if (isSlash) await interactionOrMessage.editReply(builder.build());
            else await interactionOrMessage.reply(builder.build());
        }
    }
}
