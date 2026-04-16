// Type extensions for Prisma client to fix compilation
import { PrismaClient } from '@prisma/client';

declare module '@prisma/client' {
  interface PrismaClient {
    userQueryAudit: {
      create: (args: any) => Promise<any>;
      findMany: (args: any) => Promise<any>;
      count: (args: any) => Promise<number>;
      groupBy: (args: any) => Promise<any>;
      aggregate: (args: any) => Promise<any>;
    };
  }
}