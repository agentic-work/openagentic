/**
 * #605 — Boot-time Milvus collection size probe.
 *
 * Reads `getCollectionStatistics` for `mcp_tools` (chatmode tool index) and
 * `agents` (agent registry — renamed from the legacy `mcp_*` prefixed
 * name in Phase E.9 on 2026-05-10) and validates them against per-collection
 * thresholds. Pure function — takes a stats-fetching closure so unit tests
 * can stub Milvus without spinning up the SDK.
 *
 * Caller decides what to do with `ok=false`:
 *   - dev/CI: warn-and-continue (probe is informational)
 *   - prod helm: fail BootstrapStep so the pod doesn't go ready until the
 *     indexer has populated the collections
 */

export interface ProbeThresholds {
  /** Minimum row count required for `mcp_tools` to be considered ready. */
  mcpToolsMin: number;
  /** Minimum row count required for `agents` to be considered ready. */
  mcpAgentsMin: number;
}

export interface ProbeResult {
  ok: boolean;
  mcpToolsCount: number;
  mcpAgentsCount: number;
  errors: string[];
}

export interface CollectionStats {
  /** Milvus SDK shape: `{ data: { row_count: string } }`. We accept the
   *  string-or-number form to tolerate both the SDK and any wrapping. */
  data?: { row_count?: string | number | null };
}

export type CollectionStatFetcher = (
  collectionName: string,
) => Promise<CollectionStats | null | undefined>;

/**
 * Default Milvus collection name constants — must match the prod
 * `TOOLS_COLLECTION_NAME` constant in `ToolSemanticCacheService.ts:25`
 * (`mcp_tools_cache`) and `COLLECTION_NAME` in
 * `AgentSemanticSearchService.ts:30` (`agents`).
 *
 * The probe is self-contained and the BootstrapStep doesn't need to know
 * SDK details — but the names DO need to match the writers, otherwise
 * the probe sees zero rows for collections that exist under different
 * names. Live-caught after the first deploy of #605.
 */
export const MILVUS_COLLECTIONS = {
  MCP_TOOLS: 'mcp_tools_cache',
  AGENTS: 'agents',
} as const;

/**
 * Default thresholds — sensible for a populated dev cluster.
 *  - mcp_tools: >100 rows means at least the core MCP servers indexed.
 *  - agents: ≥5 rows means built-in agent registry seeded.
 */
export const DEFAULT_PROBE_THRESHOLDS: ProbeThresholds = {
  mcpToolsMin: 100,
  mcpAgentsMin: 5,
};

function parseRowCount(stats: CollectionStats | null | undefined): number {
  const raw = stats?.data?.row_count;
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function probeMilvusCollections(
  fetcher: CollectionStatFetcher,
  thresholds: ProbeThresholds = DEFAULT_PROBE_THRESHOLDS,
): Promise<ProbeResult> {
  const errors: string[] = [];

  let mcpToolsCount = 0;
  try {
    const stats = await fetcher(MILVUS_COLLECTIONS.MCP_TOOLS);
    mcpToolsCount = parseRowCount(stats);
  } catch (err: any) {
    errors.push(
      `${MILVUS_COLLECTIONS.MCP_TOOLS}: stat fetch threw — ${err?.message ?? err}`,
    );
  }

  let mcpAgentsCount = 0;
  try {
    const stats = await fetcher(MILVUS_COLLECTIONS.AGENTS);
    mcpAgentsCount = parseRowCount(stats);
  } catch (err: any) {
    errors.push(
      `${MILVUS_COLLECTIONS.AGENTS}: stat fetch threw — ${err?.message ?? err}`,
    );
  }

  if (mcpToolsCount < thresholds.mcpToolsMin) {
    errors.push(
      `${MILVUS_COLLECTIONS.MCP_TOOLS} below threshold (${mcpToolsCount} < ${thresholds.mcpToolsMin})`,
    );
  }
  if (mcpAgentsCount < thresholds.mcpAgentsMin) {
    errors.push(
      `${MILVUS_COLLECTIONS.AGENTS} below threshold (${mcpAgentsCount} < ${thresholds.mcpAgentsMin})`,
    );
  }

  return {
    ok: errors.length === 0,
    mcpToolsCount,
    mcpAgentsCount,
    errors,
  };
}
