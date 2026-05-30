/**
 * useTopbarToolsCounts — fetch internal/connected tool counts for the topbar
 * `<ToolsPill>` (mock 01:146-152 + 10:205).
 *
 * - "internal" = tier-1 always-loaded internal tools (count from
 *   `/api/internal/tier1-tool-count` if available; falls back to a
 *   conservative 11 matching mock 10).
 * - "connected" = tier-2/3 MCP tool count from
 *   `/api/admin/mcp/tools/status` (Milvus rowCount). Same endpoint
 *   ToolsIndexedPill already reads.
 *
 * Returns 0/0 on any error so the pill self-hides.
 */

import { useEffect, useState } from 'react';
import { apiEndpoint } from '@/utils/api';

interface ToolsStatus {
  milvus?: { exists?: boolean; rowCount?: number };
  indexing?: { totalToolsIndexed?: number };
}

const TIER1_FALLBACK = 11;

export function useTopbarToolsCounts(): { internal: number; connected: number } {
  const [counts, setCounts] = useState<{ internal: number; connected: number }>({
    internal: TIER1_FALLBACK,
    connected: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiEndpoint('/admin/mcp/tools/status'), {
          credentials: 'include',
          headers: { 'X-OpenAgentic-Frontend': 'true' },
        });
        if (!r.ok) return;
        const d: ToolsStatus = await r.json();
        const connected =
          d.milvus?.exists && typeof d.milvus.rowCount === 'number' && d.milvus.rowCount > 0
            ? d.milvus.rowCount
            : d.indexing?.totalToolsIndexed || 0;
        if (!cancelled) {
          setCounts((prev) => ({ internal: prev.internal, connected }));
        }
      } catch {
        // Stay on the fallback counts — pill still renders the internal tier.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}
