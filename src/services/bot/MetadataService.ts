import { YoutubeResult } from '../api/Youtube';
import { TrackResolverService } from '../api/TrackResolverService';
import { LastFM } from '../api/LastFM';
import { GuildMember } from 'discord.js';

export class MetadataService {
    private static inFlight = new Map<string, Promise<void>>();

    /**
     * Enriches a YoutubeResult with high-res artwork, cleaned names, and Last.fm stats.
     */
    static async enrich(track: YoutubeResult, member: GuildMember | null, dbUser?: any): Promise<void> {
        if ((track as any).isEnriched) return;

        // Deduplicate concurrent calls for the same track
        const key = track.url || track.title;
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key)!;
        }

        const promise = this._doEnrich(track, member, dbUser).finally(() => {
            this.inFlight.delete(key);
        });

        this.inFlight.set(key, promise);
        return promise;
    }

    private static async _doEnrich(track: YoutubeResult, member: GuildMember | null, dbUser?: any): Promise<void> {
        if ((track as any).isEnriched) return;
        
        // Resolve High-Res Artwork and Cleaned Names
        let finalArtist = track.artistName || '';
        let finalTrack = track.trackTitle || '';

        const cleanStr = (s: string) => {
            return s
                .replace(/\(official.*?\)/gi, '')
                .replace(/\[official.*?\]/gi, '')
                .replace(/\(lyric.*?\)/gi, '')
                .replace(/\[lyric.*?\]/gi, '')
                .replace(/\(video.*?\)/gi, '')
                .replace(/\[video.*?\]/gi, '')
                .replace(/\(hd.*?\)/gi, '')
                .replace(/\[hd.*?\]/gi, '')
                .replace(/\(4k.*?\)/gi, '')
                .replace(/\[4k.*?\]/gi, '')
                .replace(/\(feat.*?\)/gi, '')
                .replace(/\[feat.*?\]/gi, '')
                .replace(/\(ft.*?\)/gi, '')
                .replace(/\[ft.*?\]/gi, '')
                .replace(/\(with.*?\)/gi, '')
                .replace(/\[with.*?\]/gi, '')
                .replace(/\(prod.*?\)/gi, '')
                .replace(/\[prod.*?\]/gi, '')
                .replace(/\(.*?\)/g, '')
                .replace(/\[.*?\]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };

        // Helper to aggressively clean query for Spotify search raw
        const cleanForSearch = (title: string): string => {
            let clean = title;
            // Remove all parentheses/brackets and their content
            clean = clean.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '');
            // Remove common English music suffixes
            clean = clean.replace(/\b(official|video|audio|lyric|lyrics|hd|4k|feat|ft|with|prod|music|clip)\b/gi, '');
            // Remove common Arabic music suffixes
            clean = clean.replace(/\b(مهرجان|فيديو|كليب|حصريا|حصري|الاصلي|الاصلية|اغنية|أغنية|توزيع|غناء|بصوت|عزف|اورج)\b/gi, '');
            // Remove years (like 2020-2029)
            clean = clean.replace(/\b20\d{2}\b/g, '');
            // Clean up extra whitespace and characters
            clean = clean.replace(/[-_–—|•]/g, ' ')
                         .replace(/\s+/g, ' ')
                         .trim();
            return clean;
        };

        if (!finalArtist || !finalTrack) {
            try {
                const { Spotify } = await import('../api/Spotify');
                const cleanQuery = cleanForSearch(track.title);
                console.log(`[MetadataService] 🔍 Searching Spotify for clean query: "${cleanQuery}" (Original: "${track.title}")`);
                
                const spotifyMatch = await Spotify.searchRaw(cleanQuery);
                if (spotifyMatch && spotifyMatch.name && spotifyMatch.artist) {
                    // Let's validate the match is actually relevant to the YouTube title
                    const cleanString = (str: string) => {
                        return (str || '')
                            .toLowerCase()
                            .replace(/[^a-z0-9\u0600-\u06FF\s]/g, '') // Keep alphanumeric, Arabic, and spaces
                            .replace(/\s+/g, ' ')
                            .trim();
                    };

                    const cleanTitleNormalized = cleanString(track.title);
                    const cleanArtistNormalized = cleanString(spotifyMatch.artist);
                    const cleanNameNormalized = cleanString(spotifyMatch.name);

                    const artistWords = cleanArtistNormalized.split(' ').filter(w => w.length > 1);
                    const nameWords = cleanNameNormalized.split(' ').filter(w => w.length > 1);

                    const artistOverlap = artistWords.filter(w => cleanTitleNormalized.includes(w)).length;
                    const nameOverlap = nameWords.filter(w => cleanTitleNormalized.includes(w)).length;

                    // We require at least 1 word from the artist and 1 word from the track name to overlap with the YouTube title
                    const hasArtistMatch = artistWords.length === 0 || artistOverlap > 0;
                    const hasNameMatch = nameWords.length === 0 || nameOverlap > 0;

                    if (hasArtistMatch && hasNameMatch && (artistOverlap > 0 || nameOverlap > 0)) {
                        finalArtist = spotifyMatch.artist;
                        finalTrack = spotifyMatch.name;
                        console.log(`[MetadataService] ✅ Accepted Spotify match: "${spotifyMatch.artist} - ${spotifyMatch.name}"`);
                    } else {
                        console.log(`[MetadataService] 🚫 Rejected irrelevant Spotify match: "${spotifyMatch.artist} - ${spotifyMatch.name}" (Artist overlap: ${artistOverlap}/${artistWords.length}, Track overlap: ${nameOverlap}/${nameWords.length})`);
                    }
                }
            } catch (err) {
                // Ignore and fall back
            }
        }

        if (!finalArtist || !finalTrack) {
            const separators = [' - ', ' – ', ' — ', ' | '];
            let found = false;
            
            for (const sep of separators) {
                if (track.title.includes(sep)) {
                    const parts = track.title.split(sep);
                    const part0 = parts[0].trim();
                    const part1 = parts.slice(1).join(sep).trim();
                    
                    const cleanPart = (s: string) => s.toLowerCase().replace(/\s+/g, '');
                    const isPartClean = (s: string) => {
                        const cs = cleanPart(s);
                        return cs.length > 2 && !cs.includes('توزيع') && !cs.includes('prod') && !cs.includes('remix');
                    };

                    // Only perform separation split if it looks like a clean Artist - Track split
                    if (isPartClean(part0) && isPartClean(part1)) {
                        const channelClean = track.channelTitle ? track.channelTitle.toLowerCase().replace(' - topic', '').replace(/\s+/g, '') : '';
                        const channelParts = track.channelTitle 
                            ? track.channelTitle.split(/[-–—|]/).map(p => p.toLowerCase().replace(/\s+/g, '')).filter(p => p.length > 2)
                            : [];
                        
                        const hasChannelMatch = (pClean: string) => {
                            if (!channelClean) return false;
                            if (pClean.includes(channelClean) || channelClean.includes(pClean)) return true;
                            return channelParts.some(cp => pClean.includes(cp) || cp.includes(pClean));
                        };

                        const p0Clean = cleanPart(part0);
                        const p1Clean = cleanPart(part1);

                        if (hasChannelMatch(p1Clean)) {
                            finalArtist = part1;
                            finalTrack = part0;
                        } else {
                            finalArtist = part0;
                            finalTrack = part1;
                        }
                        found = true;
                        break;
                    }
                }
            }
            
            if (!found) {
                finalTrack = track.title;
                finalArtist = track.channelTitle.replace(' - Topic', '');
            }
        }

        // Apply aggressive cleaning to the final track name
        finalTrack = cleanStr(finalTrack);
        finalArtist = finalArtist.trim();

        // ── GLOBAL RESOLUTION (UTR) ──
        const resolved = await TrackResolverService.resolve(finalArtist, finalTrack);
        finalArtist = resolved.artist || finalArtist || '';
        finalTrack = resolved.title || finalTrack || '';
        
        track.artistName = finalArtist;
        track.trackTitle = finalTrack;

        // Overwrite the track URL with the strictly validated UTR links.
        // We prefer Spotify URL if available to leverage native LavaSrc, falling back to YouTube.
        if (resolved.links.spotify) {
            console.log(`[MetadataService] 🔗 Overwriting track URL with strictly validated UTR Spotify link (LavaSrc): ${resolved.links.spotify}`);
            track.url = resolved.links.spotify;
        } else if (resolved.links.youtube) {
            console.log(`[MetadataService] 🔗 Overwriting track URL with strictly validated UTR YouTube link: ${resolved.links.youtube}`);
            track.url = resolved.links.youtube;
        }
        
        // Priority 1: High-res track/album artwork from UTR
        // Priority 2: Artist profile picture (better than YouTube thumbnail)
        track.artworkUrl = resolved.artworkUrl || resolved.artistAvatarUrl || undefined;

        let finalDuration = track.duration;
        if (resolved.durationMs > 0) {
            const totalSeconds = Math.floor(resolved.durationMs / 1000);
            track.durationSeconds = totalSeconds;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            finalDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // Fetch extra stats from Last.fm
        let statsText = '';
        try {
            const lfmInfo = await LastFM.getTrackInfo(finalArtist, finalTrack, dbUser?.lastfmUsername, dbUser?.lastfmSessionKey);
            
            // Priority 3: Last.fm official album art (if UTR failed)
            if (!track.artworkUrl) {
                const lfmImage = lfmInfo?.album?.image?.find((i: any) => i.size === 'extralarge' || i.size === 'large')?.['#text'];
                if (lfmImage && !LastFM.isDefaultImage(lfmImage)) {
                    track.artworkUrl = lfmImage;
                }
            }

            const listeners = lfmInfo?.listeners ? parseInt(lfmInfo.listeners).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }) : null;
            const plays = lfmInfo?.playcount ? parseInt(lfmInfo.playcount).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }) : null;

            const parts = [];
            if (finalDuration) parts.push(finalDuration);
            if (listeners) parts.push(`${listeners} listeners`);
            if (plays) parts.push(`${plays} plays`);
            
            if (parts.length > 0) {
                statsText = `\n${parts.join(' • ')}`;
            }
        } catch (err) {
            if (finalDuration) statsText = `\n${finalDuration}`;
        }

        track.statsText = statsText;
        track.requesterName = member?.user?.displayName || track.requesterName || 'Unknown';
        if (finalDuration) track.duration = finalDuration;
        (track as any).isEnriched = true;
    }
}
