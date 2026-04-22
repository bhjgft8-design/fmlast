import axios from 'axios';

export interface ArtistMetadata {
    origin: string;
    activeSince: string;
    type: string;
    genres: string[];
}

export class MusicBrainz {
    private static ROOT = 'https://musicbrainz.org/ws/2/';
    private static USER_AGENT = 'MusicBot/1.0.0 ( contact@example.com )'; // MusicBrainz requests a User-Agent

    /**
     * Get artist details from MusicBrainz
     * @param artistName Name of the artist to search
     */
    static async getArtistInfo(artistName: string): Promise<{ origin: string; activeSince: string; type: string } | null> {
        try {
            const url = `${this.ROOT}artist/`;
            const { data } = await axios.get(url, {
                params: {
                    query: `artist:"${artistName}"`,
                    fmt: 'json'
                },
                headers: {
                    'User-Agent': this.USER_AGENT
                }
            });

            const artist = data.artists?.[0];
            if (!artist) return null;

            return {
                origin: artist.area?.name || artist['begin-area']?.name || 'Unknown',
                activeSince: artist['life-span']?.begin || 'Unknown',
                type: artist.type || 'Artist'
            };
        } catch (err) {
            console.error('[MusicBrainz] Error fetching artist info:', err);
            return null;
        }
    }
}
