/**
 * Harness-only vitest setup.
 *
 * Wires:
 *   1. process.env defaults (so config/secrets parsing doesn't blow up at
 *      module load).
 *   2. prisma mock — the harness exercises executors, NOT persistence.
 *      Every workflow-table call returns undefined / no-op so the engine's
 *      bookkeeping branches don't trip on a missing DB.
 *   3. logger mock — silence pino so harness output stays clean.
 *   4. MSW server lifecycle — see msw-setup.ts.
 *
 * Node primitive tests should never have to repeat this scaffolding.
 */

import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.WORKFLOW_SECRET_KEY = process.env.WORKFLOW_SECRET_KEY || 'test-master-key-32-bytes-padding!';
process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-internal-secret';

// Mock prisma at the workflows-svc shim so executor / engine bookkeeping
// doesn't require a live database. Per-table mocks are held in a shared
// cache so tests can override behaviour with:
//
//   import { prisma } from '<setup-relative-path>';
//   vi.mocked(prisma.workflow.findUnique).mockResolvedValue({ ... });
//
// Each table is created lazily on first access and persists across the
// test file. Tests that touch the same table should `mockReset()` in
// `beforeEach` or rely on `mockResolvedValue(...)` overwriting.
vi.mock('../../src/utils/prisma.js', () => {
  const tableCache = new Map<string, Record<string, any>>();
  const makeTable = () => ({
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (typeof prop !== 'string') return undefined;
          let table = tableCache.get(prop);
          if (!table) {
            table = makeTable();
            tableCache.set(prop, table);
          }
          return table;
        },
      },
    ),
  };
});

// Silence the pino loggers — node primitives log noisily on info/debug.
vi.mock('../../src/utils/logger.js', () => {
  const child = vi.fn();
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: child,
  };
  child.mockReturnValue(stub);
  return {
    loggers: { services: stub, server: stub, auth: stub, http: stub, db: stub, queue: stub },
    default: stub,
  };
});

// MSW node server — listen / reset / close hooks.
import './mocks/msw-setup.js';
