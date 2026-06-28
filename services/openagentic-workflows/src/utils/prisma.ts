import { PrismaClient } from '@prisma/client';
import { applyTenantExtension } from './tenantPrismaExtension.js';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const baseClient = globalForPrisma.prisma || new PrismaClient({
  log: ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = baseClient;

// Theme A / S1-1: wrap the client with the tenant-injection extension.
export const prisma = applyTenantExtension(baseClient);

export default prisma;
