/**
 * ADMIN_PAGES registry — canonical list of all admin console page IDs.
 *
 * Rules:
 *   - Every entry in SIDEBAR_GROUPS must have a matching id here.
 *   - Every entry here must be reachable from the sidebar.
 *   - Keep in sync with sidebar-items.ts.
 */

export interface AdminPage {
  id: string;
  label: string;
}

export const ADMIN_PAGES: AdminPage[] = [
  // Top-level
  { id: 'overview', label: 'Dashboard Overview' },

  // System Management
  { id: 'users', label: 'User Management' },
  { id: 'settings', label: 'System Settings' },
  { id: 'rate-limits', label: 'Rate Limits' },

  // LLM
  { id: 'providers', label: 'Provider Management' },
  { id: 'llm-default-models', label: 'Default Models' },
  { id: 'model-management', label: 'Models' },
  { id: 'ollama', label: 'Ollama Hosts' },
  { id: 'tiered-fc', label: 'Tiered Function Calling' },
  { id: 'llm-router-tuning', label: 'Router Tuning' },
  { id: 'llm-performance', label: 'Performance Metrics' },

  // Tools Management
  { id: 'mcp-management', label: 'Server Management' },
  { id: 'mcp-logs', label: 'Call Logs' },
  { id: 'mcp-kubernetes', label: 'Kubernetes' },
  { id: 'synth-management', label: 'Synthesis Config' },
  { id: 'synth-approvals', label: 'Synthesis Approvals' },
  { id: 'synth-stats', label: 'Synthesis Stats' },
  { id: 'tool-execution-mode', label: 'Tool Execution Mode' },

  // OpenAgentic Flows
  { id: 'native-workflow-list', label: 'All Workflows' },
  { id: 'native-execution-list', label: 'All Executions' },
  { id: 'native-workflow-costs', label: 'Flow Costs' },
  { id: 'native-workflow-credentials', label: 'Credentials' },
  { id: 'native-workflow-settings', label: 'Governance' },
  { id: 'flows-kpis', label: 'KPI Dashboard' },
  { id: 'flows-audit-logs', label: 'Audit Logs' },
  { id: 'teams', label: 'Teams' },

  // Code Mode
  { id: 'codemode-settings', label: 'Settings' },
  { id: 'codemode-global', label: 'Global Settings' },
  { id: 'codemode-mcp', label: 'MCP Servers' },
  { id: 'codemode-skills', label: 'Skills & Plugins' },
  { id: 'codemode-users', label: 'Users & Sessions' },
  { id: 'openagentic-metrics', label: 'Metrics' },

  // Agent Management
  { id: 'agent-registry', label: 'Agent Registry' },
  { id: 'agent-ops', label: 'AgentOps' },
  { id: 'agent-skills', label: 'Skills & Plugins' },
  { id: 'agent-executions', label: 'Agent Observability' },

  // Integrations
  { id: 'slack-integration', label: 'Slack' },
  { id: 'teams-integration', label: 'Microsoft Teams' },
  { id: 'integration-logs', label: 'Integration Logs' },

  // Prompt Engineering
  { id: 'prompt-modules', label: 'Prompt Modules' },
  { id: 'prompt-effectiveness', label: 'Effectiveness' },
  { id: 'prompt-metrics', label: 'Prompt Metrics' },

  // Content & Data
  { id: 'templates', label: 'Chat Templates' },
  { id: 'pipeline-settings', label: 'Pipeline Settings' },
  { id: 'shared-kb', label: 'Shared Knowledge Base' },
  { id: 'data-layer', label: 'Unified Data Layer' },
  { id: 'user-context', label: 'User Memory' },

  // Chargeback & Costs
  { id: 'chargeback-dashboard', label: 'Cost Management' },

  // Monitoring & Logs
  { id: 'user-activity', label: 'User Activity' },
  { id: 'analytics', label: 'Usage Analytics' },
  { id: 'feedback', label: 'Feedback Analytics' },
  { id: 'audit', label: 'Audit Logs' },
  { id: 'errors', label: 'Monitoring & Logs' },
  { id: 'context-window', label: 'Context Window Metrics' },
  { id: 'embeddings', label: 'Embedding Metrics' },
  { id: 'cluster-health', label: 'Cluster Health' },
  { id: 'grafana', label: 'Grafana Dashboards' },
  { id: 'test-harness', label: 'Test Harness' },

  // Security & Access
  { id: 'auth-access', label: 'Auth Access Control' },
  { id: 'permissions', label: 'User Permissions' },
  { id: 'user-lockout', label: 'User Lockouts' },
  { id: 'tokens', label: 'API Token Management' },
  { id: 'network', label: 'Network Security' },
  { id: 'webhook-security', label: 'Webhook Security' },
  { id: 'dlp-config', label: 'DLP Configuration' },
];
