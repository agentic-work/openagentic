/**
 * Tests for RAGInitService.reconcileDocsIngest() — task #157.
 *
 * Covers the four branches of the decision matrix:
 *   1. hashes match               → action === 'skipped', no reingest
 *   2. hashes differ              → action === 'reingested', meta updated
 *   3. platform_docs_meta missing → action === 'reingested', meta created
 *   4. force=true                 → action === 'reingested' regardless
 *
 * Plus first-boot (rowCount==0) and legacy-UI (no _version.json) paths.
 *
 * Strategy: mock the entire ../services/DocsRAGService.js module so the
 * RAGInitService method sees a fake service with recorded call counts.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------
// Module mock — must live BEFORE the imports that use it so vitest's
// hoister catches it.
// ---------------------------------------------------------------------

type FakeDocsRAG = {
  getCollectionStats: ReturnType<typeof vi.fn>;
  fetchVersion: ReturnType<typeof vi.fn>;
  readMilvusMetaHash: ReturnType<typeof vi.fn>;
  writeMilvusMetaHash: ReturnType<typeof vi.fn>;
  ingestDocs: ReturnType<typeof vi.fn>;
};

let fakeDocsRAG: FakeDocsRAG;

vi.mock('../services/DocsRAGService.js', () => ({
  getDocsRAGService: () => fakeDocsRAG,
}));

// Import AFTER the mock so the service picks up the fake.
import { RAGInitService } from '../services/RAGInitService.js';

// Helper — build a fresh fake with sane defaults per test.
function newFake(overrides: Partial<FakeDocsRAG> = {}): FakeDocsRAG {
  return {
    getCollectionStats: vi.fn().mockResolvedValue({ exists: true, rowCount: 100, loaded: true }),
    fetchVersion: vi.fn().mockResolvedValue({
      version: 'v0.6.7-abc1234',
      generatedAt: '2026-04-19T12:00:00.000Z',
      manifestHash: 'sha256:incoming',
      manifestCount: 31,
      manifests: [],
    }),
    readMilvusMetaHash: vi.fn().mockResolvedValue({
      manifestHash: 'sha256:incoming',
      ingestedAt: '2026-04-19T11:00:00.000Z',
      manifestCount: 31,
    }),
    writeMilvusMetaHash: vi.fn().mockResolvedValue(true),
    ingestDocs: vi.fn().mockResolvedValue({ chunksIngested: 312 }),
    ...overrides,
  };
}

describe('RAGInitService.reconcileDocsIngest (task #157)', () => {
  let svc: RAGInitService;

  beforeEach(() => {
    svc = new RAGInitService();
    fakeDocsRAG = newFake();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // Case 1 — hashes match → skip
  // -------------------------------------------------------------------
  test('hashes match -> skipped, ingestDocs NOT called', async () => {
    fakeDocsRAG = newFake({
      readMilvusMetaHash: vi.fn().mockResolvedValue({
        manifestHash: 'sha256:SAME',
        ingestedAt: '2026-04-19T11:00:00.000Z',
        manifestCount: 31,
      }),
      fetchVersion: vi.fn().mockResolvedValue({
        version: 'v0.6.7-abc1234',
        generatedAt: '2026-04-19T12:00:00.000Z',
        manifestHash: 'sha256:SAME',
        manifestCount: 31,
        manifests: [],
      }),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('manifestHash unchanged');
    expect(result.manifestHash).toBe('sha256:SAME');
    expect(fakeDocsRAG.ingestDocs).not.toHaveBeenCalled();
    expect(fakeDocsRAG.writeMilvusMetaHash).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Case 2 — hashes differ → reingest + metadata update
  // -------------------------------------------------------------------
  test('hashes differ -> reingested, meta updated', async () => {
    fakeDocsRAG = newFake({
      readMilvusMetaHash: vi.fn().mockResolvedValue({
        manifestHash: 'sha256:OLD',
        ingestedAt: '2026-04-18T11:00:00.000Z',
        manifestCount: 30,
      }),
      fetchVersion: vi.fn().mockResolvedValue({
        version: 'v0.6.7-xyz',
        generatedAt: '2026-04-19T12:00:00.000Z',
        manifestHash: 'sha256:NEW',
        manifestCount: 31,
        manifests: [],
      }),
      getCollectionStats: vi.fn()
        // before reingest
        .mockResolvedValueOnce({ exists: true, rowCount: 100, loaded: true })
        // after reingest
        .mockResolvedValueOnce({ exists: true, rowCount: 312, loaded: true }),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('reingested');
    expect(result.reason).toBe('manifestHash changed');
    expect(result.manifestHash).toBe('sha256:NEW');
    expect(result.rowsBefore).toBe(100);
    expect(result.rowsAfter).toBe(312);
    expect(fakeDocsRAG.ingestDocs).toHaveBeenCalledTimes(1);
    expect(fakeDocsRAG.writeMilvusMetaHash).toHaveBeenCalledWith({
      manifestHash: 'sha256:NEW',
      manifestCount: 31,
    });
  });

  // -------------------------------------------------------------------
  // Case 3 — metadata collection missing → reingest-as-fresh
  // -------------------------------------------------------------------
  test('platform_docs_meta missing -> reingested, creates meta', async () => {
    fakeDocsRAG = newFake({
      readMilvusMetaHash: vi.fn().mockResolvedValue(null),
      fetchVersion: vi.fn().mockResolvedValue({
        version: 'v0.6.7-xyz',
        generatedAt: '2026-04-19T12:00:00.000Z',
        manifestHash: 'sha256:FRESH',
        manifestCount: 31,
        manifests: [],
      }),
      getCollectionStats: vi.fn()
        .mockResolvedValueOnce({ exists: true, rowCount: 200, loaded: true })
        .mockResolvedValueOnce({ exists: true, rowCount: 312, loaded: true }),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('reingested');
    expect(result.reason).toBe('platform_docs_meta missing');
    expect(result.manifestHash).toBe('sha256:FRESH');
    expect(fakeDocsRAG.ingestDocs).toHaveBeenCalledTimes(1);
    expect(fakeDocsRAG.writeMilvusMetaHash).toHaveBeenCalledWith({
      manifestHash: 'sha256:FRESH',
      manifestCount: 31,
    });
  });

  // -------------------------------------------------------------------
  // Case 4 — force=true → always reingest
  // -------------------------------------------------------------------
  test('force=true -> reingested even when hashes match', async () => {
    fakeDocsRAG = newFake({
      // Matching hashes would normally skip — but force overrides
      readMilvusMetaHash: vi.fn().mockResolvedValue({
        manifestHash: 'sha256:SAME',
        ingestedAt: '2026-04-19T11:00:00.000Z',
        manifestCount: 31,
      }),
      fetchVersion: vi.fn().mockResolvedValue({
        version: 'v0.6.7-abc1234',
        generatedAt: '2026-04-19T12:00:00.000Z',
        manifestHash: 'sha256:SAME',
        manifestCount: 31,
        manifests: [],
      }),
      getCollectionStats: vi.fn()
        .mockResolvedValueOnce({ exists: true, rowCount: 100, loaded: true })
        .mockResolvedValueOnce({ exists: true, rowCount: 312, loaded: true }),
    });

    const result = await svc.reconcileDocsIngest({ force: true });

    expect(result.action).toBe('reingested');
    expect(result.reason).toBe('force=true');
    expect(fakeDocsRAG.ingestDocs).toHaveBeenCalledTimes(1);
    // readMilvusMetaHash should not be consulted when force=true
    expect(fakeDocsRAG.readMilvusMetaHash).not.toHaveBeenCalled();
    expect(fakeDocsRAG.writeMilvusMetaHash).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // First-boot path — rowCount === 0 triggers ingest regardless of hash
  // -------------------------------------------------------------------
  test('rowCount==0 -> first-ingest, meta written if version available', async () => {
    fakeDocsRAG = newFake({
      getCollectionStats: vi.fn()
        .mockResolvedValueOnce({ exists: true, rowCount: 0, loaded: true })
        .mockResolvedValueOnce({ exists: true, rowCount: 312, loaded: true }),
      fetchVersion: vi.fn().mockResolvedValue({
        version: 'v0.6.7-xyz',
        generatedAt: '2026-04-19T12:00:00.000Z',
        manifestHash: 'sha256:BOOT',
        manifestCount: 31,
        manifests: [],
      }),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('first-ingest');
    expect(result.rowsBefore).toBe(0);
    expect(result.rowsAfter).toBe(312);
    expect(result.reason).toBe('collection was empty');
    expect(fakeDocsRAG.ingestDocs).toHaveBeenCalledTimes(1);
    expect(fakeDocsRAG.writeMilvusMetaHash).toHaveBeenCalledWith({
      manifestHash: 'sha256:BOOT',
      manifestCount: 31,
    });
    // Should not have consulted readMilvusMetaHash on the first-ingest path
    expect(fakeDocsRAG.readMilvusMetaHash).not.toHaveBeenCalled();
  });

  test('rowCount==0 + no _version.json -> first-ingest, meta NOT written', async () => {
    fakeDocsRAG = newFake({
      getCollectionStats: vi.fn()
        .mockResolvedValueOnce({ exists: true, rowCount: 0, loaded: true })
        .mockResolvedValueOnce({ exists: true, rowCount: 312, loaded: true }),
      fetchVersion: vi.fn().mockResolvedValue(null),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('first-ingest');
    expect(result.manifestHash).toBeNull();
    expect(fakeDocsRAG.ingestDocs).toHaveBeenCalledTimes(1);
    expect(fakeDocsRAG.writeMilvusMetaHash).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Legacy path — populated collection + no _version.json → skip cleanly
  // (preserves pre-task-#157 behavior for old UI images)
  // -------------------------------------------------------------------
  test('no _version.json on populated collection -> skipped (legacy UI)', async () => {
    fakeDocsRAG = newFake({
      fetchVersion: vi.fn().mockResolvedValue(null),
    });

    const result = await svc.reconcileDocsIngest();

    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('_version.json unavailable');
    expect(result.manifestHash).toBeNull();
    expect(fakeDocsRAG.ingestDocs).not.toHaveBeenCalled();
    expect(fakeDocsRAG.writeMilvusMetaHash).not.toHaveBeenCalled();
    expect(fakeDocsRAG.readMilvusMetaHash).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // durationMs sanity check
  // -------------------------------------------------------------------
  test('durationMs is a non-negative finite number', async () => {
    const result = await svc.reconcileDocsIngest();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.durationMs)).toBe(true);
  });
});
