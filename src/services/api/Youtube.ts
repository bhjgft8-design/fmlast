import { google } from 'googleapis';
import YouTubeSR from 'youtube-sr';
import play from 'play-dl';
import { config } from '../../../config';

export interface YoutubeResult {
    title: string;
    url: string;
    id: string;
    thumbnail: string;
    channelTitle: string;
    duration?: string;
    views?: string;
    publishedAt?: string;
    artistName?: string;
    trackTitle?: string;
    artworkUrl?: string;     // For UI rendering
    statsText?: string;      // For UI rendering
    requesterName?: string;  // For UI rendering
}

export class Youtube {
    private static youtube = config.YOUTUBE_API_KEY
        ? google.youtube({ version: 'v3', auth: config.YOUTUBE_API_KEY })
        : null;

    private static quotaExceeded = false;

    /**
     * Search for a music video based on artist and track names.
     */
    static async searchMusicVideo(artist: string, track: string): Promise<YoutubeResult | null> {
        const query = `${artist} - ${track} (Official Music Video)`;
        return this.search(query);
    }

    /**
     * General YouTube search.
     */
    static async search(query: string): Promise<YoutubeResult | null> {
        // 1. Handle direct YouTube URLs
        if (query.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/)) {
            try {
                const videoData = await play.video_info(query);
                const video = videoData.video_details;
                return {
                    title: video.title || 'Unknown Title',
                    url: video.url,
                    id: video.id || '',
                    thumbnail: video.thumbnails[video.thumbnails.length - 1].url,
                    channelTitle: video.channel?.name || 'Unknown Channel',
                    duration: video.durationRaw,
                    views: video.views?.toLocaleString()
                };
            } catch (err) {
                console.error('[Youtube] Direct URL resolution failed:', err);
            }
        }

        // 2. Official API Search
        if (this.youtube && !this.quotaExceeded) {
            try {
                const res = await this.youtube.search.list({
                    part: ['snippet'],
                    q: query,
                    maxResults: 1,
                    type: ['video'],
                });

                const item = res.data.items?.[0];
                if (item && item.id?.videoId) {
                    return {
                        title: item.snippet?.title || 'Unknown Title',
                        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                        id: item.id.videoId,
                        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '',
                        channelTitle: item.snippet?.channelTitle || 'Unknown Channel',
                        publishedAt: item.snippet?.publishedAt || undefined
                    };
                }
            } catch (err: any) {
                if (err.code === 403 && (err.message?.includes('quota') || JSON.stringify(err).includes('quota'))) {
                    this.quotaExceeded = true;
                    console.warn('[Youtube] Data API Quota exceeded. Using youtube-sr fallback for this session.');
                } else {
                    console.error('[Youtube] Official API search failed, falling back to youtube-sr:', err.message || err);
                }
            }
        }

        // 3. Fallback to play-dl search
        try {
            const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
            if (results.length > 0) {
                const video = results[0];
                return {
                    title: video.title || 'Unknown Title',
                    url: video.url,
                    id: video.id || '',
                    thumbnail: video.thumbnails[video.thumbnails.length - 1].url,
                    channelTitle: video.channel?.name || 'Unknown Channel',
                    duration: video.durationRaw,
                    views: video.views?.toLocaleString()
                };
            }
        } catch (err) {
            // play-dl search can fail if YouTube blocks the scraper IP
            console.error('[Youtube] play-dl search failed:', err);
        }

        // 4. Final fallback to youtube-sr
        try {
            const results = await YouTubeSR.search(query, { limit: 1, type: 'video' });
            if (results.length > 0) {
                const video = results[0];
                const url = video.url || `https://www.youtube.com/watch?v=${video.id}`;
                return {
                    title: video.title || 'Unknown Title',
                    url: url,
                    id: video.id || '',
                    thumbnail: video.thumbnail?.url || '',
                    channelTitle: video.channel?.name || 'Unknown Channel',
                    duration: video.durationFormatted,
                    views: video.views ? video.views.toLocaleString() : undefined
                };
            }
        } catch (err) {
            console.error('[Youtube] youtube-sr search failed:', err);
        }

        return null;
    }
}
