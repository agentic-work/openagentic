export type Badge = 'Beta' | 'Live' | 'deprecated' | null

export type SidebarLeaf = {
  id: string
  label: string
  badge?: Badge
  externalUrl?: string
}

export type SidebarGroup = {
  id: string
  label: string
  /** If non-null, the group renders only when featureFlags[featureGate] is true. */
  featureGate?: 'mcp' | 'openagentic'
  children: SidebarLeaf[]
}

export const TOP_LEVEL_ITEMS: SidebarLeaf[] = [
  { id: 'overview', label: 'Dashboard Overview' },
]

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    id: 'system', label: 'System Management',
    children: [
      { id: 'users',            label: 'User Management' },
      { id: 'auth-access',      label: 'Auth Access Control' },
      { id: 'permissions',      label: 'User Permissions' },
      { id: 'user-lockout',     label: 'User Lockouts' },
      { id: 'tokens',           label: 'API Token Management' },
      { id: 'settings',         label: 'System Settings' },
      { id: 'rate-limits',      label: 'Rate Limits' },
      { id: 'network',          label: 'Network Security' },
      { id: 'webhook-security', label: 'Webhook Security' },
      { id: 'dlp-config',       label: 'DLP Configuration' },
    ],
  },
  {
    id: 'llm', label: 'LLM',
    children: [
      { id: 'providers',          label: 'Provider Management' },
      { id: 'llm-default-models', label: 'Default Models' },
      { id: 'model-management',   label: 'Models' },
      { id: 'ollama',             label: 'Ollama Hosts' },
      { id: 'tiered-fc',          label: 'Tiered Function Calling' },
      { id: 'llm-router-tuning',  label: 'Router Tuning' },
      { id: 'chat-loop-config',   label: 'Chat Loop Config' },
      { id: 'llm-performance',    label: 'Performance Metrics' },
    ],
  },
  {
    id: 'tools', label: 'Tools Management', featureGate: 'mcp',
    children: [
      { id: 'mcp-fleet',           label: 'MCP Fleet' },
      { id: 'synth-management',    label: 'Synthesis Config' },
      { id: 'synth-approvals',     label: 'Synthesis Approvals' },
      { id: 'synth-stats',         label: 'Synthesis Stats' },
      // Legacy leaves (mcp-management / mcp-logs / mcp-kubernetes /
      // tool-execution-mode) consolidated into MCP Fleet 2026-05-05.
      // Router still routes legacy ids to MCPFleet for bookmark
      // continuity until the next IA pass.
    ],
  },
  {
    id: 'native-workflows', label: 'OpenAgentic Flows',
    children: [
      { id: 'native-workflow-list',        label: 'All Workflows' },
      { id: 'native-execution-list',       label: 'All Executions' },
      { id: 'native-workflow-costs',       label: 'Flow Costs' },
      { id: 'native-workflow-credentials', label: 'Credentials' },
      { id: 'native-workflow-settings',    label: 'Governance' },
      { id: 'flows-kpis',                  label: 'KPI Dashboard', badge: 'Live' },
      { id: 'flows-audit-logs',            label: 'Audit Logs', badge: 'Live' },
      { id: 'teams',                       label: 'Teams', badge: 'Beta' },
    ],
  },
  {
    id: 'codemode', label: 'Code Mode', featureGate: 'openagentic',
    children: [
      { id: 'codemode-settings',  label: 'Settings' },
      { id: 'codemode-global',    label: 'Global Settings' },
      { id: 'codemode-mcp',       label: 'MCP Servers' },
      { id: 'codemode-skills',    label: 'Skills & Plugins' },
      { id: 'codemode-users',     label: 'Users & Sessions' },
      { id: 'openagentic-metrics', label: 'Metrics' },
    ],
  },
  {
    id: 'agent-management', label: 'Agent Management',
    children: [
      { id: 'agent-registry',   label: 'Agent Registry' },
      { id: 'agent-ops',        label: 'AgentOps', badge: 'Beta' },
      { id: 'agent-skills',     label: 'Skills & Plugins' },
      { id: 'agent-executions', label: 'Agent Observability' },
    ],
  },
  {
    id: 'integrations', label: 'Integrations',
    children: [
      { id: 'slack-integration', label: 'Slack' },
      { id: 'teams-integration', label: 'Microsoft Teams' },
      { id: 'integration-logs',  label: 'Integration Logs' },
    ],
  },
  {
    id: 'prompt-engineering', label: 'Prompt Engineering',
    children: [
      // Phase E.6 (2026-05-10) — 'prompt-modules' leaf removed.
      // PromptModule registry + PromptComposer ripped in Phase E.3/E.4;
      // admins edit the static system prompts under 'RBAC Templates'.
      { id: 'pipeline-settings',    label: 'Pipeline Settings' },
      { id: 'prompt-effectiveness', label: 'Effectiveness' },
      { id: 'prompt-metrics',       label: 'Prompt Metrics' },
      { id: 'rbac-system-prompts',  label: 'RBAC Templates' },
    ],
  },
  {
    id: 'content', label: 'Content & Data',
    children: [
      { id: 'templates',         label: 'Chat Templates' },
      { id: 'shared-kb',         label: 'Shared Knowledge Base', badge: 'Beta' },
      { id: 'data-layer',        label: 'Unified Data Layer' },
      { id: 'user-context',      label: 'User Memory' },
    ],
  },
  {
    id: 'chargeback', label: 'Chargeback & Costs',
    children: [
      { id: 'chargeback-dashboard', label: 'Cost Management' },
    ],
  },
  {
    id: 'monitoring', label: 'Monitoring & Logs',
    children: [
      { id: 'user-activity',  label: 'User Activity' },
      { id: 'analytics',      label: 'Usage Analytics' },
      { id: 'feedback',       label: 'Feedback Analytics' },
      { id: 'audit',          label: 'Audit Logs' },
      { id: 'errors',         label: 'Monitoring & Logs' },
      { id: 'context-window', label: 'Context Window Metrics' },
      { id: 'embeddings',     label: 'Embedding Metrics' },
      { id: 'cluster-health', label: 'Cluster Health', badge: 'Live' },
      { id: 'grafana',        label: 'Grafana Dashboards', badge: 'Live', externalUrl: '/grafana/' },
      { id: 'test-harness',   label: 'Test Harness',       badge: 'Live' },
    ],
  },
]

export function allSidebarIds(): string[] {
  return [
    ...TOP_LEVEL_ITEMS.map(i => i.id),
    ...SIDEBAR_GROUPS.flatMap(g => g.children.map(c => c.id)),
  ]
}
