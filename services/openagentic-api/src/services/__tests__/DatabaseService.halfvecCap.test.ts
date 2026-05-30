/**
 * RED→GREEN: DatabaseService.ensureEmbeddingDimensions must cap the
 * ALTER COLUMN dim at HALFVEC_HNSW_MAX_DIM (4000).
 *
 * Scenario: env override EMBEDDING_DIMENSIONS=4096 (qwen3-embedding:8b
 * native). The runtime MUST issue `ALTER … TYPE halfvec(4000)`, NOT
 * `halfvec(4096)`. pgvector caps HNSW indexes on halfvec at 4000d.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the shared prisma client used by DatabaseService BEFORE importing it.
// $queryRaw: pgvector extension version check (must return ≥ 0.7.0).
// $queryRawUnsafe: pg_attribute column type probe (must return an existing halfvec column).
// $executeRawUnsafe: DROP INDEX / UPDATE / ALTER — the SQL we want to capture.
const { executeRawUnsafeSpy } = vi.hoisted(() => ({
  executeRawUnsafeSpy: vi.fn(async (..._args: any[]) => 0),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ extversion: '0.7.0' }]),
    $queryRawUnsafe: vi.fn(async () => [{ full_type: 'halfvec(4096)', udt_name: 'halfvec' }]),
    $executeRawUnsafe: executeRawUnsafeSpy,
  },
}));

// AutoMigrationService is unused by ensureEmbeddingDimensions but imported at module-top.
vi.mock('../AutoMigrationService.js', () => ({
  autoMigrationService: {},
}));

import { DatabaseService } from '../DatabaseService.js';
import { HALFVEC_HNSW_MAX_DIM } from '../halfvecHnswCap.js';

describe('DatabaseService.ensureEmbeddingDimensions HNSW cap wiring', () => {
  const originalEnv = process.env.EMBEDDING_DIMENSIONS;

  beforeEach(() => {
    executeRawUnsafeSpy.mockClear();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.EMBEDDING_DIMENSIONS;
    } else {
      process.env.EMBEDDING_DIMENSIONS = originalEnv;
    }
  });

  it('caps a 4096-d provider down to halfvec(4000) in ALTER COLUMN SQL', async () => {
    process.env.EMBEDDING_DIMENSIONS = '4096';

    await (DatabaseService as any).ensureEmbeddingDimensions();

    // Every ALTER COLUMN call must reference halfvec(4000), not halfvec(4096)
    const alterCalls = executeRawUnsafeSpy.mock.calls
      .map((c) => String(c[0] ?? ''))
      .filter((sql) => /ALTER\s+TABLE/i.test(sql) && /ALTER\s+COLUMN/i.test(sql));

    expect(alterCalls.length).toBeGreaterThan(0);

    for (const sql of alterCalls) {
      expect(sql).toContain(`halfvec(${HALFVEC_HNSW_MAX_DIM})`);
      expect(sql).not.toContain('halfvec(4096)');
    }
  });

  it('passes 1536 (sub-cap) through unchanged in ALTER COLUMN SQL', async () => {
    process.env.EMBEDDING_DIMENSIONS = '1536';

    await (DatabaseService as any).ensureEmbeddingDimensions();

    const alterCalls = executeRawUnsafeSpy.mock.calls
      .map((c) => String(c[0] ?? ''))
      .filter((sql) => /ALTER\s+TABLE/i.test(sql) && /ALTER\s+COLUMN/i.test(sql));

    expect(alterCalls.length).toBeGreaterThan(0);

    for (const sql of alterCalls) {
      expect(sql).toContain('halfvec(1536)');
      expect(sql).not.toContain('halfvec(4000)');
    }
  });
});
