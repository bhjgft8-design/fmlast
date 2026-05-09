import { PuppeteerService } from '../external/PuppeteerService';
import { prisma } from '../../database/client';
import fs from 'fs';
import path from 'path';
import { TrackResolverService } from '../api/TrackResolverService';

export interface ShowcaseData {
    username: string;
    avatarUrl: string;
    nowPlaying: {
        artist: string;
        track: string;
        image: string;
    } | null;
    vinylScraps: number;
    crowns: number;
    topCards: {
        artistName: string;
        albumName: string;
        image: string;
        rarity: string;
        variant: string;
        masteryXp: number;
    }[];
}

export class ShowcaseRenderService {
    /**
     * Renders a 1200x600 showcase banner.
     */
    static async renderShowcase(data: ShowcaseData): Promise<Buffer> {
        // Pre-process data for handlebars template
        const bgPattern = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`;

        const processedData = {
            ...data,
            bgPattern,
            vinylScrapsStr: data.vinylScraps.toLocaleString(),
            crownsStr: data.crowns.toLocaleString(),
            hasCards: data.topCards.length > 0,
            processedCards: data.topCards.map(c => {
                let cardClass = 'card';
                if (c.variant === 'HOLOGRAPHIC') cardClass += ' holo';
                if (c.variant === 'ERROR') cardClass += ' error';
                if (c.variant === 'GLITCH') cardClass += ' glitch';
                if (c.variant === 'DIAMOND') cardClass += ' diamond';

                let rarityColor = '#fff';
                if (c.rarity === 'RARE') rarityColor = '#0070DD';
                if (c.rarity === 'EPIC') rarityColor = '#A335EE';
                if (c.rarity === 'LEGENDARY') rarityColor = '#FFD700';

                return { 
                    ...c, 
                    cardClass, 
                    rarityColor,
                    variantLower: c.variant.toLowerCase() 
                };
            })
        };

        return await PuppeteerService.render('showcase', processedData, { width: 1200, height: 600 });
    }
}
