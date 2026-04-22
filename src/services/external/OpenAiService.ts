import OpenAI from 'openai';
import { config } from '../../../config';

export class OpenAiService {
    private static instance: OpenAiService;
    private client: OpenAI | null = null;

    private constructor() {
        const apiKey = config.GROQ_API_KEY || config.OPENAI_API_KEY;
        if (apiKey) {
            this.client = new OpenAI({
                apiKey: apiKey,
                baseURL: config.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined
            });
        }
    }

    public static getInstance(): OpenAiService {
        if (!OpenAiService.instance) {
            OpenAiService.instance = new OpenAiService();
        }
        return OpenAiService.instance;
    }

    /**
     * Generates a short, witty, sarcastic vibe summary for the Aura command.
     */
    public async generateAuraSummary(artists: string[], genres: string[]): Promise<string> {
        if (!this.client) return "AI insights are unavailable (missing API key).";

        try {
            const artistList = artists.join(', ');
            const genreList = genres.join(', ');

            const response = await this.client.chat.completions.create({
                model: config.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a witty, sarcastic, and slightly elitist music critic. 
                        Your job is to roast or deeply analyze a user's music taste based on their top artists and genres. 
                        Keep it to 1 or 2 sentences max. Be sharp, funny, and specific. 
                        Don't be purely mean, but definitely judge them a little. 
                        Avoid generic praise like "Great taste!".`
                    },
                    {
                        role: 'user',
                        content: `Analyze this musical aura: 
                        Top Artists: ${artistList}
                        Dominant Genres: ${genreList}`
                    }
                ],
                max_tokens: 100,
                temperature: 0.8
            });

            return response.choices[0]?.message?.content || "Your music taste is too chaotic for even an AI to judge.";
        } catch (error) {
            console.error('[AI Service] Error generating aura summary:', error);
            return "The AI looked at your library and had a mental breakdown.";
        }
    }

    /**
     * Generates a detailed, funny persona analysis for the Insights command.
     */
    public async generateDetailedPersona(topArtists: string[], topTracks: string[], period: string): Promise<string> {
        if (!this.client) return "AI insights are unavailable (missing API key).";

        try {
            const artistList = topArtists.join(', ');
            const trackList = topTracks.join(', ');

            const response = await this.client.chat.completions.create({
                model: config.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a witty, sarcastic music critic writing a personality profile for a user. 
                        Based on their top artists and tracks for a specific period (${period}), 
                        describe who they are as a person. Be hilarious, a bit judgy, and use music-related metaphors. 
                        Format: a paragraph of ~4 sentences. Use a premium, sharp tone.`
                    },
                    {
                        role: 'user',
                        content: `Top Artists: ${artistList}
                        Top Tracks: ${trackList}`
                    }
                ],
                max_tokens: 300,
                temperature: 0.9
            });

            return response.choices[0]?.message?.content || "You listen to music. That is the only insight we found.";
        } catch (error) {
            console.error('[AI Service] Error generating detailed persona:', error);
            return "The AI was so overwhelmed by your mid taste it refused to comment.";
        }
    }
}
