export interface AdminLeaf {
  id: string
  key: string
  name: string
}

export interface AdminGroup {
  title: string
  leaves: AdminLeaf[]
}

export const ADMIN_NAV: AdminGroup[] = [
  {
    title: 'overview',
    leaves: [
      { id: 'dashboard', key: 'gd', name: 'Dashboard' },
    ],
  },
  {
    title: 'system management',
    leaves: [
      { id: 'users',             key: 'su', name: 'User Management' },
      { id: 'auth-access',       key: 'sa', name: 'Auth Access Control' },
      { id: 'permissions',       key: 'sp', name: 'User Permissions' },
      { id: 'user-lockouts',     key: 'sl', name: 'User Lockouts' },
      { id: 'tokens',            key: 'st', name: 'API Tokens' },
      { id: 'system-settings',   key: 'ss', name: 'System Settings' },
      { id: 'rate-limits',       key: 'sr', name: 'Rate Limits' },
      { id: 'network-security',  key: 'sn', name: 'Network Security' },
      { id: 'webhook-security',  key: 'sw', name: 'Webhook Security' },
      { id: 'dlp-config',        key: 'sd', name: 'DLP Configuration' },
    ],
  },
  {
    title: 'llm',
    leaves: [
      { id: 'providers',         key: 'lp', name: 'Provider Management' },
      { id: 'default-models',    key: 'ld', name: 'Default Models' },
      { id: 'model-management',  key: 'lm', name: 'Models' },
      { id: 'ollama',            key: 'lo', name: 'Ollama Hosts' },
      { id: 'tiered-fc',         key: 'lt', name: 'Tiered Function Calling' },
      { id: 'router-tuning',     key: 'lr', name: 'Router Tuning' },
      { id: 'llm-performance',   key: 'lf', name: 'Performance Metrics' },
    ],
  },
  {
    title: 'tools management',
    leaves: [
      { id: 'mcp-fleet',         key: 'tf', name: 'MCP Fleet' },
      { id: 'enriched-tools',    key: 'te', name: 'Enriched Tools' },
      { id: 'synth-management',  key: 'tc', name: 'Synthesis Config' },
      { id: 'synth-approvals',   key: 'ta', name: 'Synthesis Approvals' },
      { id: 'synth-stats',       key: 'ty', name: 'Synthesis Stats' },
    ],
  },
  {
    title: 'openagentic flows',
    leaves: [
      { id: 'workflows',                   key: 'fw', name: 'All Workflows' },
      { id: 'executions',                  key: 'fe', name: 'All Executions' },
      { id: 'flow-costs',                  key: 'fc', name: 'Flow Costs' },
      { id: 'credentials',                 key: 'fr', name: 'Credentials' },
      { id: 'governance',                  key: 'fg', name: 'Governance' },
      { id: 'kpi-dashboard',               key: 'fk', name: 'KPI Dashboard' },
      { id: 'audit-logs',                  key: 'fa', name: 'Audit Logs' },
      { id: 'teams',                       key: 'ft', name: 'Teams' },
    ],
  },
  {
    title: 'code mode',
    leaves: [
      { id: 'cm-settings',  key: 'cs', name: 'Settings' },
      { id: 'cm-global',    key: 'cg', name: 'Global Settings' },
      { id: 'cm-mcp',       key: 'cp', name: 'MCP Servers' },
      { id: 'cm-skills',    key: 'ck', name: 'Skills & Plugins' },
      { id: 'cm-users',     key: 'cu', name: 'Users & Sessions' },
      { id: 'cm-metrics',   key: 'cm', name: 'Metrics' },
    ],
  },
  {
    title: 'agent management',
    leaves: [
      { id: 'agent-registry',    key: 'ag', name: 'Agent Registry' },
      { id: 'agent-ops',         key: 'ao', name: 'AgentOps' },
      { id: 'agent-skills',      key: 'as', name: 'Skills & Plugins' },
      { id: 'agent-executions',  key: 'ax', name: 'Executions' },
    ],
  },
  {
    title: 'integrations',
    leaves: [
      { id: 'slack',             key: 'is', name: 'Slack' },
      { id: 'ms-teams',          key: 'it', name: 'Microsoft Teams' },
      { id: 'integration-logs',  key: 'il', name: 'Integration Logs' },
    ],
  },
  {
    title: 'prompts',
    leaves: [
      { id: 'prompt-modules',        key: 'pm', name: 'Modules' },
      { id: 'pipeline-settings',     key: 'pp', name: 'Pipeline Settings' },
      { id: 'prompt-effectiveness',  key: 'pe', name: 'Effectiveness' },
      { id: 'prompt-metrics',        key: 'px', name: 'Metrics' },
    ],
  },
  {
    title: 'content',
    leaves: [
      { id: 'templates',     key: 'nt', name: 'Templates' },
      { id: 'shared-kb',     key: 'nk', name: 'Shared Knowledge Base' },
      { id: 'data-layer',    key: 'nd', name: 'Unified Data Layer' },
      { id: 'user-memory',   key: 'nm', name: 'User Memory' },
    ],
  },
  {
    title: 'chargeback',
    leaves: [
      { id: 'chargeback', key: 'bc', name: 'Cost Management' },
    ],
  },
  {
    title: 'monitoring',
    leaves: [
      { id: 'user-activity',   key: 'ma', name: 'User Activity' },
      { id: 'analytics',       key: 'my', name: 'Usage Analytics' },
      { id: 'feedback',        key: 'mf', name: 'Feedback' },
      { id: 'audit',           key: 'md', name: 'Audit Logs' },
      { id: 'errors',          key: 'me', name: 'Monitoring & Errors' },
      { id: 'context-window',  key: 'mw', name: 'Context Window' },
      { id: 'embeddings',      key: 'mb', name: 'Embeddings' },
      { id: 'cluster-health',  key: 'mh', name: 'Cluster Health' },
      { id: 'test-harness',    key: 'mt', name: 'Test Harness' },
      // Phase 12 — V3 SLO panel (per-metric thresholds + live status)
      { id: 'slo',             key: 'ms', name: 'SLOs' },
      // Phase 13 — V3 Feedback advisory loop (aggregated thumbs feedback)
      { id: 'feedback-advisories', key: 'mv', name: 'Feedback Advisories' },
    ],
  },
]

// Flatten — all leaves
export const ALL_LEAVES: AdminLeaf[] = ADMIN_NAV.flatMap((g) => g.leaves)

// Lookup helpers
export const leafById = (id: string): AdminLeaf | undefined =>
  ALL_LEAVES.find((l) => l.id === id)
export const leafByKey = (key: string): AdminLeaf | undefined =>
  ALL_LEAVES.find((l) => l.key === key)
