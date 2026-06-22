/**
 * memory_search — extend the read path to ALSO query Milvus semantic memory
 * (#1085 commit 2/3).
 *
 * Today's contract: `executeMemorySearch` calls `deps.recall` (substring on
 * `agentMemory` Postgres table). After commit 1, sidecar emits land in the
 * user's `user_${id}_memory` Milvus collection — but `memory_search` never
 * queries it, so the model can't retrieve any of those memories.
 *
 * Fix: add optional `deps.semanticRecall(userId, query, limit)`. When wired,
 * `executeMemorySearch` runs BOTH recalls in parallel and merges hits.
 * Substring hits keyed by `key`; semantic hits keyed by `entity_name`.
 * Duplicates collapsed (substring wins — same SoT). Empty Milvus result is
 * NOT an error.
 *
 * Trust: `semanticRecall` MUST receive the same `userId` that `recall` does.
 * No cross-user leak.
 */

import { describe, test, expect, vi } from 'vitest';
import { executeMemorySearch } from '../MemorySearchTool.js';

const SILENT: any = { warn: () => {} };

describe('memory_search semantic merge (#1085)', () => {
  test('calls BOTH recall (substring) AND semanticRecall (Milvus) when both wired', async () => {
    const recall = vi.fn().mockResolvedValue([
      { id: 'm1', category: 'user', key: 'preferred_cloud', value: 'aws', confidence: 0.9 },
    ]);
    const semanticRecall = vi.fn().mockResolvedValue([
      {
        id: 's1',
        category: 'session_summary',
        key: 'Session 2026-05-24 chat',
        value: 'User asked about Azure RGs',
        confidence: 0.82,
      },
    ]);

    const out = await executeMemorySearch(
      { userId: 'u-1', logger: SILENT },
      { query: 'azure' },
      { recall, semanticRecall },
    );

    expect(recall).toHaveBeenCalledOnce();
    expect(semanticRecall).toHaveBeenCalledOnce();
    expect(recall.mock.calls[0][0]).toBe('u-1');
    expect(semanticRecall.mock.calls[0][0]).toBe('u-1');
    expect(out.ok).toBe(true);
    expect(out.output!.memories.length).toBe(2);
    const keys = out.output!.memories.map((m) => m.key);
    expect(keys).toContain('preferred_cloud');
    expect(keys).toContain('Session 2026-05-24 chat');
  });

  test('returns substring-only results when semanticRecall is absent (back-compat)', async () => {
    const recall = vi.fn().mockResolvedValue([
      { id: 'm1', category: 'user', key: 'project', value: 'agentic', confidence: 1 },
    ]);
    const out = await executeMemorySearch(
      { userId: 'u-1', logger: SILENT },
      { query: 'project' },
      { recall },
    );
    expect(out.ok).toBe(true);
    expect(out.output!.memories.length).toBe(1);
    expect(out.output!.memories[0].key).toBe('project');
  });

  test('does NOT throw when semanticRecall fails — returns substring hits + logs warn', async () => {
    const warn = vi.fn();
    const recall = vi.fn().mockResolvedValue([
      { id: 'm1', category: 'user', key: 'k1', value: 'v1', confidence: 1 },
    ]);
    const semanticRecall = vi.fn().mockRejectedValue(new Error('milvus down'));

    const out = await executeMemorySearch(
      { userId: 'u-1', logger: { warn } },
      { query: 'x' },
      { recall, semanticRecall },
    );

    expect(out.ok).toBe(true);
    expect(out.output!.memories.length).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  test('deduplicates: substring hit with same key wins over semantic hit', async () => {
    const recall = vi.fn().mockResolvedValue([
      { id: 'pg1', category: 'user', key: 'preferred_cloud', value: 'aws', confidence: 1 },
    ]);
    const semanticRecall = vi.fn().mockResolvedValue([
      { id: 'mv1', category: 'entity_fact', key: 'preferred_cloud', value: 'gcp', confidence: 0.7 },
    ]);

    const out = await executeMemorySearch(
      { userId: 'u-1', logger: SILENT },
      { query: 'cloud' },
      { recall, semanticRecall },
    );

    expect(out.output!.memories.length).toBe(1);
    expect(out.output!.memories[0].value).toBe('aws');
    expect(out.output!.memories[0].id).toBe('pg1');
  });

  test('honors limit across the merged set', async () => {
    const recall = vi.fn().mockResolvedValue([
      { id: 'm1', category: 'user', key: 'k1', value: 'v1', confidence: 1 },
      { id: 'm2', category: 'user', key: 'k2', value: 'v2', confidence: 1 },
    ]);
    const semanticRecall = vi.fn().mockResolvedValue([
      { id: 's1', category: 'entity_fact', key: 'k3', value: 'v3', confidence: 0.9 },
      { id: 's2', category: 'entity_fact', key: 'k4', value: 'v4', confidence: 0.8 },
    ]);

    const out = await executeMemorySearch(
      { userId: 'u-1', logger: SILENT },
      { query: 'x', limit: 3 },
      { recall, semanticRecall },
    );

    expect(out.output!.memories.length).toBe(3);
  });
});
