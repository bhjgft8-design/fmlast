import {
  BaseCommand } from '../../structures/BaseCommand';
import { ComponentsV2 } from '../../utils/ComponentsV2';
import { SlashCommandBuilder,
  ComponentType,
  ButtonStyle
} from "discord.js";

export default class HelpCommand extends BaseCommand {
    name = 'help';
    description = 'Display all available commands and their usage';
    aliases = ['commands', 'h'];

    slashData = new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display all available commands and their usage');

    async execute(interactionOrMessage: any, isSlash = false): Promise<void> {

        const user = isSlash ? interactionOrMessage.user : interactionOrMessage.author;

        const categories = [
            {
                name: '📊 Statistics',
                emoji: '📊',
                description: 'Analyze your music taste, history, and playcounts',
                commands: [
                    { name: 'fm', desc: 'Show what you are currently listening to' },
                    { name: 'recent', desc: 'View your recently played tracks' },
                    { name: 'plays', desc: 'View total scrobble count for a time period' },
                    { name: 'overview', desc: 'View your daily listening overview (scrobbles per day)' },
                    { name: 'profile', desc: 'View your Last.fm profile stats' },
                    { name: 'streak', desc: 'View your current listening streak' },
                    { name: 'combo', desc: 'View your current listening streak (consecutive plays)' },
                    { name: 'milestone', desc: 'View your Nth scrobble' },
                    { name: 'pace', desc: 'View your scrobbling pace and projections' },
                    { name: 'scrobble', desc: 'Manually scrobble a track to Last.fm' },
                    { name: 'love', desc: 'Love a track on Last.fm' },
                    { name: 'unlove', desc: 'Unlove a track on Last.fm' },
                    { name: 'loved', desc: 'View loved tracks for a user' },
                ]
            },
            {
                name: '🏆 Top Lists',
                emoji: '🏆',
                description: 'Your top artists, albums, tracks, and more',
                commands: [
                    { name: 'tt', desc: 'View your top tracks for a time period' },
                    { name: 'ta', desc: 'View your top albums for a time period' },
                    { name: 'tar', desc: 'View your top artists for a time period' },
                    { name: 'at', desc: 'View your top tracks for a specific artist' },
                    { name: 'artist', desc: 'View detailed information about an artist' },
                    { name: 'artistalbums', desc: 'View your top albums for a specific artist' },
                    { name: 'artistplays', desc: 'View playcount over time for an artist' },
                    { name: 'albumplays', desc: 'View playcount over time for an album' },
                    { name: 'albumtracks', desc: 'View your playcounts for each track on an album' },
                    { name: 'trackplays', desc: 'View playcount over time for a track' },
                    { name: 'country', desc: 'View your top countries by scrobbles' },
                    { name: 'tag', desc: 'Explore your top artists, albums, or tracks by genre/tag' },
                    { name: 'search', desc: 'Search your scrobbles for artists, albums, or tracks' },
                ]
            },
            {
                name: '✨ Visuals & Cards',
                emoji: '✨',
                description: 'Beautiful generated cards and visual reports',
                commands: [
                    { name: 'aura', desc: 'Visualize your musical personality as a colour aura' },
                    { name: 'chart', desc: 'Generate a grid chart of your top albums' },
                    { name: 'receipt', desc: 'Generate a shopping receipt of your top music' },
                    { name: 'timeline', desc: 'Visualise how your music taste evolved over time' },
                    { name: 'timelinemaster', desc: 'Sort 3 albums from your library by release year' },
                    { name: 'recap', desc: 'Generate a personalized 30-second video recap' },
                    { name: 'insights', desc: 'Get a deep AI analysis of your musical persona' },
                    { name: 'billboard', desc: 'View top server tracks vs. the previous period' },
                    { name: 'server', desc: 'View aggregate statistics for the current server' },
                ]
            },
            {
                name: '👥 Social & WhoKnows',
                emoji: '👥',
                description: 'See how you compare with friends and the server',
                commands: [
                    { name: 'whoknows', desc: 'Find out who listens to an artist the most in this server' },
                    { name: 'wkt', desc: 'Find out who listens to a track the most in this server' },
                    { name: 'wka', desc: 'Find out who listens to an album the most in this server' },
                    { name: 'gwk', desc: 'View who knows an artist across the entire bot' },
                    { name: 'gwkt', desc: 'View who knows a track across the entire bot' },
                    { name: 'gwka', desc: 'View who knows an album across the entire bot' },
                    { name: 'gwkg', desc: 'View who knows a genre globally' },
                    { name: 'fwk', desc: 'Find out who listens to an artist the most among your friends' },
                    { name: 'fwkt', desc: 'Find out who listens to a track the most among your friends' },
                    { name: 'fwka', desc: 'Find out who listens to an album the most among your friends' },
                    { name: 'crown', desc: 'View the crown status and history for a specific artist' },
                    { name: 'crowns', desc: 'View the artists you have the most plays for in this server' },
                    { name: 'crownboard', desc: 'View the ranking of who has the most crowns in this server' },
                    { name: 'friends', desc: 'Manage your Last.fm friends' },
                    { name: 'songtwin', desc: 'Compare music taste and see your sonic compatibility score' },
                    { name: 'judge', desc: 'Let the AI ruthlessly roast your music taste' },
                ]
            },
            {
                name: '🎮 Games',
                emoji: '🎮',
                description: 'Fun interactive music challenges',
                commands: [
                    { name: 'pixelguess', desc: 'Guess the album cover from a pixelated image 🎨' },
                    { name: 'zoomguess', desc: 'Guess the album from a highly zoomed-in crop 🔍' },
                    { name: 'scramble', desc: 'Identify the album as it slowly un-scrambles 🧩' },
                    { name: 'jumble', desc: 'Unscramble the name of one of your top artists, albums, or tracks' },
                    { name: 'blindguess', desc: 'Play a snippet of one of your top tracks and guess it' },
                    { name: 'chartclash', desc: 'A 1v1 competitive trivia battle — more plays or older? ⚔️' },
                    { name: 'labyrinth', desc: 'Identify the song from a cinematic lyric card 🎤' },
                ]
            },
            {
                name: '🎵 Media & Tools',
                emoji: '🎵',
                description: 'Visuals, lyrics, audio identification and more',
                commands: [
                    { name: 'lyriccard', desc: 'Generate an aesthetic lyric typography card' },
                    { name: 'cover', desc: 'Fetch high-quality album artwork' },
                    { name: 'shazam', desc: 'Identify a song from an audio file or attachment' },
                    { name: 'whatchosong', desc: 'Ask the bot to identify a song you describe' },
                    { name: 'radio', desc: 'Get song recommendations based on your current track' },
                    { name: 'samples', desc: 'Discover samples used in a track' },
                    { name: 'trackdetails', desc: 'Show metadata for your current track (BPM, key)' },
                    { name: 'download', desc: 'Download audio for a track' },
                ]
            },
            {
                name: '🎧 Music Player',
                emoji: '🎧',
                description: 'High-fidelity music playback in voice channels',
                commands: [
                    { name: 'play', desc: 'Play a YouTube video in your voice channel' },
                    { name: 'search', desc: 'Search YouTube and pick a song to play' },
                    { name: 'skip', desc: 'Skip the current track' },
                    { name: 'voteskip', desc: 'Vote to skip the current track' },
                    { name: 'stop', desc: 'Stop music and leave the voice channel' },
                    { name: 'pause', desc: 'Pause the current music playback' },
                    { name: 'resume', desc: 'Resume the paused music playback' },
                    { name: 'queue', desc: 'Display the current music queue' },
                    { name: 'shuffle', desc: 'Shuffle the current music queue' },
                    { name: 'repeat', desc: 'Toggle repeat mode (Off, One, All)' },
                    { name: 'volume', desc: 'Set the player volume (0–1000)' },
                    { name: 'seek', desc: 'Jump to a specific time in the current track' },
                    { name: 'jump', desc: 'Jump to a specific position in the queue' },
                    { name: 'move', desc: 'Move a track in the queue' },
                    { name: 'remove', desc: 'Remove a track from the queue' },
                    { name: 'lyrics', desc: 'Get lyrics for the currently playing track' },
                    { name: 'trackinfo', desc: 'Detailed information about the current track' },
                    { name: 'filters', desc: 'Apply audio filters to the current track' },
                    { name: 'autoplay', desc: 'Toggle autoplay — related songs when queue ends' },
                    { name: 'playlist', desc: 'Manage your custom music playlists' },
                ]
            },
            {
                name: '⚡ Shortcuts',
                emoji: '⚡',
                description: 'Quick search and link shortcuts to music services',
                commands: [
                    { name: 'applemusic', desc: 'Search and link directly to Apple Music' },
                    { name: 'deezer', desc: 'Search and link directly to Deezer' },
                    { name: 'discogs', desc: 'Search and view release info on Discogs' },
                    { name: 'youtube', desc: 'Search and link directly to YouTube' },
                ]
            },
            {
                name: '⚙️ Settings & Account',
                emoji: '⚙️',
                description: 'Account management, privacy, and bot configuration',
                commands: [
                    { name: 'login', desc: 'Link your Last.fm account for private stats' },
                    { name: 'logout', desc: 'Unlink your Last.fm account from the bot' },
                    { name: 'remove', desc: 'Delete your account data and disconnect Last.fm' },
                    { name: 'import', desc: 'Manage your data imports' },
                    { name: 'update', desc: 'Update your Last.fm index with your latest scrobbles' },
                    { name: 'settings', desc: 'Configure your personal bot settings' },
                    { name: 'color', desc: 'Set a custom embed color for your bot responses' },
                    { name: 'localization', desc: 'Change your timezone and number format preferences' },
                    { name: 'privacy', desc: 'Manage your Global WhoKnows privacy setting' },
                    { name: 'configuration', desc: 'Manage server-wide bot configuration' },
                    { name: 'outofsync', desc: 'Help if your Last.fm isn\'t up to date with Spotify' },
                    { name: 'botstats', desc: 'View global statistics for the bot' },
                ]
            },
        ];

        const generateMainPayload = () => {
            const builder = new ComponentsV2()
                .setAccent(0x5865F2)
                .addText(`## ✦ her — Command Guide`)
                .addSeparator()
                .addText(`Welcome to **her**, your premium music companion. Select a category below to explore available commands.\n\n> 💡 Slash commands start with \`/\` — prefix commands also work.`);

            const options = categories.map(cat => ({
                label: cat.name.replace(/[^\w\s&]/g, '').trim(),
                value: `help_cat_${cat.name.toLowerCase().replace(/[^\w]/g, '_')}`,
                description: cat.description,
                emoji: { name: cat.emoji }
            }));

            builder.addRow([
                {
                    type: ComponentType.StringSelect,
                    customId: 'help_category_picker',
                    placeholder: 'Choose a category to view commands',
                    options
                }
            ]);

            return builder.build();
        };

        const initialPayload = generateMainPayload();

        let message: any;
        if (isSlash) {
            message = await interactionOrMessage.reply({ ...initialPayload, fetchReply: true });
        } else {
            message = await interactionOrMessage.channel.send(initialPayload);
        }

        const collector = message.createMessageComponentCollector({
            filter: (i: any) => i.user.id === user.id,
            idle: 600000 // 10 minutes of inactivity
        });

        collector.on('collect', async (i: any) => {
            if (i.customId === 'help_back_to_main') {
                await i.update(generateMainPayload());
                return;
            }

            const selectedValue = i.values?.[0];
            const category = categories.find(cat => `help_cat_${cat.name.toLowerCase().replace(/[^\w]/g, '_')}` === selectedValue);

            if (category) {
                const commandList = category.commands.map(cmd => `\`.${cmd.name}\` — ${cmd.desc}`).join('\n');

                const catBuilder = new ComponentsV2()
                    .setAccent(0x5865F2)
                    .addText(`## ${category.name}`)
                    .addSeparator()
                    .addText(`${category.description}\n\n${commandList}`);

                catBuilder.addRow([
                    {
                        type: ComponentType.Button,
                        style: ButtonStyle.Secondary,
                        customId: 'help_back_to_main',
                        label: 'Back',
                        emoji: { name: '⬅️' }
                    }
                ]);

                await i.update(catBuilder.build());
            }
        });
    }
}
