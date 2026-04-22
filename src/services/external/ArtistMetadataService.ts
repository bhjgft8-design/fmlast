/**
 * Centralized service to manage artist-specific metadata overrides.
 * This ensures that artists with common names (like "zaf") always resolve to the correct
 * profiles on Spotify, Apple Music, and Genius.
 */
export class ArtistMetadataService {
    private static overrides: Record<string, {
        spotifyId?: string;
        appleMusicId?: string;
        geniusId?: number;
        disableDeezer?: boolean;
        trackOverrides?: Record<string, {
            spotifyId?: string;
            appleMusicId?: string;
            geniusId?: number;
        }>;
    }> = {
        'zaf': {
            spotifyId: '5ECY1H5jJxfx7gEukvOAsU',
            appleMusicId: '1793783460',
            geniusId: 4440630,
            disableDeezer: true
        }
    };

    /** Get the override data for an artist name */
    static getOverride(artistName: string) {
        return this.overrides[artistName.toLowerCase().trim()];
    }

    /** Check if an artist has any overrides */
    static hasOverride(artistName: string): boolean {
        return !!this.getOverride(artistName);
    }

    /** Get Spotify Artist ID for an artist */
    static getSpotifyId(artistName: string): string | null {
        return this.getOverride(artistName)?.spotifyId || null;
    }

    /** Get Genius Artist ID for an artist */
    static getGeniusArtistId(artistName: string): number | null {
        return this.getOverride(artistName)?.geniusId || null;
    }

    /** Get Genius Song ID for a specific track */
    static getGeniusTrackId(artistName: string, trackName: string): number | null {
        const artist = this.getOverride(artistName);
        if (artist?.trackOverrides && trackName) {
            const cleanTrack = trackName.toLowerCase().trim();
            if (artist.trackOverrides[cleanTrack]) {
                return artist.trackOverrides[cleanTrack].geniusId || null;
            }
        }
        return null;
    }

    /** Get Apple Music Artist ID for an artist */
    static getAppleMusicId(artistName: string): string | null {
        return this.getOverride(artistName)?.appleMusicId || null;
    }

    /** Check if Deezer is disabled for an artist */
    static isDeezerDisabled(artistName: string): boolean {
        return !!this.getOverride(artistName)?.disableDeezer;
    }
}
