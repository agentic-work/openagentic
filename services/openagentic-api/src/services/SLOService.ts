/**
 * SLOService — Phase 12 of V3 enterprise chatmode plan.
 *
 * In-memory CRUD on SLODefinition rows. Each row pins a per-metric
 * threshold (p99 latency, error rate, RPS floor) over a measurement
 * window so the admin dashboard can render a green/red status badge
 * per V3 surface without operators having to author PromQL.
 *
 * Phase 12 ships in-memory storage seeded from DEFAULT_SLOS at boot
 * with admin-driven mutations through /api/admin/slo/*. Persistence
 * to Postgres + reload-on-restart is a follow-up — operators tune
 * thresholds per-cluster, so the boot defaults are intentionally
 * conservative (designed to almost-never fire on a healthy cluster).
 *
 * SLO type meanings:
 *  - 'p99'        — value at the 99th percentile of the histogram MUST
 *                   be below `threshold` (in seconds for *_duration_*,
 *                   in tokens for *_tokens, etc).
 *  - 'error_rate' — for counter metrics with an `outcome` label, the
 *                   ratio of `error` to total MUST be below `threshold`
 *                   (0..1 fraction).
 *  - 'rps_floor'  — counter increments-per-second over `window` MUST
 *                   meet or exceed `threshold` (catches "hook never
 *                   fires" silent regressions).
 */

export interface SLODefinition {
  metric: string;
  type: 'p99' | 'error_rate' | 'rps_floor';
  threshold: number;
  window: '1h' | '6h' | '24h' | '7d';
  description: string;
  enabled: boolean;
}

/**
 * Default SLOs — covers each major V3 surface. Thresholds chosen for
 * UX expectations on a healthy cluster (Sonnet on AIF, gpt-oss:20b on
 * Ollama, normal hook chain). Operators tune per-cluster.
 */
export const DEFAULT_SLOS: SLODefinition[] = [
  // 1. Whole-turn latency — operators feel the pain of >30s p99.
  {
    metric: 'v3_chat_turn_duration_seconds',
    type: 'p99',
    threshold: 30,
    window: '1h',
    description: 'p99 V3 chat turn end-to-end under 30s',
    enabled: true,
  },
  // 2. Tool error rate — single most actionable health signal.
  {
    metric: 'v3_tool_dispatches_total',
    type: 'error_rate',
    threshold: 0.05,
    window: '1h',
    description: 'V3 tool dispatch error rate under 5%',
    enabled: true,
  },
  // 3. Tool dispatch latency — outliers are MCP hangs / sandbox stalls.
  {
    metric: 'v3_tool_dispatch_duration_seconds',
    type: 'p99',
    threshold: 15,
    window: '1h',
    description: 'p99 V3 tool dispatch under 15s',
    enabled: true,
  },
  // 4. Hook error rate — DLP/HITL/audit hooks must be reliable.
  {
    metric: 'v3_hook_invocations_total',
    type: 'error_rate',
    threshold: 0.01,
    window: '1h',
    description: 'V3 hook chain error rate under 1%',
    enabled: true,
  },
  // 5. Hook duration — keep hooks off the critical path of chat turns.
  {
    metric: 'v3_hook_duration_seconds',
    type: 'p99',
    threshold: 1,
    window: '1h',
    description: 'p99 V3 hook duration under 1s',
    enabled: true,
  },
  // 6. Sub-agent error rate — openagentic-proxy is a separate service.
  {
    metric: 'v3_subagent_dispatches_total',
    type: 'error_rate',
    threshold: 0.05,
    window: '24h',
    description: 'V3 sub-agent dispatch error rate under 5% (24h)',
    enabled: true,
  },
  // 7. Sub-agent duration — long sub-agent runs are usually a bug.
  {
    metric: 'v3_subagent_duration_seconds',
    type: 'p99',
    threshold: 90,
    window: '24h',
    description: 'p99 V3 sub-agent duration under 90s (24h)',
    enabled: true,
  },
  // 8. Sub-agent cost — runaway-cost early-warning.
  {
    metric: 'v3_subagent_cost_usd',
    type: 'p99',
    threshold: 0.5,
    window: '24h',
    description: 'p99 V3 sub-agent cost under $0.50 (24h)',
    enabled: true,
  },
  // 9. Compaction trigger floor — if compaction never fires when context
  //    is large, mid-loop OOMs aren't being caught.
  {
    metric: 'v3_compaction_triggers_total',
    type: 'rps_floor',
    threshold: 0,
    window: '7d',
    description: 'V3 compaction triggers floor (advisory: 0 means simply not zero)',
    enabled: false,
  },
  // 10. Memory injection error rate — recall fan-out is a load-bearing
  //     UX surface. Disabled by default since miss is normal for a fresh
  //     user.
  {
    metric: 'v3_memory_injection_total',
    type: 'rps_floor',
    threshold: 0,
    window: '24h',
    description: 'V3 memory injection floor (advisory)',
    enabled: false,
  },
];

export class SLOService {
  private rows: Map<string, SLODefinition>;

  constructor(seed: SLODefinition[] = DEFAULT_SLOS) {
    this.rows = new Map();
    for (const s of seed) this.rows.set(s.metric, { ...s });
  }

  listSLOs(): SLODefinition[] {
    return Array.from(this.rows.values()).map((s) => ({ ...s }));
  }

  getSLO(metric: string): SLODefinition | undefined {
    const row = this.rows.get(metric);
    return row ? { ...row } : undefined;
  }

  upsertSLO(slo: SLODefinition): SLODefinition {
    this.rows.set(slo.metric, { ...slo });
    return { ...slo };
  }

  toggleSLO(metric: string): SLODefinition | undefined {
    const row = this.rows.get(metric);
    if (!row) return undefined;
    row.enabled = !row.enabled;
    return { ...row };
  }

  deleteSLO(metric: string): boolean {
    return this.rows.delete(metric);
  }
}

// Module-level singleton — every admin route reads the same instance.
let _instance: SLOService | undefined;
export function getSLOService(): SLOService {
  if (!_instance) _instance = new SLOService();
  return _instance;
}

/** Test-only — reset the module-level singleton between tests. */
export function _resetSLOServiceForTests(): void {
  _instance = undefined;
}
