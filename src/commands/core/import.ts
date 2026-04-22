import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../../database/client';
import { ImportService, ScrobbleImportTrack } from '../../services/bot/ImportService';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import axios from 'axios';
import { indexQueue } from '../../services/bot/QueueWorker';
import { BaseCommand } from '../../structures/BaseCommand';

export default class ImportCommand extends BaseCommand {
    name = 'import';
    description = 'Import your music history from Spotify or Apple Music';
    
    slashData = new SlashCommandBuilder()
        .setName('import')
        .setDescription('Import your music history from Spotify or Apple Music')
        .addSubcommand(sub =>
            sub.setName('spotify')
                .setDescription('Import from Spotify Extended Streaming History (ZIP or JSON)')
                .addAttachmentOption(opt => opt.setName('file').setDescription('The history file (optional if URL provided)'))
                .addStringOption(opt => opt.setName('url').setDescription('Direct download URL for the ZIP/JSON file'))
        )
        .addSubcommand(sub =>
            sub.setName('apple')
                .setDescription('Import from Apple Music Play History (ZIP)')
                .addAttachmentOption(opt => opt.setName('file').setDescription('The history ZIP (optional if URL provided)'))
                .addStringOption(opt => opt.setName('url').setDescription('Direct download URL for the ZIP file'))
        );

    async execute(interactionOrMessage: any, isSlash = true, args: string[] = []) {
        const userObj = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
        
        const user = await prisma.user.findUnique({
            where: { discordId: userObj.id }
        });

        if (!user || !user.lastfmSessionKey) {
            const content = '❌ You must be logged in to Last.fm to use this command. Use `/login` first.';
            if (isSlash) await interactionOrMessage.reply({ content, ephemeral: true });
            else await interactionOrMessage.reply(content);
            return;
        }

        if (isSlash) await interactionOrMessage.deferReply({ ephemeral: true });

        // Determine subcommand and file
        let subcommand: string | null = null;
        let file: { url: string; size: number } | null = null;

        if (isSlash) {
            subcommand = interactionOrMessage.options.getSubcommand();
            const attachment = interactionOrMessage.options.getAttachment('file');
            const url = interactionOrMessage.options.getString('url');
            
            if (attachment) {
                file = { url: attachment.url, size: attachment.size };
            } else if (url) {
                file = { url, size: 0 };
            }
        } else {
            subcommand = args[0]?.toLowerCase();
            const attachment = interactionOrMessage.attachments.first();
            if (attachment) {
                file = { url: attachment.url, size: attachment.size };
            } else if (args[1]?.startsWith('http')) {
                file = { url: args[1], size: 0 };
            }
        }

        if (!subcommand || !['spotify', 'apple'].includes(subcommand)) {
            const content = '❌ Please specify a subcommand: `spotify` or `apple`. Usage: `+import <type> [attached file or URL]`';
            if (isSlash) await interactionOrMessage.editReply(content);
            else await interactionOrMessage.reply(content);
            return;
        }

        if (!file) {
            const content = '❌ Please attach a history file or provide a direct download URL.';
            if (isSlash) await interactionOrMessage.editReply(content);
            else await interactionOrMessage.reply(content);
            return;
        }

        // Basic size validation
        if (file.size > 50 * 1024 * 1024) {
            const content = '❌ File is too large. Please upload files smaller than 50MB.';
            if (isSlash) await interactionOrMessage.editReply(content);
            else await interactionOrMessage.reply(content);
            return;
        }

        try {
            const statusMsg = subcommand === 'spotify' ? '⏳ Preparing Spotify import...' : '⏳ Preparing Apple Music import...';
            if (isSlash) await interactionOrMessage.editReply(statusMsg);
            
            // Resolve direct link (Mediafire/Google Drive/etc)
            const directUrl = await ImportService.resolveDirectUrl(file.url);
            if (directUrl !== file.url) {
                if (isSlash) await interactionOrMessage.editReply('⏳ Link resolved. Downloading file...');
            }

            const response = await axios.get(directUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            let tracks: ScrobbleImportTrack[] = [];
            if (subcommand === 'spotify') {
                tracks = await ImportService.parseSpotify(buffer);
            } else if (subcommand === 'apple') {
                tracks = await ImportService.parseApple(buffer);
            }

            if (tracks.length === 0) {
                const content = '❌ No valid tracks found in that file. Make sure it is the correct export format.';
                if (isSlash) await interactionOrMessage.editReply(content);
                else await interactionOrMessage.reply(content);
                return;
            }

            const statusAnalysisMsg = `✅ Found **${tracks.length.toLocaleString()}** tracks. Analyzing timestamps...`;
            if (isSlash) await interactionOrMessage.editReply(statusAnalysisMsg);
            else await interactionOrMessage.reply(statusAnalysisMsg);
            
            const now = Math.floor(Date.now() / 1000);
            const TWO_WEEKS = 14 * 24 * 60 * 60;
            const hasOldTracks = tracks.some(t => t.timestamp < (now - TWO_WEEKS));

            if (hasOldTracks) {
                // If old tracks detected, we must ask for preference
                const job = await ImportService.createJob(user.id, subcommand.toUpperCase() as any, tracks, false, 'AWAITING_CHOICE');
                
                const builder = new ComponentsV2()
                    .setAccent(0xFFAA00) // Warning Orange
                    .addText(`### ⚠️ Old History Detected\nSome of your tracks are older than 14 days. **Last.fm will hide these** if scrobbled with original dates.`)
                    .addText(`Choose your import method:`)
                    .addText(`- **Legacy Import (Recommended)**: Uses "Current Timestamps" so they appear on your profile.`)
                    .addText(`- **Standard Import**: Keeps original dates (likely hidden).`)
                    .addRow([
                        { type: 2, label: 'Legacy Import', style: 3, custom_id: `imp_leg:${job.id}` },
                        { type: 2, label: 'Standard Import', style: 2, custom_id: `imp_std:${job.id}` }
                    ]);

                if (isSlash) await interactionOrMessage.editReply(builder.build());
                else await interactionOrMessage.reply(builder.build());
                return;
            }

            // Normal flow for new tracks
            const job = await ImportService.createJob(user.id, subcommand.toUpperCase() as any, tracks);

            const totalTracks = tracks.length;
            let estTime = 'less than 1 minute';
            if (totalTracks > 2800) {
                const days = Math.ceil((totalTracks - 2800) / 2800);
                estTime = `~1 minute (initial) + ${days} day${days > 1 ? 's' : ''} (scheduled)`;
            }

            const builder = new ComponentsV2()
                .setAccent(0x1DB954) // Spotify Green
                .addText(`### 📥 History Import Started\nWe've successfully queued **${totalTracks.toLocaleString()}** tracks for your account.`)
                .addText(`> **Daily Limit**: 2,800 scrobbles / 24h\n> **Estimated Time**: ${estTime}`)
                .addText(`We'll drip-feed these into your Last.fm account automatically. The first 2,800 tracks are starting right now!`);

            const payload = builder.build();
            if (isSlash) await interactionOrMessage.editReply(payload);
            else await interactionOrMessage.reply(payload);

            // Kick off the initial batch processing via queue
            if (indexQueue) {
                await indexQueue.add(`import-${job.id}`, { 
                    type: 'HISTORY_IMPORT',
                    jobId: job.id,
                    discordId: userObj.id
                });
            }

        } catch (err: any) {
            console.error('Import error:', err);
            const content = `❌ Error processing import: ${err.message}`;
            if (isSlash) await interactionOrMessage.editReply(content);
            else await interactionOrMessage.reply(content);
        }
    }
}
