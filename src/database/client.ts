import "dotenv/config"; // makes sure .env is loaded
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error('DATABASE_URL is not defined in .env');
}

// Export pool for high-performance raw bulk inserts (bypasses Prisma overhead)
export const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
    adapter,
    log: ['error', 'warn'], // removed 'query' so it stops spamming the console
});
