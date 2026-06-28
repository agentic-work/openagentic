/**
 * agentRegistryApi — single SOT-only fetcher for agent registry entries.
 *
 * The Admin console (/api/admin/agents → prisma.agent table) is the
 * sole source of truth. The legacy /api/workflows/agents path hit
 * openagentic-proxy and skipped the DB; it is no longer used here.
 *
 * Cached for 60s per-request to avoid re-fetching across re-renders.
 */

export interface AgentRegistryEntry {
  id: string;
  display_name: string;
  agent_type: string;
  model?: string;
}

const TTL_MS = 60_000;
let _cache: { agents: AgentRegistryEntry[]; ts: number } | null = null;

/** Reset the in-memory cache (test hook + manual refresh on save). */
export function resetAgentRegistryCache(): void {
  _cache = null;
}

/**
 * Fetch the registered agent list from the Admin SOT.
 *
 * Returns an empty array on any failure — never throws — so consumers can
 * render a graceful empty state. Caches successful results for 60s.
 */
export async function fetchAgents(
  extraHeaders?: Record<string, string>,
): Promise<AgentRegistryEntry[]> {
  if (_cache && Date.now() - _cache.ts < TTL_MS) return _cache.agents;
  try {
    const res = await fetch('/api/admin/agents', {
      headers: { ...(extraHeaders ?? {}) },
      credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.agents || []);
    const agents: AgentRegistryEntry[] = raw.map((a: any) => ({
      id: a.id,
      display_name: a.display_name || a.name || a.id,
      agent_type: a.agent_type || a.role || 'custom',
      model: a.model_config?.primaryModel || a.model || '',
    }));
    _cache = { agents, ts: Date.now() };
    return agents;
  } catch {
    return [];
  }
}
