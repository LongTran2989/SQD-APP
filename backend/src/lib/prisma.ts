import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Single shared Prisma client + pg connection pool for the whole process.
//
// Previously every controller and service constructed its own `new Pool(...)`
// + `new PrismaClient(...)`. With ~20 modules each opening a pool, the app
// could exhaust Postgres `max_connections` under modest load. Centralising on
// one instance keeps the connection footprint bounded.
//
// The instance is cached on `globalThis` so that any accidental re-import (or a
// dev watch-reload) reuses the same pool rather than leaking a new one.

const globalForPrisma = globalThis as unknown as {
  __pgPool?: Pool;
  __prisma?: PrismaClient;
};

export const pool =
  globalForPrisma.__pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.__prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pgPool = pool;
  globalForPrisma.__prisma = prisma;
}

export default prisma;
