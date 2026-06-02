/**
 * Built-in MCP catalog — the single API-side source of truth for the known
 * built-in MCP fleet.
 *
 * The 14 built-in MCPs are NOT modeled as DB rows (the DB registry only holds
 * admin-added servers). They are spawned by mcp-proxy, gated on `*_MCP_DISABLED`
 * env flags. When a built-in is env-disabled the proxy never registers it, so it
 * vanishes from `GET ${MCP_PROXY_URL}/servers` entirely — which made the admin
 * MCP Fleet silently drop aws/azure/gcp/loki/alertmanager/github instead of
 * showing them as "available but not yet enabled".
 *
 * This module gives every fleet-facing endpoint a stable catalog to merge the
 * live (running) proxy set against, so the disabled built-ins render as a
 * distinct `available` / `needs-config` state instead of disappearing.
 *
 * It also owns the proxy-name → bare-id normalization: mcp-proxy reports
 * built-ins under `openagentic_<id>` (e.g. `openagentic_admin`) while the DB,
 * wizard, and UI use the bare id (`admin`). Without normalization a built-in
 * shows up as two unreconciled rows. Normalize everything to the bare id here.
 */

export type BuiltinMcpFleetStatus =
  | 'healthy'
  | 'degraded'
  | 'down'
  | 'available'    // known built-in, enabled-capable, not currently running
  | 'needs-config' // known built-in that requires external credentials to run
  | 'unknown';

export interface BuiltinMcpDef {
  /** Canonical bare id used by DB/wizard/UI (e.g. `admin`, `aws`). */
  id: string;
  /** Human display name. */
  name: string;
  /** Short description for the fleet/catalog UI. */
  description: string;
  /** Logical category/namespace for grouping in the UI. */
  category: string;
  /**
   * True when the built-in cannot run without external credentials
   * (cloud creds, tokens, etc.). When such a built-in is not running we surface
   * it as `needs-config` rather than plain `available`.
   */
  needsConfig: boolean;
}

/**
 * The intended built-in set — mirrors the mcp-proxy spawn catalog
 * (`services/openagentic-mcp-proxy/src/mcp_manager.py` `initialize_servers()`).
 * Keyed by the canonical bare id. This is what SHOULD exist; the running subset
 * is whatever the proxy reports live.
 */
export const BUILTIN_MCP_CATALOG: Record<string, BuiltinMcpDef> = {
  admin: {
    id: 'admin',
    name: 'Admin',
    description: 'System administration tools (PostgreSQL, Redis, Milvus, health) — admin users only',
    category: 'admin',
    needsConfig: false,
  },
  web: {
    id: 'web',
    name: 'Web',
    description: 'Web search and fetch tools',
    category: 'web',
    needsConfig: false,
  },
  kubernetes: {
    id: 'kubernetes',
    name: 'Kubernetes',
    description: 'Kubernetes cluster read/ops tools (uses the pod service account)',
    category: 'kubernetes',
    needsConfig: false,
  },
  prometheus: {
    id: 'prometheus',
    name: 'Prometheus',
    description: 'Prometheus metrics query tools (in-cluster Prometheus)',
    category: 'prometheus',
    needsConfig: false,
  },
  aws: {
    id: 'aws',
    name: 'AWS',
    description: 'AWS cloud tools — requires AWS credentials',
    category: 'aws',
    needsConfig: true,
  },
  azure: {
    id: 'azure',
    name: 'Azure',
    description: 'Azure cloud tools — requires Azure credentials / OBO',
    category: 'azure',
    needsConfig: true,
  },
  gcp: {
    id: 'gcp',
    name: 'GCP',
    description: 'Google Cloud tools — requires GCP credentials',
    category: 'gcp',
    needsConfig: true,
  },
  loki: {
    id: 'loki',
    name: 'Loki',
    description: 'Loki log query tools',
    category: 'loki',
    needsConfig: true,
  },
  alertmanager: {
    id: 'alertmanager',
    name: 'Alertmanager',
    description: 'Alertmanager alert tools',
    category: 'alertmanager',
    needsConfig: true,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub repository and issue tools — requires a GitHub token',
    category: 'github',
    needsConfig: true,
  },
};

/**
 * Proxy reports built-ins under `openagentic_<id>` (and a few special-cased
 * remote names). Normalize any proxy/DB/UI server key to the canonical bare id
 * so each built-in reconciles to ONE fleet row.
 *
 * Examples:
 *   openagentic_admin  -> admin
 *   openagentic_web    -> web
 *   aws_knowledge      -> aws       (the AWS knowledge remote folds into aws)
 *   admin              -> admin     (already bare)
 */
export function normalizeMcpServerId(rawName: string | null | undefined): string {
  const key = String(rawName ?? '').trim();
  if (!key) return '';
  const lower = key.toLowerCase();

  // openagentic_<x> -> <x>
  if (lower.startsWith('openagentic_')) {
    return lower.slice('openagentic_'.length);
  }
  // openagentic-<x> -> <x> (hyphen variant, just in case)
  if (lower.startsWith('openagentic-')) {
    return lower.slice('openagentic-'.length);
  }
  // The remote AWS-docs knowledge server folds into the aws built-in row.
  if (lower === 'aws_knowledge') {
    return 'aws';
  }
  return lower;
}

/** True if the (normalized) id is one of the known built-ins. */
export function isBuiltinMcp(id: string | null | undefined): boolean {
  const norm = normalizeMcpServerId(id);
  return !!norm && norm in BUILTIN_MCP_CATALOG;
}

/**
 * Fleet rows for any built-in NOT present in the running set. Returns
 * `available` for built-ins that can run with no external config, and
 * `needs-config` for the ones that require credentials.
 *
 * @param runningIds set of already-running server ids (already normalized)
 */
export function getDisabledBuiltinFleetRows(runningIds: Set<string>): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  status: BuiltinMcpFleetStatus;
  source: 'builtin-catalog';
  synced_to_proxy: false;
  db_registered: false;
  toolCount: 0;
  hosted: 'pod';
}> {
  const rows: ReturnType<typeof getDisabledBuiltinFleetRows> = [];
  for (const def of Object.values(BUILTIN_MCP_CATALOG)) {
    if (runningIds.has(def.id)) continue;
    rows.push({
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      status: def.needsConfig ? 'needs-config' : 'available',
      source: 'builtin-catalog',
      synced_to_proxy: false,
      db_registered: false,
      toolCount: 0,
      hosted: 'pod',
    });
  }
  return rows;
}
