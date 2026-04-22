import { prisma } from '../../database/client';

export class FriendService {
    /** Send a friend request */
    static async sendRequest(authorDiscordId: string, targetDiscordId: string) {
        if (authorDiscordId === targetDiscordId) throw new Error("You cannot add yourself as a friend.");

        const author = await prisma.user.findUnique({ where: { discordId: authorDiscordId } });
        const target = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });

        if (!author) throw new Error("You are not registered.");
        if (!target) throw new Error("The target user is not registered with the bot.");

        // Check if there is already an existing relationship in either direction
        const existingA = await prisma.friend.findUnique({ where: { userId_friendId: { userId: author.id, friendId: target.id } } });
        const existingB = await prisma.friend.findUnique({ where: { userId_friendId: { userId: target.id, friendId: author.id } } });

        if (existingA || existingB) {
            const status = existingA?.status || existingB?.status;
            if (status === 'ACCEPTED') throw new Error("You are already friends with this user.");
            if (status === 'PENDING') throw new Error("There is already a pending friend request between you and this user.");
        }

        // Create pending request
        return await prisma.friend.create({
            data: {
                userId: author.id,
                friendId: target.id,
                status: 'PENDING'
            }
        });
    }

    /** Accept a friend request */
    static async acceptRequest(authorDiscordId: string, targetDiscordId: string) {
        const author = await prisma.user.findUnique({ where: { discordId: authorDiscordId } });
        const target = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });

        if (!author || !target) throw new Error("User not found.");

        // The request was sent BY target TO author
        const request = await prisma.friend.findUnique({ where: { userId_friendId: { userId: target.id, friendId: author.id } } });
        
        if (!request) {
            // Check reverse order just in case
            const reqRev = await prisma.friend.findUnique({ where: { userId_friendId: { userId: author.id, friendId: target.id } } });
            if (reqRev) {
                return await prisma.friend.update({
                    where: { id: reqRev.id },
                    data: { status: 'ACCEPTED' }
                });
            }
            throw new Error("Friend request not found.");
        }

        return await prisma.friend.update({
            where: { id: request.id },
            data: { status: 'ACCEPTED' }
        });
    }

    /** Remove or deny a friend/request */
    static async removeFriend(authorDiscordId: string, targetDiscordId: string) {
        const author = await prisma.user.findUnique({ where: { discordId: authorDiscordId } });
        const target = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });

        if (!author || !target) throw new Error("User not found.");

        const existingA = await prisma.friend.findUnique({ where: { userId_friendId: { userId: author.id, friendId: target.id } } });
        const existingB = await prisma.friend.findUnique({ where: { userId_friendId: { userId: target.id, friendId: author.id } } });

        if (existingA) await prisma.friend.delete({ where: { id: existingA.id } });
        if (existingB) await prisma.friend.delete({ where: { id: existingB.id } });
        
        return true;
    }

    /** Get all accepted friends for a user */
    static async getFriends(discordId: string) {
        const user = await prisma.user.findUnique({ where: { discordId } });
        if (!user) return [];

        const friendsData = await prisma.friend.findMany({
            where: {
                OR: [
                    { userId: user.id, status: 'ACCEPTED' },
                    { friendId: user.id, status: 'ACCEPTED' }
                ]
            },
            include: {
                user: true,
                friend: true
            }
        });

        // Map to return just the friend's User object
        return friendsData.map((f: any) => f.userId === user.id ? f.friend : f.user);
    }

    /** Calculate Taste Affinity between two users */
    static async getTasteAffinity(u1DiscordId: string, u2DiscordId: string) {
        const u1 = await prisma.user.findUnique({ where: { discordId: u1DiscordId } });
        const u2 = await prisma.user.findUnique({ where: { discordId: u2DiscordId } });

        if (!u1 || !u2) throw new Error("One or both users are not registered.");

        // Grab top 100 artists for both users
        const u1Artists = await prisma.userArtist.findMany({ where: { userId: u1.id }, orderBy: { playcount: 'desc' }, take: 150 });
        const u2Artists = await prisma.userArtist.findMany({ where: { userId: u2.id }, orderBy: { playcount: 'desc' }, take: 150 });

        const u1Map = new Map(u1Artists.map((a, index) => [a.artistName.toLowerCase(), { playcount: a.playcount, rank: index + 1, name: a.artistName }]));
        
        type SharedArtist = { name: string, rank1: number, rank2: number, score: number };
        const shared: SharedArtist[] = [];

        let scoreMatch = 0;
        
        u2Artists.forEach((a2, index) => {
            const artistLower = a2.artistName.toLowerCase();
            if (u1Map.has(artistLower)) {
                const a1 = u1Map.get(artistLower)!;
                const rank2 = index + 1;
                
                // Score based on position in top 150
                // Rank 1 = ~150 points, Rank 150 = 1 point
                const a1Score = Math.max(1, 151 - a1.rank);
                const a2Score = Math.max(1, 151 - rank2);
                
                // Multiplier for closeness in rank
                const rankDiff = Math.abs(a1.rank - rank2);
                const closenessMult = Math.max(0.2, 1 - (rankDiff / 100)); // The closer the rank, the higher the multiplier

                const matchPoints = ((a1Score + a2Score) / 2) * closenessMult;
                scoreMatch += matchPoints;
                
                shared.push({
                    name: a1.name, // preserve correct caps from user1
                    rank1: a1.rank,
                    rank2: rank2,
                    score: matchPoints
                });
            }
        });

        // Max possible score if identical top 150
        let maxPossible = 0;
        for (let i = 1; i <= 150; i++) {
            maxPossible += (151 - i);
        }

        // Percentage affinity
        const rawPercent = (scoreMatch / maxPossible) * 100;
        
        // Boost factor: If you share even a few artists in the absolute top, bump the score
        // We'll normalize the score up linearly since true matching on all 150 is virtually impossible
        let boostedPercent = rawPercent * 2.5; 
        if (boostedPercent > 99) boostedPercent = 99; // Cap at 99 unless literal clone
        if (shared.length === 150 && rawPercent > 90) boostedPercent = 100;
        if (shared.length === 0) boostedPercent = 0;
        
        return {
            percent: Math.round(boostedPercent),
            sharedArtists: shared.sort((a, b) => b.score - a.score),
            u1Name: u1.lastfmUsername || 'Unknown',
            u2Name: u2.lastfmUsername || 'Unknown'
        };
    }
}
