/**
 * Utility to clean track and album titles for better API matching.
 * Removes common junk like "(Remastered)", "[Deluxe]", etc.
 */
export class TitleCleaner {
    private static JUNK_PATTERNS = [
        /\s*-\s*remaster(?:ed)?(?:\s+\d+)?/gi,
        /\s*\((?:remaster(?:ed)?|deluxe|expanded|anniversary|bonus|special|standard|limited|explicit)(?:\s+edition|version|track)?\)/gi,
        /\s*\[(?:remaster(?:ed)?|deluxe|expanded|anniversary|bonus|special|standard|limited|explicit)(?:\s+edition|version|track)?\]/gi,
        /\s*\(\d{4}\s+remaster\)/gi,
        /\s*\[\d{4}\s+remaster\]/gi,
        /\s*\d{4}\s+remastered\s+version/gi,
        /\s*-\s*\d{4}\s+remaster/gi,
    ];

    /**
     * Cleans an album name by removing common descriptive suffixes.
     * Example: "Nevermind (Remastered)" -> "Nevermind"
     */
    static cleanAlbumName(name: string): string {
        if (!name) return '';
        let cleaned = name;
        for (const pattern of this.JUNK_PATTERNS) {
            cleaned = cleaned.replace(pattern, '');
        }
        return cleaned.trim() || name;
    }

    /**
     * Cleans a track name.
     */
    static cleanTrackName(name: string): string {
        return this.cleanAlbumName(name); // Similar logic for tracks
    }
}
