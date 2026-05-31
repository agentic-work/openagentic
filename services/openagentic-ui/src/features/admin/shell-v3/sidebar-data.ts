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
]

// Flatten — all leaves
export const ALL_LEAVES: AdminLeaf[] = ADMIN_NAV.flatMap((g) => g.leaves)

// Lookup helpers
export const leafById = (id: string): AdminLeaf | undefined =>
  ALL_LEAVES.find((l) => l.id === id)
export const leafByKey = (key: string): AdminLeaf | undefined =>
  ALL_LEAVES.find((l) => l.key === key)
