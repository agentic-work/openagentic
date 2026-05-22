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

/**
 * Rich tool summary — used to render at-a-glance "what did this tool do"
 * with an icon + headline + a few badges + optional sub-items, all
 * rendered inline in the activity-stream success row. Click-to-expand
 * still shows the full input/output JSON.
 *
 * `icon` is an enum of known icon NAMES — the renderer maps it to a
 * component from `@/shared/icons` (no React deps in this file; pure
 * data). `primary` is the headline (e.g. resource name). `secondary`
 * is an optional dim subtitle (e.g. region, namespace). `badges` are
 * short pill labels (e.g. provisioning state, count). `items` is an
 * optional list of {title, url?, favicon?, hint?} for tools that
 * return multiple results (RAG hits, search results, resources
 * created in a batch).
 */
export type RichSummaryIcon =
  | 'database'      // RAG, query_data, list_datasets
  | 'brain'         // memory_recall
  | 'cloud'         // generic cloud
  | 'package'       // resource group / artifacts
  | 'server'        // VM
  | 'globe'         // network / web
  | 'lock'          // key vault / secrets
  | 'coins'         // cost / billing
  | 'shield'        // security / IAM
  | 'cpu'           // compute / k8s
  | 'hard-drive'    // storage
  | 'bot'           // delegate_to_agents
  | 'terminal'      // bash / shell
  | 'file-code'     // code / file ops
  | 'sparkles'      // AI/LLM / synthesis
  | 'image'         // image gen
  | 'search';       // generic search

export interface RichSummaryItem {
  title: string;
  url?: string;
  favicon?: string;
  hint?: string;
  /** Tiny status pill on the right of the item (e.g. "✓", "✕", "pending"). */
  badge?: string;
  badgeTone?: 'default' | 'success' | 'warn' | 'danger' | 'info';
}

export interface RichSummary {
  kind: 'rich';
  icon: RichSummaryIcon;
  primary: string;
  secondary?: string;
  badges?: Array<{ label: string; tone?: 'default' | 'success' | 'warn' | 'danger' | 'info' }>;
  items?: RichSummaryItem[];
}

export type ToolSummary =
  | { kind: 'text'; text: string }
  | { kind: 'links'; items: Array<{ title: string; url: string; favicon?: string }> }
  | RichSummary
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

/**
 * Favicon URL — points at our server-side proxy (/api/favicon) so the
 * fetch goes through same-origin. In your environment airgap the Palo Alto TLS-decrypt
 * would silently break a direct call to www.google.com/s2/favicons; the
 * proxy also avoids leaking every URL the user visits through tools out
 * to Google. Proxy caches in Redis with 24h TTL and returns a placeholder
 * SVG when the upstream fetch fails. See openagentic-your-deployment#330 Tier 3.
 */
function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `/api/favicon?domain=${encodeURIComponent(domain)}`;
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

/**
 * Build a rich (icon + headline + badges + items) summary. Pass only the
 * fields you need — secondary, badges, items are all optional. The
 * renderer (SummaryRich in AgenticActivityStream.tsx) collapses gracefully
 * when fewer fields are populated.
 */
function rich(
  icon: RichSummaryIcon,
  primary: string,
  opts: {
    secondary?: string;
    badges?: Array<{ label: string; tone?: 'default' | 'success' | 'warn' | 'danger' | 'info' }>;
    items?: RichSummaryItem[];
  } = {},
): ToolSummary {
  return { kind: 'rich', icon, primary, secondary: opts.secondary, badges: opts.badges, items: opts.items };
}

/**
 * Map a service / resource type to a known icon name. The renderer
 * (SummaryRich) resolves the name to a component from `@/shared/icons`.
 */
function cloudIcon(service: string): RichSummaryIcon {
  const s = (service || '').toLowerCase();
  if (s.includes('vm') || s.includes('virtual_machine') || s.includes('compute')) return 'server';
  if (s.includes('storage') || s.includes('blob') || s.includes('s3') || s.includes('bucket')) return 'hard-drive';
  if (s.includes('keyvault') || s.includes('key_vault') || s.includes('secret')) return 'lock';
  if (s.includes('network') || s.includes('vnet') || s.includes('vpc') || s.includes('subnet')) return 'globe';
  if (s.includes('aks') || s.includes('eks') || s.includes('gke') || s.includes('kubernetes') || s.includes('k8s')) return 'cpu';
  if (s.includes('function') || s.includes('lambda')) return 'sparkles';
  if (s.includes('web_app') || s.includes('app_service') || s.includes('container_app')) return 'globe';
  if (s.includes('database') || s.includes('sql') || s.includes('cosmos') || s.includes('rds') || s.includes('postgres')) return 'database';
  if (s.includes('cost') || s.includes('billing') || s.includes('budget')) return 'coins';
  if (s.includes('resource_group') || s.includes('rg')) return 'package';
  if (s.includes('iam') || s.includes('role') || s.includes('user') || s.includes('identity')) return 'shield';
  if (s.includes('image') || s.includes('photo')) return 'image';
  if (s.includes('foundry') || s.includes('llm') || s.includes('model')) return 'sparkles';
  return 'cloud';
}

/**
 * Provisioning-state → tone mapping for cloud-create result badges.
 */
function provisioningTone(state: string | undefined): 'success' | 'warn' | 'danger' | 'default' {
  const s = (state || '').toLowerCase();
  if (s === 'succeeded' || s === 'available' || s === 'running' || s === 'active') return 'success';
  if (s === 'failed' || s === 'error') return 'danger';
  if (s === 'creating' || s === 'updating' || s === 'pending' || s === 'in_progress') return 'warn';
  return 'default';
}

/**
 * Best-effort domain extraction for favicon/title pairs.
 */
function tryDomain(url: string | undefined): string {
  try { return url ? new URL(url).hostname : ''; } catch { return ''; }
}

const SUMMARIZERS: Record<string, Summarizer> = {
  // ── Azure ─────────────────────────────────────────────────────────────────
  azure_create_resource_group: (args, r) => {
    const data = unwrapResult(r) || {};
    const name = data.name || args?.name || args?.resource_group_name || args?.resourceGroupName || '?';
    const loc = data.location || args?.location || args?.region || '';
    const state = data.properties?.provisioningState || data.provisioning_state;
    return rich('package', `Resource group ${name}`, {
      secondary: loc ? `Created in ${loc}` : 'Created',
      badges: state ? [{ label: state, tone: provisioningTone(state) }] : [],
    });
  },
  azure_delete_resource_group: (args) => text(`Deleted resource group ${args?.name || args?.resource_group || '?'}`),
  azure_create_web_app: (args) => text(`Web app ${args?.name || args?.app_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_function_app: (args) => text(`Function app ${args?.name || args?.function_app_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_container_app: (args) => text(`Container app ${args?.name || '?'} created${args?.resource_group ? ` in ${args.resource_group}` : ''}`),
  azure_create_app_service_plan: (args) => text(`App Service plan ${args?.name || '?'} created${args?.sku ? ` (${args.sku})` : ''}`),
  azure_create_storage_account: (args) => text(`Storage account ${args?.name || args?.account_name || '?'} created${args?.location ? ` in ${args.location}` : ''}`),
  azure_create_key_vault: (args) => text(`Key Vault ${args?.name || '?'} created`),
  azure_create_vm: (args, r) => {
    const data = unwrapResult(r) || {};
    const name = data.name || args?.name || args?.vm_name || '?';
    const size = data.properties?.hardwareProfile?.vmSize || args?.size;
    const loc = data.location || args?.location;
    const state = data.properties?.provisioningState;
    return rich('server', `VM ${name}`, {
      secondary: loc ? `${loc}${size ? ` · ${size}` : ''}` : (size || undefined),
      badges: state ? [{ label: state, tone: provisioningTone(state) }] : [],
    });
  },
  azure_storage_account_set_public_access: (args) => text(`Public access ${args?.allow_public_access === false ? 'disabled' : 'enabled'} on ${args?.name || args?.account_name || '?'}`),
  azure_list_subscriptions: (_a, r) => {
    const data = unwrapResult(r);
    // SoT precedence: array length > count field. The oap-azure-mcp
    // server always sets `count = len(subscriptions)`; if the envelope/
    // wire path drops the array but keeps count, trust count rather
    // than emitting a misleading "0 subscriptions" badge.
    let n = countArray(data, ['subscriptions', 'value']);
    if (n == null && typeof data?.count === 'number') n = data.count;
    if (n == null && typeof data?.total === 'number') n = data.total;
    // If we couldn't determine count from any payload field (the tool
    // result didn't flow through to the badge — see contentBlocks
    // contains tool_use only, no tool_result blocks; 2026-05-12 live),
    // return an empty summary rather than a misleading "0 subscriptions"
    // when the model body text shows N>0 subs.
    if (n == null) return { kind: 'none' };
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
    const breakdown = Array.isArray(data?.breakdown) ? data.breakdown : [];
    if (typeof total === 'number') {
      // Top 3 services from breakdown
      const items = breakdown
        .slice()
        .sort((a: any, b: any) => (b.cost ?? 0) - (a.cost ?? 0))
        .slice(0, 3)
        .map((b: any) => ({
          title: safeString(b.service || b.name || 'service', 30),
          hint: typeof b.cost === 'number' ? `$${b.cost.toFixed(2)}` : undefined,
        }));
      return rich('coins', `$${total.toFixed(2)} ${cur}`, {
        secondary: args?.timeframe ? args.timeframe : 'Last 30 days',
        items: items.length > 0 ? items : undefined,
      });
    }
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
    const memories = data?.memories || data?.results || [];
    const n = Array.isArray(memories) ? memories.length : 0;
    if (n === 0) return text(`No memories found${args?.query ? ` for "${safeString(args.query, 40)}"` : ''}`);
    return rich('brain', `${n} memor${n === 1 ? 'y' : 'ies'} recalled`, {
      secondary: args?.query ? `“${safeString(args.query, 50)}”` : undefined,
      badges: [{ label: `${n}`, tone: 'info' }],
      items: memories.slice(0, 3).map((m: any) => ({
        title: safeString(m.title || m.key || m.summary || m.content || 'memory', 60),
        hint: m.collection || m.source || m.namespace,
      })),
    });
  },
  memory_forget: (args) => text(`Forgot: ${safeString(args?.key || 'memory', 60)}`),

  // ── RAG ───────────────────────────────────────────────────────────────────
  // Rendered as a rich "📚 N docs from <collections>" summary with the top
  // source filenames as items. Triggered both by the canonical key and
  // (via fuzzy lookup) by the synthesized "RAG Knowledge (N docs)" tool
  // name emitted from useSSEChat.ts when the rag.stage event arrives.
  rag_context: (args, r) => {
    // Synthetic RAG steps from useSSEChat.ts (rag_context SSE event)
    // store their payload on `args` (the JSON-stringified content set
    // when the block was synthesized at retrieval time) — there's no
    // separate tool_result event for them. Fall back to `args` when
    // `r` is empty.
    const data = unwrapResult(r) || args || {};
    const docs = data.docsRetrieved ?? data.docs_count ?? data.documents?.length ?? 0;
    const collections = Array.isArray(data.collections) ? data.collections : [];
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const ms = data.retrievalTime ?? data.retrieval_time;
    return rich('database', `${docs} doc${docs === 1 ? '' : 's'} retrieved`, {
      secondary: collections.length ? collections.slice(0, 2).join(', ') + (collections.length > 2 ? ` +${collections.length - 2}` : '') : undefined,
      badges: [
        ...(typeof ms === 'number' ? [{ label: `${Math.round(ms)}ms`, tone: 'default' as const }] : []),
        ...(collections.length ? [{ label: `${collections.length} coll`, tone: 'info' as const }] : []),
      ],
      items: sources.slice(0, 5).map((s: any) => ({
        title: safeString(s.title || s.filename || s.file || s.name || s.id || s.content || 'source', 50),
        hint: s.collection || s.source || s.path || s.url,
      })),
    });
  },

  // ── Data layer ────────────────────────────────────────────────────────────
  query_data: (args, r) => {
    const data = unwrapResult(r);
    const rows = countArray(data, ['rows', 'results', 'data']) ?? data?.row_count ?? 0;
    return rich('database', `${rows} row${rows === 1 ? '' : 's'}`, {
      secondary: args?.dataset_id || args?.table || undefined,
      badges: rows > 0 ? [{ label: `${rows}`, tone: 'info' }] : [],
    });
  },
  list_datasets: (_a, r) => {
    const data = unwrapResult(r);
    const datasets = data?.datasets || data?.items || [];
    const n = Array.isArray(datasets) ? datasets.length : 0;
    return rich('database', `${n} dataset${n === 1 ? '' : 's'}`, {
      items: datasets.slice(0, 4).map((d: any) => ({
        title: safeString(d.name || d.id || 'dataset', 50),
        hint: d.description || d.source,
      })),
    });
  },

  // ── Images ────────────────────────────────────────────────────────────────
  generate_image: (args) => text(`Generated image: "${safeString(args?.prompt || '', 60)}"`),

  // ── Delegation ────────────────────────────────────────────────────────────
  // execute-sync returns `{ results: [{ role, output, status }], total_cost_cents,
  // total_tokens, total_duration_ms }`. Tier 4 of openagentic-your-deployment#330: surface
  // each sub-agent's first line of output instead of just status ticks, so
  // users see what each agent actually concluded without hunting JSON.
  delegate_to_agents: (args, r) => {
    const agents = Array.isArray(args?.agents) ? args.agents : [];
    if (agents.length === 0) return text('Delegated to agents');
    const data = unwrapResult(r);
    const results = Array.isArray(data?.results) ? data.results : [];
    const totalCostUsd = typeof data?.total_cost_cents === 'number' ? data.total_cost_cents / 100 : undefined;
    const totalTokens = typeof data?.total_tokens === 'number' ? data.total_tokens : undefined;
    const totalDurationMs = typeof data?.total_duration_ms === 'number' ? data.total_duration_ms : undefined;

    const successCount = results.filter((x: any) => x?.status === 'success').length;
    const failedCount = results.filter((x: any) => x?.status === 'failed' || x?.status === 'error').length;

    /** Reduce a sub-agent's output to a single glanceable line. */
    const firstLine = (output: unknown): string | undefined => {
      if (output == null) return undefined;
      const s = typeof output === 'string' ? output : JSON.stringify(output);
      const trimmed = s.replace(/^#+\s*/, '').trim();
      const line = trimmed.split(/\r?\n/).find((ln) => ln.trim().length > 0) || trimmed;
      return safeString(line, 120);
    };

    const badges: Array<{ label: string; tone?: 'default' | 'success' | 'warn' | 'danger' | 'info' }> = [];
    if (successCount > 0) badges.push({ label: `${successCount} ✓`, tone: 'success' });
    if (failedCount > 0) badges.push({ label: `${failedCount} ✕`, tone: 'danger' });
    if (typeof totalCostUsd === 'number' && totalCostUsd > 0) {
      badges.push({ label: `$${totalCostUsd.toFixed(4)}`, tone: 'info' });
    }
    if (typeof totalTokens === 'number' && totalTokens > 0) {
      badges.push({ label: `${totalTokens.toLocaleString()} tok`, tone: 'info' });
    }
    if (typeof totalDurationMs === 'number' && totalDurationMs > 0) {
      const sec = (totalDurationMs / 1000).toFixed(1);
      badges.push({ label: `${sec}s`, tone: 'info' });
    }

    return rich('bot', `${agents.length} agent${agents.length === 1 ? '' : 's'}`, {
      secondary:
        agents.map((a: any) => a?.role || 'agent').slice(0, 3).join(', ') +
        (agents.length > 3 ? ` +${agents.length - 3}` : ''),
      badges: badges.length > 0 ? badges : undefined,
      items: agents.slice(0, 6).map((a: any, i: number) => {
        const rr = results[i];
        const status = rr?.status;
        const ok = status === 'success';
        const fail = status === 'failed' || status === 'error';
        // Prefer the sub-agent's first line of output as the visible hint;
        // fall back to its task, then to a status tick/label.
        const hint =
          firstLine(rr?.output) ||
          (a?.task ? safeString(a.task, 120) : undefined) ||
          (ok ? '✓' : fail ? '✕' : status) ||
          undefined;
        return {
          title: safeString(a?.role || 'agent', 40),
          hint,
          badge: ok ? '✓' : fail ? '✕' : undefined,
          badgeTone: ok ? 'success' : fail ? 'danger' : undefined,
        };
      }),
    });
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

  // Fuzzy lookup: some synthesized "tool" steps don't carry a clean MCP id
  // in toolName (e.g. RAG retrieval is currently labeled
  // "RAG Knowledge (5 docs)" — see useSSEChat.ts:2209). Match a known
  // prefix into the registry so they get rich summaries too.
  const lookupKey = SUMMARIZERS[toolName]
    ? toolName
    : /^rag[\s_-]?knowledge|^rag_context/i.test(toolName)
      ? 'rag_context'
      : toolName;

  const fn = SUMMARIZERS[lookupKey];
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
