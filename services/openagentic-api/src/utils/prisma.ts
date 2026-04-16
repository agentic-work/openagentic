import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
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
prisma.$on('error' as never, (e: any) => {
  console.error('[Prisma] Connection error:', e?.message || e);
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
