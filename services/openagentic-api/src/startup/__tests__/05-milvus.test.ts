/**
 * Step 05 — milvus-init
 * RED-first: step file does not exist yet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// vi.mock factories are hoisted above top-level const declarations, so the
// mock vars must be created inside vi.hoisted() to be referenceable there.
const { mockCheckHealth, MockMilvusClient } = vi.hoisted(() => {
  const mockCheckHealth = vi.fn().mockResolvedValue({ isHealthy: true });
  const MockMilvusClient = vi.fn().mockImplementation(() => ({
    checkHealth: mockCheckHealth,
  }));
  return { mockCheckHealth, MockMilvusClient };
});

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: MockMilvusClient,
}));

vi.mock('../../services/MilvusVectorService.js', () => ({
  MilvusVectorService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_MILVUS } from '../05-milvus.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx() {
  return new AppContext({ prisma: {} as any, logger: {} as any });
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('INIT_MILVUS step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=true', () => {
    expect(INIT_MILVUS.name).toBe('milvus-init');
    expect(INIT_MILVUS.critical).toBe(true);
  });

  it('sets ctx.milvusClient after successful connection', async () => {
    const ctx = makeCtx();
    await INIT_MILVUS.run(stubDeps(ctx));
    expect(ctx.milvusClient).toBeDefined();
  });

  it('propagates error after all retries fail (critical)', async () => {
    // Fail first 9 attempts, fail the 10th as well — all rejected.
    // Replace setTimeout with a no-op so the retry loop runs instantly.
    const origSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _delay: number) => {
      fn();
      return 0 as any;
    };
    mockCheckHealth.mockRejectedValue(new Error('milvus down'));
    const ctx = makeCtx();
    await expect(INIT_MILVUS.run(stubDeps(ctx))).rejects.toThrow();
    (globalThis as any).setTimeout = origSetTimeout;
  }, 15000);
});
