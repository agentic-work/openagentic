import { PrismaClient } from '@prisma/client';
import { applyTenantExtension } from './tenantPrismaExtension.js';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const baseClient = globalForPrisma.prisma || new PrismaClient({
  // Emit query events so subscribers (e.g. ChatStorageService slow-query logger)
  // can listen via prisma.$on('query', ...). Errors/warns still go to stdout.
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
  // Connection resilience: retry transient connection failures
  datasourceUrl: process.env.DATABASE_URL,
});

// Log connection events for observability
baseClient.$on('error' as never, (e: any) => {
  console.error('[Prisma] Connection error:', e?.message || e);
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient;

// The global `prisma` export stays as the raw PrismaClient so that the
// existing 40+ callers using prisma.$queryRaw / $executeRaw / $on /
// $transaction keep working. Prisma's $extends() returns a proxy that
// strips those top-level $-methods, so wrapping globally caused
// "this.prisma.$on is not a function" at server startup.
//
// The tenant-injection extension (Theme A / S1-1) is still available
// via `applyTenantExtension(baseClient)` — services that want
// AsyncLocalStorage-scoped tenant filtering should opt-in by importing
// `prismaTenant` below and using it for model queries.
export const prisma = baseClient;
export const prismaBase = baseClient;
export const prismaTenant = applyTenantExtension(baseClient);

export default prisma;
