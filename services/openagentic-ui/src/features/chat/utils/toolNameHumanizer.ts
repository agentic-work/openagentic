/**
 * Tool Name Humanizer
 * Maps raw MCP tool names to human-readable labels with category badges.
 *
 * Uses CSS variable-based colors instead of Tailwind classes for
 * consistent theming across light/dark modes.
 */

export interface HumanizedTool {
  label: string;
  category: string;
  color: string; // CSS color string using CSS variables
  activeForm?: string; // Present-continuous form shown during execution (e.g., "Fetching Azure costs")
}

// ---------------------------------------------------------------------------
// Category color palette using CSS custom properties
// Each category gets a distinct hue via color-mix for theme adaptability.
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  Kubernetes:    'color-mix(in srgb, #3B82F6 85%, transparent)',     // Blue
  Azure:         'color-mix(in srgb, #0284C7 85%, transparent)',     // Sky
  AWS:           'color-mix(in srgb, #F97316 85%, transparent)',     // Orange
  GCP:           'color-mix(in srgb, #EF4444 85%, transparent)',     // Red
  Web:           'color-mix(in srgb, #16A34A 85%, transparent)',     // Green
  GitHub:        'color-mix(in srgb, #6B7280 90%, transparent)',     // Gray
  Platform:      'color-mix(in srgb, #9333EA 85%, transparent)',     // Purple
  Memory:        'color-mix(in srgb, #6366F1 85%, transparent)',     // Indigo
  Diagrams:      'color-mix(in srgb, #14B8A6 85%, transparent)',     // Teal
  Workflows:     'color-mix(in srgb, #EA580C 85%, transparent)',     // Orange
  Monitoring:    'color-mix(in srgb, #E11D48 85%, transparent)',     // Rose
  Orchestration: 'color-mix(in srgb, #7C3AED 85%, transparent)',     // Violet
  Synth:         'color-mix(in srgb, #0891B2 85%, transparent)',     // Cyan
  Database:      'color-mix(in srgb, #0D9488 85%, transparent)',     // Teal-dark
  Security:      'color-mix(in srgb, #DC2626 85%, transparent)',     // Red-dark
  Network:       'color-mix(in srgb, #2563EB 85%, transparent)',     // Blue-dark
  Tool:          'color-mix(in srgb, #6B7280 85%, transparent)',     // Gray fallback
};

/**
 * Get the CSS color string for a category name.
 * Returns a color-mix expression that works in any theme.
 */
export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Tool;
}

const c = (category: string) => CATEGORY_COLORS[category] || CATEGORY_COLORS.Tool;

const TOOL_MAP: Record<string, HumanizedTool> = {
  // Kubernetes
  k8s_cluster_health: { label: 'Cluster Health', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Checking cluster health' },
  k8s_list_pods: { label: 'List Pods', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Listing Kubernetes pods' },
  k8s_list_namespaces: { label: 'List Namespaces', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Listing namespaces' },
  k8s_list_deployments: { label: 'List Deployments', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Listing deployments' },
  k8s_get_pod_logs: { label: 'Pod Logs', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Fetching pod logs' },
  k8s_list_services: { label: 'List Services', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Listing services' },
  k8s_list_nodes: { label: 'List Nodes', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Listing nodes' },
  k8s_scale_deployment: { label: 'Scale Deployment', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Scaling deployment' },
  k8s_apply_manifest: { label: 'Apply Manifest', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Applying manifest' },
  k8s_get_events: { label: 'Get Events', category: 'Kubernetes', color: c('Kubernetes'), activeForm: 'Fetching events' },

  // Azure
  azure_arm_execute: { label: 'ARM Execute', category: 'Azure', color: c('Azure'), activeForm: 'Executing Azure operation' },
  azure_arm_execute_and_wait: { label: 'ARM Execute & Wait', category: 'Azure', color: c('Azure'), activeForm: 'Provisioning Azure resource' },
  azure_graph_execute: { label: 'Graph Execute', category: 'Azure', color: c('Azure'), activeForm: 'Querying Azure Graph' },
  azure_list_vms: { label: 'List VMs', category: 'Azure', color: c('Azure'), activeForm: 'Listing Azure VMs' },
  azure_list_users: { label: 'List Users', category: 'Azure', color: c('Azure'), activeForm: 'Listing Azure AD users' },
  azure_get_user: { label: 'Get User', category: 'Azure', color: c('Azure'), activeForm: 'Getting user details' },
  azure_list_groups: { label: 'List Groups', category: 'Azure', color: c('Azure'), activeForm: 'Listing Azure AD groups' },
  azure_list_apps: { label: 'List Apps', category: 'Azure', color: c('Azure'), activeForm: 'Listing Azure applications' },
  azure_list_subscriptions: { label: 'List Subscriptions', category: 'Azure', color: c('Azure'), activeForm: 'Listing Azure subscriptions' },
  azure_list_resource_groups: { label: 'List Resource Groups', category: 'Azure', color: c('Azure'), activeForm: 'Listing resource groups' },
  azure_cost_forecast: { label: 'Cost Forecast', category: 'Azure', color: c('Azure'), activeForm: 'Forecasting Azure costs' },
  azure_cost_summary: { label: 'Cost Summary', category: 'Azure', color: c('Azure'), activeForm: 'Fetching Azure cost summary' },
  azure_cost_by_service: { label: 'Cost By Service', category: 'Azure', color: c('Azure'), activeForm: 'Fetching Azure costs by service' },
  azure_cost_query: { label: 'Cost Query', category: 'Azure', color: c('Azure'), activeForm: 'Querying Azure cost data' },
  azure_start_vm: { label: 'Start VM', category: 'Azure', color: c('Azure'), activeForm: 'Starting Azure VM' },
  azure_stop_vm: { label: 'Stop VM', category: 'Azure', color: c('Azure'), activeForm: 'Stopping Azure VM' },
  azure_restart_vm: { label: 'Restart VM', category: 'Azure', color: c('Azure'), activeForm: 'Restarting Azure VM' },
  azure_get_vm: { label: 'Get VM', category: 'Azure', color: c('Azure'), activeForm: 'Getting VM details' },

  // AWS
  aws_execute: { label: 'AWS Execute', category: 'AWS', color: c('AWS'), activeForm: 'Executing AWS operation' },
  call_aws: { label: 'AWS CLI', category: 'AWS', color: c('AWS'), activeForm: 'Running AWS CLI command' },
  aws_s3_list: { label: 'S3 List', category: 'AWS', color: c('AWS'), activeForm: 'Listing S3 buckets' },
  aws_ec2_list: { label: 'EC2 List', category: 'AWS', color: c('AWS'), activeForm: 'Listing EC2 instances' },
  aws_cost_summary: { label: 'Cost Summary', category: 'AWS', color: c('AWS'), activeForm: 'Fetching AWS cost summary' },
  aws_cost_by_service: { label: 'Cost By Service', category: 'AWS', color: c('AWS'), activeForm: 'Fetching AWS costs by service' },
  aws_identity: { label: 'Identity', category: 'AWS', color: c('AWS'), activeForm: 'Checking AWS identity' },
  aws_list_accounts: { label: 'List Accounts', category: 'AWS', color: c('AWS'), activeForm: 'Listing AWS accounts' },
  aws_list_ec2: { label: 'List EC2', category: 'AWS', color: c('AWS'), activeForm: 'Listing EC2 instances' },
  aws_list_s3: { label: 'List S3', category: 'AWS', color: c('AWS'), activeForm: 'Listing S3 buckets' },
  suggest_aws_commands: { label: 'Suggest Commands', category: 'AWS', color: c('AWS'), activeForm: 'Suggesting AWS commands' },

  // GCP
  gcp_compute_list: { label: 'Compute List', category: 'GCP', color: c('GCP'), activeForm: 'Listing GCP compute instances' },
  gcp_storage_list: { label: 'Storage List', category: 'GCP', color: c('GCP'), activeForm: 'Listing GCP storage' },
  gcp_billing_query: { label: 'Billing Query', category: 'GCP', color: c('GCP'), activeForm: 'Querying GCP billing' },
  gcp_query_cost_usage: { label: 'Cost Usage', category: 'GCP', color: c('GCP'), activeForm: 'Querying GCP cost data' },

  // Web
  web_search: { label: 'Web Search', category: 'Web', color: c('Web'), activeForm: 'Searching the web' },
  web_fetch: { label: 'Fetch URL', category: 'Web', color: c('Web'), activeForm: 'Fetching web page' },
  web_news_search: { label: 'News Search', category: 'Web', color: c('Web'), activeForm: 'Searching news' },

  // GitHub
  github_list_repos: { label: 'List Repos', category: 'GitHub', color: c('GitHub') },
  github_create_pr: { label: 'Create PR', category: 'GitHub', color: c('GitHub') },
  github_list_issues: { label: 'List Issues', category: 'GitHub', color: c('GitHub') },
  github_search_code: { label: 'Search Code', category: 'GitHub', color: c('GitHub') },

  // Platform / Admin
  admin_system_infrastructure_health_check: { label: 'Health Check', category: 'Platform', color: c('Platform') },
  admin_system_get_config: { label: 'Get Config', category: 'Platform', color: c('Platform') },
  admin_system_list_users: { label: 'List Users', category: 'Platform', color: c('Platform') },
  admin_get_mcp_servers: { label: 'MCP Servers', category: 'Platform', color: c('Platform') },
  admin_health_check: { label: 'Health Check', category: 'Platform', color: c('Platform') },
  admin_system_status: { label: 'System Status', category: 'Platform', color: c('Platform') },
  admin_list_providers: { label: 'List Providers', category: 'Platform', color: c('Platform') },
  admin_get_rate_limits: { label: 'Rate Limits', category: 'Platform', color: c('Platform') },
  admin_get_metrics: { label: 'Get Metrics', category: 'Platform', color: c('Platform') },

  // Memory
  memory_store: { label: 'Store Memory', category: 'Memory', color: c('Memory') },
  memory_recall: { label: 'Recall Memory', category: 'Memory', color: c('Memory') },
  memory_forget: { label: 'Forget Memory', category: 'Memory', color: c('Memory') },
  memory_search: { label: 'Search Memory', category: 'Memory', color: c('Memory') },
  memory_add: { label: 'Add Memory', category: 'Memory', color: c('Memory') },

  // Diagrams
  create_diagram: { label: 'Create Diagram', category: 'Diagrams', color: c('Diagrams') },

  // Monitoring
  prometheus_query: { label: 'Prometheus Query', category: 'Monitoring', color: c('Monitoring') },
  loki_search_logs: { label: 'Search Logs', category: 'Monitoring', color: c('Monitoring') },

  // Database tools
  postgres_query: { label: 'Query', category: 'Database', color: c('Database') },
  postgres_list_tables: { label: 'List Tables', category: 'Database', color: c('Database') },
  postgres_describe: { label: 'Describe Table', category: 'Database', color: c('Database') },
  redis_get: { label: 'Redis Get', category: 'Database', color: c('Database') },
  redis_set: { label: 'Redis Set', category: 'Database', color: c('Database') },
  redis_keys: { label: 'Redis Keys', category: 'Database', color: c('Database') },
  milvus_search: { label: 'Vector Search', category: 'Database', color: c('Database') },
  milvus_insert: { label: 'Vector Insert', category: 'Database', color: c('Database') },
  milvus_query: { label: 'Vector Query', category: 'Database', color: c('Database') },
  milvus_list_collections: { label: 'List Collections', category: 'Database', color: c('Database') },

  // Agent delegation
  delegate_to_agents: { label: 'Delegate to Agents', category: 'Orchestration', color: c('Orchestration'), activeForm: 'Delegating to agents' },
  spawn_parallel_agents: { label: 'Spawn Agents', category: 'Orchestration', color: c('Orchestration'), activeForm: 'Orchestrating agents' },

  // Synth
  synth_synthesize: { label: 'Synthesize Tool', category: 'Synth', color: c('Synth') },
  synth_execute: { label: 'Execute Synth', category: 'Synth', color: c('Synth') },

  // Network / Security
  network_scan: { label: 'Network Scan', category: 'Network', color: c('Network') },
  network_policy_list: { label: 'List Policies', category: 'Network', color: c('Network') },
  security_audit: { label: 'Security Audit', category: 'Security', color: c('Security') },
};

const CATEGORY_PREFIXES: Record<string, { category: string; color: string }> = {
  k8s_: { category: 'Kubernetes', color: c('Kubernetes') },
  azure_: { category: 'Azure', color: c('Azure') },
  aws_: { category: 'AWS', color: c('AWS') },
  gcp_: { category: 'GCP', color: c('GCP') },
  web_: { category: 'Web', color: c('Web') },
  github_: { category: 'GitHub', color: c('GitHub') },
  admin_: { category: 'Platform', color: c('Platform') },
  memory_: { category: 'Memory', color: c('Memory') },
  prometheus_: { category: 'Monitoring', color: c('Monitoring') },
  loki_: { category: 'Monitoring', color: c('Monitoring') },
  synth_: { category: 'Synth', color: c('Synth') },
  postgres_: { category: 'Database', color: c('Database') },
  redis_: { category: 'Database', color: c('Database') },
  milvus_: { category: 'Database', color: c('Database') },
  network_: { category: 'Network', color: c('Network') },
  security_: { category: 'Security', color: c('Security') },
};

/**
 * Humanize a raw tool name into a readable label with category.
 */
export function humanizeToolName(rawName: string): HumanizedTool {
  // Exact match first
  const exact = TOOL_MAP[rawName];
  if (exact) return exact;

  // Prefix-based category detection
  for (const [prefix, meta] of Object.entries(CATEGORY_PREFIXES)) {
    if (rawName.startsWith(prefix)) {
      const remainder = rawName.slice(prefix.length);
      const label = remainder
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      // Auto-generate activeForm: "Running Azure List Vnets" → cleaner than nothing
      const activeForm = `${label.includes('List') ? 'Listing' : label.includes('Get') ? 'Getting' : label.includes('Create') ? 'Creating' : label.includes('Delete') ? 'Deleting' : 'Running'} ${meta.category} ${label.toLowerCase().replace(/^(list|get|create|delete)\s*/i, '')}`.trim();
      return { label, category: meta.category, color: meta.color, activeForm };
    }
  }

  // Fallback: strip known prefixes, title-case
  const cleaned = rawName
    .replace(/^(admin_system_|admin_|openagentic_)/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return { label: cleaned, category: 'Tool', color: c('Tool'), activeForm: `Running ${cleaned.toLowerCase()}` };
}
