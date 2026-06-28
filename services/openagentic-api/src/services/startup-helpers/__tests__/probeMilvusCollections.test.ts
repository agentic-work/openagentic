/**
 * #605 — TDD coverage for the Milvus boot-gate collection probe.
 */
import { describe, test, expect, vi } from 'vitest';
import {
  probeMilvusCollections,
  MILVUS_COLLECTIONS,
  DEFAULT_PROBE_THRESHOLDS,
  type CollectionStatFetcher,
} from '../probeMilvusCollections.js';

function fetcherFromMap(map: Record<string, number | null | undefined>): CollectionStatFetcher {
  return async (name: string) => ({ data: { row_count: map[name] ?? 0 } });
}

describe('probeMilvusCollections (#605)', () => {
  test('ok=true when both collections exceed thresholds', async () => {
    const r = await probeMilvusCollections(
      fetcherFromMap({ [MILVUS_COLLECTIONS.MCP_TOOLS]: 270, [MILVUS_COLLECTIONS.AGENTS]: 7 }),
    );
    expect(r.ok).toBe(true);
    expect(r.mcpToolsCount).toBe(270);
    expect(r.mcpAgentsCount).toBe(7);
    expect(r.errors).toEqual([]);
  });

  test('ok=false when mcp_tools is below threshold', async () => {
    const r = await probeMilvusCollections(
      fetcherFromMap({ [MILVUS_COLLECTIONS.MCP_TOOLS]: 50, [MILVUS_COLLECTIONS.AGENTS]: 7 }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('mcp_tools_cache below threshold (50 < 100)'))).toBe(true);
  });

  test('ok=false when agents is below threshold', async () => {
    const r = await probeMilvusCollections(
      fetcherFromMap({ [MILVUS_COLLECTIONS.MCP_TOOLS]: 270, [MILVUS_COLLECTIONS.AGENTS]: 2 }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.includes('agents below threshold (2 < 5)'))).toBe(true);
  });

  test('ok=false on empty collections (cold install)', async () => {
    const r = await probeMilvusCollections(fetcherFromMap({}));
    expect(r.ok).toBe(false);
    expect(r.mcpToolsCount).toBe(0);
    expect(r.mcpAgentsCount).toBe(0);
    expect(r.errors.length).toBe(2);
  });

  test('captures fetcher exceptions instead of throwing', async () => {
    const fetcher: CollectionStatFetcher = vi.fn(async (name) => {
      throw new Error(`milvus unreachable for ${name}`);
    });
    const r = await probeMilvusCollections(fetcher);
    expect(r.ok).toBe(false);
    expect(r.mcpToolsCount).toBe(0);
    expect(r.mcpAgentsCount).toBe(0);
    expect(r.errors.length).toBe(4); // 2 fetch-threw errors + 2 below-threshold errors (counts default to 0)
    expect(r.errors.some(e => e.includes('mcp_tools_cache: stat fetch threw'))).toBe(true);
    expect(r.errors.some(e => e.includes('agents: stat fetch threw'))).toBe(true);
  });

  test('parses string row_count from Milvus SDK shape', async () => {
    // Milvus SDK returns row_count as a string, not a number.
    const fetcher: CollectionStatFetcher = async (name) => ({
      data: { row_count: name === MILVUS_COLLECTIONS.MCP_TOOLS ? '300' : '6' },
    });
    const r = await probeMilvusCollections(fetcher);
    expect(r.ok).toBe(true);
    expect(r.mcpToolsCount).toBe(300);
    expect(r.mcpAgentsCount).toBe(6);
  });

  test('respects custom thresholds (lower bar for fresh cluster)', async () => {
    const r = await probeMilvusCollections(
      fetcherFromMap({ [MILVUS_COLLECTIONS.MCP_TOOLS]: 1, [MILVUS_COLLECTIONS.AGENTS]: 1 }),
      { mcpToolsMin: 1, mcpAgentsMin: 1 },
    );
    expect(r.ok).toBe(true);
  });

  test('default thresholds match spec: mcp_tools>100, mcp_agents>=5', () => {
    expect(DEFAULT_PROBE_THRESHOLDS.mcpToolsMin).toBe(100);
    expect(DEFAULT_PROBE_THRESHOLDS.mcpAgentsMin).toBe(5);
  });
});
