export class GameManager {
    private static activeGames = new Set<string>(); // Set of channel IDs

    static isGameActive(channelId: string): boolean {
        return this.activeGames.has(channelId);
    }

    static startGame(channelId: string): void {
        this.activeGames.add(channelId);
    }

    static endGame(channelId: string): void {
        this.activeGames.delete(channelId);
    }
}
