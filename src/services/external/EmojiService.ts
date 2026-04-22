export class EmojiService {
    private static dictionary: Record<string, string> = {
        // Nature & Celestial
        "sun": "☀️", "moon": "🌙", "star": "⭐", "ocean": "🌊", "sea": "🌊",
        "river": "💧", "rain": "🌧️", "storm": "⛈️", "fire": "🔥", "ice": "🧊",
        "snow": "❄️", "sky": "🌌", "cloud": "☁️", "night": "🌃", "day": "☀️",
        "morning": "🌄", "earth": "🌍", "world": "🌎", "flower": "🌹", "rose": "🌹",
        "tree": "🌳", "leaf": "🍃", "forest": "🌲", "mountain": "🏔️", "desert": "🏜️",
        "wind": "💨", "breeze": "🍃", "thunder": "⚡", "lightning": "⚡",

        // Emotions & Body
        "love": "❤️", "heart": "💖", "hate": "🖤", "cry": "😢", "sad": "😔",
        "happy": "😊", "smile": "🙂", "kiss": "💋", "hug": "🫂", "dream": "💭",
        "soul": "👻", "mind": "🧠", "eye": "👁️", "eyes": "👀", "face": "👤",
        "hand": "✋", "blood": "🩸", "bone": "🦴", "breath": "💨",

        // People & Titles
        "man": "👨", "woman": "👩", "boy": "👦", "girl": "👧", "king": "👑",
        "queen": "👸", "god": "🙏", "angel": "😇", "devil": "😈", "ghost": "👻",
        "baby": "👶", "child": "🧒", "friend": "🤝", "lover": "💏", "lady": "💃",

        // Objects & Tech
        "car": "🚗", "truck": "🚛", "plane": "✈️", "boat": "🚢", "house": "🏠",
        "home": "🏠", "key": "🔑", "door": "🚪", "window": "🪟", "phone": "📱",
        "radio": "📻", "tv": "📺", "clock": "🕒", "time": "⏳", "watch": "⌚",
        "money": "💰", "cash": "💵", "gold": "📀", "diamond": "💎", "ring": "💍",
        "gun": "🔫", "knife": "🔪", "bomb": "💣", "wine": "🍷", "beer": "🍺",
        "coffee": "☕", "tea": "🍵", "cake": "🍰", "candy": "🍬",

        // Abstract & Colors
        "red": "🔴", "blue": "🔵", "green": "🟢", "yellow": "🟡", "black": "⚫",
        "white": "⚪", "purple": "🟣", "pink": "🌸", "dark": "🕶️", "light": "💡",
        "shadow": "👤", "secret": "🤫", "truth": "📢", "lie": "🤥",
        // Time & Light
        "midnight": "🕛🌃", "moonlight": "🌙✨", "sunshine": "☀️✨", "sunset": "🌇",
        "sunrise": "🌅", "forever": "♾️", "always": "♾️", "never": "🚫",

        // States & Emotions
        "broken": "💔", "alone": "👤", "together": "👨‍👩‍👧", "strong": "💪",
        "weak": "🥀", "high": "🆙", "low": "⬇️", "fast": "⚡", "slow": "🐢",
        "hard": "🧱", "soft": "☁️", "sweet": "🍬", "bitter": "🍋", "toxic": "☣️",
        "wild": "🦓", "crazy": "🌀", "dangerous": "⚠️",

        // Actions
        "run": "🏃", "walk": "🚶", "jump": "🦘", "fly": "✈️", "swim": "🏊",
        "dance": "💃", "sing": "🎤", "sleep": "😴", "wait": "⏳", "stop": "🛑",
        "go": "🟢", "come": "🔙", "stay": "🏠", "leave": "🚪", "lost": "🗺️",
        "found": "🔍"
    };

    /** Stop words that should be ignored or handled specially */
    private static stopWords = new Set(["the", "a", "an", "is", "for", "with", "and", "or", "in", "at", "to", "of", "from"]);

    /**
     * Translate a track title into a cryptic emoji riddle.
     */
    static translate(text: string): string {
        const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
        const words = clean.split(/\s+/);
        const result: string[] = [];

        for (const word of words) {
            if (this.stopWords.has(word)) continue;

            // Direct match
            if (this.dictionary[word]) {
                result.push(this.dictionary[word]);
                continue;
            }

            // Plural/Suffix check
            const singular = word.endsWith("s") ? word.slice(0, -1) : word;
            if (this.dictionary[singular]) {
                result.push(this.dictionary[singular]);
                continue;
            }

            // Word contains keyword?
            const match = Object.keys(this.dictionary).find(key => word.includes(key) && key.length > 3);
            if (match) {
                result.push(this.dictionary[match]);
                continue;
            }

            // Fallback for numbers
            if (!isNaN(parseInt(word))) {
                result.push(this.numberToEmoji(word));
                continue;
            }
        }

        // If result is too short, add some "vibe" emojis
        if (result.length === 0) {
            return "❓🎵❓";
        }

        return result.join(" ");
    }

    private static numberToEmoji(num: string): string {
        const map: Record<string, string> = {
            "0": "0️⃣", "1": "1️⃣", "2": "2️⃣", "3": "3️⃣", "4": "4️⃣",
            "5": "5️⃣", "6": "6️⃣", "7": "7️⃣", "8": "8️⃣", "9": "9️⃣"
        };
        return num.split("").map(char => map[char] || char).join("");
    }
}
