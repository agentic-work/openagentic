/**
 * useAgentOpsMetrics — fetches GET /admin/agents/metrics/fleet,
 * exposes { agents, runs, loading, error }.
 *
 * Failures are non-fatal: any HTTP error or network throw resolves
 * to empty arrays + error string so AgentOpsView never crashes.
 */
import { useEffect, useState } from 'react';
import { apiRequest } from '../../../../utils/api';
import type { AgentHealthMetrics } from './AgentHealthCard';
import type { AgentRun } from './AgentRunsTable';

export interface UseAgentOpsMetricsResult {
  agents: AgentHealthMetrics[];
  runs: AgentRun[];
  loading: boolean;
  error: string | null;
}

export function useAgentOpsMetrics(): UseAgentOpsMetricsResult {
  const [agents, setAgents] = useState<AgentHealthMetrics[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('/admin/agents/metrics/fleet');
        if (!res.ok) {
          if (cancelled) return;
          setError(`HTTP ${res.status} from /admin/agents/metrics/fleet`);
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setAgents(Array.isArray(data?.agents) ? data.agents : []);
        setRuns(Array.isArray(data?.runs) ? data.runs : []);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'fleet fetch failed');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { agents, runs, loading, error };
}
