/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Tool Summarizer — compute a short human-readable summary of a tool call
 * from its arguments + result, for inline display in the assistant message
 * next to the tool chip. The collapsed form shows the summary; expanding
 * still reveals the full request/response JSON.
 *
 * DESIGN:
 *   - Summaries are COMPUTED from the result shape, not transmitted from the
 *     server, so existing chat history replays also get summaries for free.
 *   - A summary can return either a plain string or a richer structure
 *     (e.g. web_search returns a list of {title, url, favicon}).
 *   - Unknown tools fall back to a generic "N results" / "Completed" hint
 *     derived from the result shape.
 *
 * USAGE:
 *   const summary = summarizeToolCall(toolName, args, result, status);
 *   if (summary.kind === 'text') { render <span>{summary.text}</span> }
 *   if (summary.kind === 'links') { render favicon+title pills }
 */

export type ToolSummary =
  | { kind: 'text'; text: string }
  | { kind: 'links'; items: Array<{ title: string; url: string; favicon?: string }> }
  | { kind: 'none' };

export type ToolCallStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'approved'
  | 'rejected'
  | undefined;

// ─── helpers ────────────────────────────────────────────────────────────────

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

function safeString(v: unknown, max = 80): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function unwrapResult(result: any): any {
  // MCP results are often {content: [{type: "text", text: "<JSON>"}]} or
  // {result: {...}} or the raw value. Normalize to the innermost payload.
  if (result == null) return null;
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  if (Array.isArray(result?.content)) {
    const text = result.content
      .map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''))
      .join('\n');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (result?.result !== undefined) return unwrapResult(result.result);
  return result;
}

function countArray(payload: any, keys: string[] = []): number | null {
  if (Array.isArray(payload)) return payload.length;
  for (const k of keys) {
    if (Array.isArray(payload?.[k])) return payload[k].length;
  }
  return null;
}

// ─── per-tool summarizers ───────────────────────────────────────────────────

type Summarizer = (args: any, result: any, status?: ToolCallStatus) => ToolSummary;

function statusPrefix(status: ToolCallStatus): string {
  if (status === 'pending') return '';
  if (status === 'executing') return '';
  if (status === 'failed') return 'Failed — ';
  if (status === 'rejected') return 'Rejected — ';
  return '';
}

function text(s: string): ToolSummary {
  return { kind: 'text', text: s };
}

const SUMMARIZERS: Record<string, Summarizer> = {
  // ── Azure ─────────────────────────────────────────────────────────────────
  azure_create_resource_group: (args, _r) => {
    const name = args?.name || args?.resource_group_name || args?.resourceGroupName || '?';
    const loc = args?.location || args?.region || '';
    return text(`Resource group ${name}${loc ? ` created in ${loc}` : ' created'}`);
  },
  azure_delete_resource_group: (args) => text(`Deleted resource group ${args?.name || args?.resource_group || '?'}`),
  azure_create_web_app: (args) => text(`Web app ${args?.name || args?.app_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_function_app: (args) => text(`Function app ${args?.name || args?.function_app_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_container_app: (args) => text(`Container app ${args?.name || '?'} created${args?.resource_group ? ` in ${args.resource_group}` : ''}`),
  azure_create_app_service_plan: (args) => text(`App Service plan ${args?.name || '?'} created${args?.sku ? ` (${args.sku})` : ''}`),
  azure_create_storage_account: (args) => text(`Storage account ${args?.name || args?.account_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_key_vault: (args) => text(`Key Vault ${args?.name || '?'} created`),
  azure_create_vm: (args) => text(`VM ${args?.name || args?.vm_name || '?'} created${args?.size ? ` (${args.size})` : ''}`),
  azure_storage_account_set_public_access: (args) => text(`Public access ${args?.allow_public_access === false ? 'disabled' : 'enabled'} on ${args?.name || args?.account_name || '?'}`),
  azure_list_subscriptions: (_a, r) => {
    const data = unwrapResult(r);
    const n = countArray(data, ['subscriptions', 'value']) ?? 0;
    return text(`${n} subscription${n === 1 ? '' : 's'}`);
  },
  azure_list_resource_groups: (_a, r) => {
    const n = countArray(unwrapResult(r), ['resource_groups', 'value']) ?? 0;
    return text(`${n} resource group${n === 1 ? '' : 's'}`);
  },
  azure_list_vms: (_a, r) => {
    const n = countArray(unwrapResult(r), ['vms', 'value']) ?? 0;
    return text(`${n} VM${n === 1 ? '' : 's'}`);
  },
  azure_list_web_apps: (_a, r) => {
    const n = countArray(unwrapResult(r), ['apps', 'web_apps', 'value']) ?? 0;
    return text(`${n} web app${n === 1 ? '' : 's'}`);
  },
  azure_list_storage_accounts: (_a, r) => {
    const n = countArray(unwrapResult(r), ['storage_accounts', 'accounts', 'value']) ?? 0;
    return text(`${n} storage account${n === 1 ? '' : 's'}`);
  },
  azure_list_aks_clusters: (_a, r) => {
    const n = countArray(unwrapResult(r), ['clusters', 'value']) ?? 0;
    return text(`${n} AKS cluster${n === 1 ? '' : 's'}`);
  },
  azure_list_keyvaults: (_a, r) => {
    const n = countArray(unwrapResult(r), ['keyvaults', 'vaults', 'value']) ?? 0;
    return text(`${n} Key Vault${n === 1 ? '' : 's'}`);
  },
  azure_list_management_groups: (_a, r) => {
    const n = countArray(unwrapResult(r), ['management_groups', 'value']) ?? 0;
    return text(`${n} management group${n === 1 ? '' : 's'}`);
  },
  azure_list_public_facing_resources: (_a, r) => {
    const n = countArray(unwrapResult(r), ['resources', 'public_resources', 'value']) ?? 0;
    return text(`${n} public-facing resource${n === 1 ? '' : 's'}`);
  },
  azure_list_role_assignments: (_a, r) => {
    const n = countArray(unwrapResult(r), ['assignments', 'role_assignments', 'value']) ?? 0;
    return text(`${n} role assignment${n === 1 ? '' : 's'}`);
  },
  azure_resource_graph_query: (_a, r) => {
    const data = unwrapResult(r);
    const rows = data?.total_records ?? data?.count ?? countArray(data, ['data', 'rows', 'records']) ?? 0;
    return text(`${rows} row${rows === 1 ? '' : 's'}`);
  },
  azure_resource_graph_query_tenant_wide: (_a, r) => {
    const data = unwrapResult(r);
    const rows = data?.total_records ?? countArray(data, ['data', 'rows']) ?? 0;
    const subs = data?.per_batch_stats?.length || data?.subscriptions_queried || 0;
    return text(`${rows} row${rows === 1 ? '' : 's'}${subs ? ` across ${subs} sub${subs === 1 ? '' : 's'}` : ''}`);
  },
  azure_cost_query: (args, r) => {
    const data = unwrapResult(r);
    const total = data?.total_cost ?? data?.totalCost;
    const cur = data?.currency || 'USD';
    if (typeof total === 'number') return text(`$${total.toFixed(2)} ${cur}${args?.timeframe ? ` (${args.timeframe})` : ''}`);
    return text(`Cost query${args?.timeframe ? ` (${args.timeframe})` : ''}`);
  },
  azure_cost_forecast: (_a, r) => {
    const data = unwrapResult(r);
    const total = data?.forecast_total ?? data?.forecast;
    if (typeof total === 'number') return text(`Forecast $${total.toFixed(2)}`);
    return text('Cost forecast');
  },
  azure_advisor_recommendations: (_a, r) => {
    const n = countArray(unwrapResult(r), ['recommendations', 'value']) ?? 0;
    return text(`${n} recommendation${n === 1 ? '' : 's'}`);
  },
  azure_service_health_events: (_a, r) => {
    const n = countArray(unwrapResult(r), ['events', 'value']) ?? 0;
    return text(`${n} health event${n === 1 ? '' : 's'}`);
  },
  azure_security_list_assessments: (_a, r) => {
    const data = unwrapResult(r);
    const n = data?.count ?? countArray(data, ['assessments', 'value']) ?? 0;
    return text(`${n} Defender assessment${n === 1 ? '' : 's'}`);
  },
  azure_security_list_alerts: (_a, r) => {
    const data = unwrapResult(r);
    const n = data?.count ?? countArray(data, ['alerts', 'value']) ?? 0;
    return text(`${n} security alert${n === 1 ? '' : 's'}`);
  },
  azure_security_secure_score: (_a, r) => {
    const data = unwrapResult(r);
    const scores = data?.secure_scores || data?.value || [];
    const first = Array.isArray(scores) && scores.length > 0 ? scores[0] : null;
    const pct = first?.percentage;
    if (typeof pct === 'number') return text(`Secure score ${Math.round(pct * 100)}%`);
    return text('Secure score queried');
  },
  azure_policy_list_compliance_states: (_a, r) => {
    const data = unwrapResult(r);
    const ok = data?.compliant_count;
    const bad = data?.non_compliant_count;
    if (typeof ok === 'number' && typeof bad === 'number') {
      return text(`${ok} compliant / ${bad} non-compliant`);
    }
    const n = data?.count ?? 0;
    return text(`${n} compliance state${n === 1 ? '' : 's'}`);
  },
  azure_log_analytics_list_workspaces: (_a, r) => {
    const data = unwrapResult(r);
    const n = data?.count ?? countArray(data, ['workspaces']) ?? 0;
    return text(`${n} workspace${n === 1 ? '' : 's'}`);
  },
  azure_log_analytics_query: (_a, r) => {
    const data = unwrapResult(r);
    const rows = data?.row_count ?? countArray(data, ['rows']) ?? 0;
    return text(`${rows} row${rows === 1 ? '' : 's'}`);
  },
  azure_app_insights_list_components: (_a, r) => {
    const data = unwrapResult(r);
    const n = data?.count ?? countArray(data, ['components']) ?? 0;
    return text(`${n} App Insights component${n === 1 ? '' : 's'}`);
  },
  azure_app_insights_query: (_a, r) => {
    const data = unwrapResult(r);
    const rows = data?.row_count ?? countArray(data, ['rows']) ?? 0;
    return text(`${rows} row${rows === 1 ? '' : 's'}`);
  },

  azure_list_nsgs: (_a, r) => {
    const n = countArray(unwrapResult(r), ['nsgs', 'network_security_groups', 'value']) ?? 0;
    return text(`${n} NSG${n === 1 ? '' : 's'}`);
  },
  azure_list_vnets: (_a, r) => {
    const n = countArray(unwrapResult(r), ['vnets', 'virtual_networks', 'value']) ?? 0;
    return text(`${n} VNet${n === 1 ? '' : 's'}`);
  },
  azure_list_load_balancers: (_a, r) => {
    const n = countArray(unwrapResult(r), ['load_balancers', 'value']) ?? 0;
    return text(`${n} load balancer${n === 1 ? '' : 's'}`);
  },
  azure_list_app_gateways: (_a, r) => {
    const n = countArray(unwrapResult(r), ['app_gateways', 'application_gateways', 'value']) ?? 0;
    return text(`${n} App Gateway${n === 1 ? '' : 's'}`);
  },
  azure_list_front_doors: (_a, r) => {
    const n = countArray(unwrapResult(r), ['front_doors', 'value']) ?? 0;
    return text(`${n} Front Door${n === 1 ? '' : 's'}`);
  },
  azure_get_front_door: (args) => text(`Front Door ${args?.name || '?'} details`),
  azure_get_app_gateway: (args) => text(`App Gateway ${args?.name || '?'} details`),
  azure_app_gateway_backend_health: (args) => text(`Backend health for ${args?.name || '?'}`),
  azure_cost_by_service: (_a, r) => {
    const data = unwrapResult(r);
    const services = data?.services ?? data?.cost_by_service;
    const n = Array.isArray(services) ? services.length : 0;
    const total = data?.total_cost;
    if (typeof total === 'number') return text(`$${total.toFixed(2)} across ${n} service${n === 1 ? '' : 's'}`);
    return text(`${n} service${n === 1 ? '' : 's'}`);
  },
  azure_activity_log: (_a, r) => {
    const data = unwrapResult(r);
    const total = data?.total_events ?? 0;
    const creates = data?.summary?.creates_and_updates ?? 0;
    const deletes = data?.summary?.deletes ?? 0;
    return text(`${total} events (${creates} creates, ${deletes} deletes)`);
  },
  azure_get_metrics: (args) => text(`Metrics for ${args?.resource_id?.split('/')?.pop() || args?.resource_name || '?'}`),
  azure_list_alerts: (_a, r) => {
    const n = countArray(unwrapResult(r), ['alerts', 'value']) ?? 0;
    return text(`${n} metric alert${n === 1 ? '' : 's'}`);
  },
  // New creation tools
  azure_create_vnet: (args) => text(`VNet ${args?.name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_subnet: (args) => text(`Subnet ${args?.subnet_name || '?'} added to ${args?.vnet_name || '?'}`),
  azure_create_nsg: (args) => text(`NSG ${args?.name || '?'} created${args?.rules?.length ? ` (${args.rules.length} rules)` : ''}`),
  azure_create_app_gateway: (args) => text(`App Gateway ${args?.name || '?'} created${args?.sku_name ? ` (${args.sku_name})` : ''}`),
  azure_create_front_door: (args) => text(`Front Door ${args?.name || '?'} created${args?.sku ? ` (${args.sku})` : ''}`),

  // ── AWS ───────────────────────────────────────────────────────────────────
  aws_list_instances: (_a, r) => {
    const n = countArray(unwrapResult(r), ['instances', 'Instances']) ?? 0;
    return text(`${n} EC2 instance${n === 1 ? '' : 's'}`);
  },
  aws_list_s3_buckets: (_a, r) => {
    const n = countArray(unwrapResult(r), ['buckets', 'Buckets']) ?? 0;
    return text(`${n} S3 bucket${n === 1 ? '' : 's'}`);
  },
  aws_cli_execute: (args) => text(`aws ${safeString(args?.command || args?.args || '', 60)}`),

  // ── GCP ───────────────────────────────────────────────────────────────────
  gcp_list_projects: (_a, r) => {
    const n = countArray(unwrapResult(r), ['projects']) ?? 0;
    return text(`${n} project${n === 1 ? '' : 's'}`);
  },
  gcp_list_compute_instances: (_a, r) => {
    const n = countArray(unwrapResult(r), ['instances']) ?? 0;
    return text(`${n} GCE instance${n === 1 ? '' : 's'}`);
  },

  // ── Kubernetes ────────────────────────────────────────────────────────────
  k8s_list_pods: (args, r) => {
    const n = countArray(unwrapResult(r), ['pods', 'items']) ?? 0;
    return text(`${n} pod${n === 1 ? '' : 's'}${args?.namespace ? ` in ${args.namespace}` : ''}`);
  },
  k8s_list_namespaces: (_a, r) => {
    const n = countArray(unwrapResult(r), ['namespaces', 'items']) ?? 0;
    return text(`${n} namespace${n === 1 ? '' : 's'}`);
  },
  k8s_list_deployments: (args, r) => {
    const n = countArray(unwrapResult(r), ['deployments', 'items']) ?? 0;
    return text(`${n} deployment${n === 1 ? '' : 's'}${args?.namespace ? ` in ${args.namespace}` : ''}`);
  },
  k8s_list_services: (_a, r) => {
    const n = countArray(unwrapResult(r), ['services', 'items']) ?? 0;
    return text(`${n} service${n === 1 ? '' : 's'}`);
  },
  k8s_list_nodes: (_a, r) => {
    const n = countArray(unwrapResult(r), ['nodes', 'items']) ?? 0;
    return text(`${n} node${n === 1 ? '' : 's'}`);
  },
  k8s_get_pod_logs: (args) => text(`Logs for ${args?.pod || args?.name || '?'}${args?.namespace ? ` (${args.namespace})` : ''}`),

  // ── Web search + fetch (rich favicon summary) ─────────────────────────────
  web_search: (args, r) => {
    const data = unwrapResult(r);
    const results: any[] = data?.results || data?.items || data?.hits || (Array.isArray(data) ? data : []);
    if (!Array.isArray(results) || results.length === 0) {
      return text(`Searched: "${safeString(args?.query || args?.q || '', 60)}"`);
    }
    const top = results.slice(0, 4).map((r: any) => ({
      title: safeString(r.title || r.name || r.url || 'result', 60),
      url: r.url || r.link || '',
      favicon: r.favicon || (r.url || r.link ? getFaviconUrl(r.url || r.link) : undefined),
    }));
    return { kind: 'links', items: top };
  },
  web_fetch: (args) => {
    const url = args?.url || args?.uri || '';
    if (!url) return text('Fetched URL');
    return { kind: 'links', items: [{ title: safeString(url, 80), url, favicon: getFaviconUrl(url) }] };
  },

  // ── Memory ────────────────────────────────────────────────────────────────
  memory_store: (args) => text(`Stored: ${safeString(args?.key || args?.content || 'memory', 60)}`),
  memory_recall: (args, r) => {
    const data = unwrapResult(r);
    const n = countArray(data, ['memories', 'results']) ?? 0;
    return text(`Recalled ${n} memor${n === 1 ? 'y' : 'ies'}${args?.query ? ` for "${safeString(args.query, 30)}"` : ''}`);
  },
  memory_forget: (args) => text(`Forgot: ${safeString(args?.key || 'memory', 60)}`),

  // ── Data layer ────────────────────────────────────────────────────────────
  query_data: (args, r) => {
    const data = unwrapResult(r);
    const rows = countArray(data, ['rows', 'results', 'data']) ?? data?.row_count ?? 0;
    return text(`${rows} row${rows === 1 ? '' : 's'}${args?.dataset_id ? ` from ${args.dataset_id}` : ''}`);
  },
  list_datasets: (_a, r) => {
    const n = countArray(unwrapResult(r), ['datasets', 'items']) ?? 0;
    return text(`${n} dataset${n === 1 ? '' : 's'}`);
  },

  // ── Images ────────────────────────────────────────────────────────────────
  generate_image: (args) => text(`Generated image: "${safeString(args?.prompt || '', 60)}"`),

  // ── Delegation ────────────────────────────────────────────────────────────
  delegate_to_agents: (args) => {
    const agents = Array.isArray(args?.agents) ? args.agents : [];
    if (agents.length === 0) return text('Delegated to agents');
    const roles = agents.map((a: any) => a?.role || 'agent').slice(0, 3).join(', ');
    return text(`Delegated to ${roles}${agents.length > 3 ? ` +${agents.length - 3}` : ''}`);
  },

  // ── Synth / code exec ─────────────────────────────────────────────────────
  synth_synthesize: (args) => text(`Synthesized: ${safeString(args?.task || args?.description || 'tool', 60)}`),
  code_execute: (args) => text(`Ran code${args?.language ? ` (${args.language})` : ''}`),
};

// ─── generic fallback summarizer ────────────────────────────────────────────

function genericSummarize(args: any, result: any, status?: ToolCallStatus): ToolSummary {
  if (status === 'pending') return text('Queued');
  if (status === 'executing') return text('Running…');
  if (status === 'failed') {
    const err = result?.error || result?.message || 'error';
    return text(`Failed — ${safeString(err, 80)}`);
  }
  if (status === 'rejected') return text('Rejected');

  const data = unwrapResult(result);

  if (data == null) return { kind: 'none' };
  if (typeof data === 'string') {
    if (data.length === 0) return text('Empty');
    return text(safeString(data, 100));
  }
  if (Array.isArray(data)) {
    return text(`${data.length} item${data.length === 1 ? '' : 's'}`);
  }
  if (typeof data === 'object') {
    if (data.success === false) return text(`Failed — ${safeString(data.error || data.message || 'error', 80)}`);
    // Count any first-level array field
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k])) {
        return text(`${data[k].length} ${k}`);
      }
    }
    if (typeof data.count === 'number') return text(`${data.count} result${data.count === 1 ? '' : 's'}`);
    return text('Completed');
  }

  return { kind: 'none' };
}

// ─── public API ─────────────────────────────────────────────────────────────

export function summarizeToolCall(
  toolName: string,
  args: any,
  result: any,
  status?: ToolCallStatus
): ToolSummary {
  // Don't compute success summaries for in-flight calls — use generic status
  if (status === 'pending' || status === 'executing') {
    return genericSummarize(args, result, status);
  }

  const fn = SUMMARIZERS[toolName];
  if (fn) {
    try {
      const summary = fn(args, result, status);
      if (summary && summary.kind !== 'none') {
        // Prepend failure prefix if applicable
        if (summary.kind === 'text' && (status === 'failed' || status === 'rejected')) {
          return { kind: 'text', text: `${statusPrefix(status)}${summary.text}` };
        }
        return summary;
      }
    } catch {
      /* fall through to generic */
    }
  }

  return genericSummarize(args, result, status);
}
