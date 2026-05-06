import { PuppeteerService } from '../external/PuppeteerService';
import { AlbumRarity } from './AlbumGameService';
import { Spotify } from '../api/Spotify';

export class AlbumRenderService {
    /**
     * Renders a premium album card with a cello-wrap effect.
     */
    static async renderAlbumCard(data: {
        artistName: string;
        albumName?: string;
        image: string;
        rarity: AlbumRarity;
        variant?: string;
        polishLevel?: number;
    }): Promise<Buffer> {
        const barcodeBars = Array.from({ length: 40 }, () =>
            Math.floor(Math.random() * 16) + 8
        );

        let artistImage: string | null = null;
        try {
            artistImage = await Spotify.getArtistCover(data.artistName);
        } catch { }

        return await PuppeteerService.render('album_card', {
            ...data,
            rarityColor: this.getRarityColor(data.rarity),
            rarityLabel: data.rarity,
            rarityIcon: this.getRarityIcon(data.rarity),
            artistImage: artistImage || null,
            barcodeBars,
            variant: data.variant || 'NORMAL',
            polishLevel: data.polishLevel || 0,
        }, { width: 1080, height: 1080 });
    }

    /**
     * Renders a standalone album variant (full art with effects).
     */
    static async renderVariant(data: {
        image: string;
        variant: string;
    }): Promise<Buffer> {
        return await PuppeteerService.render('album_variant', {
            ...data,
        }, { width: 1080, height: 1080 });
    }

    /**
     * Renders a premium album card for the global market.
     */
    static async renderMarketCard(data: {
        artistName: string;
        albumName: string;
        image: string;
        rarity: AlbumRarity;
        isSold?: boolean;
    }): Promise<Buffer> {
        const barcodeBars = Array.from({ length: 40 }, () =>
            Math.floor(Math.random() * 16) + 8
        );

        let artistImage: string | null = null;
        try {
            artistImage = await Spotify.getArtistCover(data.artistName);
        } catch { }

        return await PuppeteerService.render('market_card', {
            ...data,
            rarityColor: this.getRarityColor(data.rarity),
            rarityLabel: data.rarity,
            rarityIcon: this.getRarityIcon(data.rarity),
            artistImage: artistImage || null,
            barcodeBars,
            isSold: data.isSold || false,
        }, { width: 1080, height: 1080 });
    }

    private static getRarityColor(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '#FFD700';
            case AlbumRarity.EPIC:      return '#A335EE';
            case AlbumRarity.RARE:      return '#0070DD';
            default:                    return '#AAAAAA';
        }
    }

    private static getRarityIcon(rarity: AlbumRarity): string {
        switch (rarity) {
            case AlbumRarity.LEGENDARY: return '🌟';
            case AlbumRarity.EPIC:      return '💎';
            case AlbumRarity.RARE:      return '🔵';
            default:                    return '⚪';
        }
    }
}
