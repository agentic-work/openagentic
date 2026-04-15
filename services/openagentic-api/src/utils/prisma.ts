/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
