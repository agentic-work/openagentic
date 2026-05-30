/**
 * DatabaseService.probeIndexValid — startup hardening regression test
 *
 * Live failure (2026-05-04, fresh-DB cold-boot, post-AIF bootstrap):
 *
 *   prisma:error
 *   Invalid `prisma.$queryRawUnsafe()` invocation:
 *   Raw query failed. Code: `42P01`.
 *   Message: `relation "admin.prompt_templates_embedding_idx" does not exist`
 *
 * Root cause at services/DatabaseService.ts:493-496 (pre-fix):
 *
 *     const idxCheck = await prisma.$queryRawUnsafe(`
 *       SELECT indisvalid FROM pg_index
 *       WHERE indexrelid = ($1 || '.' || $2)::regclass
 *     `, schema, idx).catch(() => []);
 *
 * The `::regclass` cast THROWS 42P01 ("undefined_table") at the
 * Postgres layer when the index doesn't exist on a fresh DB. The
 * JS-level `.catch(() => [])` swallows the rejection at the JS boundary,
 * but Prisma's global event logger has already emitted "Connection error"
 * + a multi-line stack trace before the rejection reaches our catch.
 * That noise is what the user sees on every cold boot until embedding
 * indexes are populated.
 *
 * The fix: query `pg_class` joined to `pg_namespace` joined to `pg_index`
 * by NAME (not by regclass-resolved oid), which returns 0 rows for a
 * missing index instead of throwing. No more spurious error logs.
 *
 * This test pins both the behavior (returns false on missing index)
 * AND the SQL shape (must NOT contain `::regclass` for the index probe).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma singleton BEFORE importing DatabaseService.
const mockQueryRawUnsafe = vi.fn();
const mockExecuteRawUnsafe = vi.fn();

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    $executeRawUnsafe: mockExecuteRawUnsafe,
  },
}));

const { DatabaseService } = await import('../DatabaseService.js');

describe('DatabaseService.probeIndexValid', () => {
  beforeEach(() => {
    mockQueryRawUnsafe.mockReset();
    mockExecuteRawUnsafe.mockReset();
  });

  it('returns false when the index does not exist (no throw, empty result)', async () => {
    // pg_class/pg_index join returns 0 rows when the index is missing.
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    const result = await DatabaseService.probeIndexValid('admin', 'prompt_templates_embedding_idx');

    expect(result).toBe(false);
    expect(mockQueryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('returns true when the index exists and is valid', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ indisvalid: true }]);

    const result = await DatabaseService.probeIndexValid('admin', 'prompt_templates_embedding_idx');

    expect(result).toBe(true);
  });

  it('returns false when the index exists but is invalid (e.g. partial build)', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([{ indisvalid: false }]);

    const result = await DatabaseService.probeIndexValid('admin', 'prompt_templates_embedding_idx');

    expect(result).toBe(false);
  });

  it('SQL must NOT use ::regclass cast (which throws 42P01 on missing indexes)', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await DatabaseService.probeIndexValid('admin', 'prompt_templates_embedding_idx');

    const calledWithSql = mockQueryRawUnsafe.mock.calls[0][0] as string;
    // The original implementation cast the schema-qualified name to ::regclass,
    // which raises a SQL-level error before our JS catch can swallow it.
    expect(calledWithSql).not.toMatch(/::regclass/);
    // Must instead resolve the index by name through pg_class, joining
    // pg_namespace (so we filter by schema) and pg_index (for indisvalid).
    expect(calledWithSql).toMatch(/pg_class/);
    expect(calledWithSql).toMatch(/pg_namespace/);
    expect(calledWithSql).toMatch(/pg_index/);
  });

  it('returns false (not throws) when prisma rejects unexpectedly', async () => {
    // Defense in depth: even if the new SQL fails for some other reason
    // (DB unreachable, etc.), the probe must not propagate.
    mockQueryRawUnsafe.mockRejectedValueOnce(new Error('connection refused'));

    const result = await DatabaseService.probeIndexValid('admin', 'prompt_templates_embedding_idx');

    expect(result).toBe(false);
  });
});
