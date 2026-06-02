/**
 * Admin AI corpus — terse "what does this page do" summaries for every
 * sidebar slug, used as system-prompt context by the Admin AI handler so
 * answers can deep-link with [Open Page Name](#slug) tokens.
 *
 * Keep entries short. The full set is shipped in every prompt; bloating
 * pushes the LLM context window.
 */

export interface AdminPageEntry {
  slug: string;
  label: string;
  group: string;
  purpose: string;
}

export const ADMIN_PAGE_CORPUS: AdminPageEntry[] = [
  // Overview
  { slug: 'overview', label: 'Dashboard Overview', group: 'Overview',
    purpose: 'Top-level platform metrics: total users, chat sessions, messages, code sessions, flow executions, agent runs, token totals, cost, API request volume, MCP tool calls, images generated, plus charts and per-model cost sankey.' },

  // System Management
  { slug: 'users', label: 'User Management', group: 'System',
    purpose: 'List/create/disable users, view their groups, set per-user token caps, see last-active. Source for all per-user policy enforcement.' },
  { slug: 'settings', label: 'System Settings', group: 'System',
    purpose: 'Tenant-wide configuration: feature flags, default routing thresholds, telemetry destinations.' },
  { slug: 'rate-limits', label: 'Rate Limits', group: 'System',
    purpose: 'Per-route rate limits (chat sessions, chat stream, admin endpoints). Enforced at the Fastify request layer.' },

  // LLM
  { slug: 'providers', label: 'Provider Management', group: 'LLM',
    purpose: 'CRUD for LLM providers (Azure AI Foundry, Vertex AI, AWS Bedrock, Ollama). Adding a provider only stores credentials + runs a health probe — does NOT auto-import its model catalog. Models must be added explicitly via Models → +Add Model (except AIF/Ollama which auto-import deployed models only).' },
  { slug: 'llm-default-models', label: 'Default Models', group: 'LLM',
    purpose: 'Tenant-wide fallback models per category (chat, code, embedding, vision, image-gen). Applied when a request has no explicit pin.' },
  { slug: 'model-management', label: 'Models', group: 'LLM',
    purpose: 'The Model Registry — the single source of truth (admin.model_role_assignments). Every model that any agent or the Smart Router can pick MUST live here with enabled=true and an enabled provider. Has 3 tabs: Model Registry (curated set), Model Garden (browse provider catalog to add), Playground (interactive test).' },
  { slug: 'ollama', label: 'Ollama Hosts', group: 'LLM',
    purpose: 'Manage Ollama instances. Models deployed on a connected host auto-populate the Registry; pulled-from-host removals soft-disable Registry rows.' },
  { slug: 'tiered-fc', label: 'Tiered Function Calling', group: 'LLM',
    purpose: 'Maps every chat request needing tools into one of 3 tiers (economy/balanced/premium). Tier composition is the single largest cost lever — tier choice determines which Registry rows the Smart Router scores.' },
  { slug: 'llm-router-tuning', label: 'Router Tuning', group: 'LLM',
    purpose: 'Smart-Router scoring weights: latency vs FCA vs cost. Tunes how the Registry-eligible candidate pool gets ranked. Does NOT change the candidate set — Registry does that.' },
  { slug: 'llm-performance', label: 'Performance Metrics', group: 'LLM',
    purpose: 'Latency percentiles, throughput, cost attribution, provider health, per-model comparison, Router Health (Prometheus). Read-only.' },

  // Tools Management
  { slug: 'mcp-management', label: 'Server Management', group: 'Tools',
    purpose: 'Register/edit MCP servers (azure, aws, github, etc.), test connectivity, set per-server access policy.' },
  { slug: 'mcp-logs', label: 'Call Logs', group: 'Tools',
    purpose: 'Per-tool invocation log: who called what tool with what args, return status, duration, cost.' },
  { slug: 'mcp-kubernetes', label: 'Kubernetes', group: 'Tools',
    purpose: 'In-cluster MCP server pod status, restart counts, recent logs.' },
  { slug: 'synth-management', label: 'Synthesis Config', group: 'Tools',
    purpose: 'Tool-synthesis pipeline configuration (auto-generate MCP tools from OpenAPI specs / docs).' },
  { slug: 'synth-approvals', label: 'Synthesis Approvals', group: 'Tools',
    purpose: 'Review/approve auto-generated MCP tools before they go live.' },
  { slug: 'synth-stats', label: 'Synthesis Stats', group: 'Tools',
    purpose: 'Counts of synthesized tools per source, success rates, time-to-approve.' },
  { slug: 'tool-execution-mode', label: 'Tool Execution Mode', group: 'Tools',
    purpose: 'Per-tool risk gate (auto/HITL/blocked). Controls when a human approval is required before execution.' },

  // OpenAgentic Flows
  { slug: 'native-workflow-list', label: 'All Workflows', group: 'Flows',
    purpose: 'Workflow catalog — list, create, edit, delete native OpenAgentic flows.' },
  { slug: 'native-execution-list', label: 'All Executions', group: 'Flows',
    purpose: 'Per-execution log: status, duration, cost, error trace.' },
  { slug: 'native-workflow-costs', label: 'Flow Costs', group: 'Flows',
    purpose: 'Cost breakdown by workflow + per-node cost trend over time.' },
  { slug: 'native-workflow-credentials', label: 'Credentials', group: 'Flows',
    purpose: 'Vault-backed credential refs that flows can use (no plaintext stored).' },
  { slug: 'native-workflow-settings', label: 'Governance', group: 'Flows',
    purpose: 'Per-flow approval policy, namespace assignment, owner, retention.' },
  { slug: 'flows-kpis', label: 'KPI Dashboard', group: 'Flows',
    purpose: 'Live flow KPIs: success rate, avg cost, top failing nodes, top expensive flows.' },
  { slug: 'flows-audit-logs', label: 'Audit Logs', group: 'Flows',
    purpose: 'Live audit trail of who edited what flow when.' },
  { slug: 'teams', label: 'Teams', group: 'Flows',
    purpose: 'Team-scoped workflow ownership (beta).' },

  // Agent Management
  { slug: 'agent-registry', label: 'Agent Registry', group: 'Agents',
    purpose: 'Catalog of agent definitions: type, primary model, system prompt, prompt_modules composition.' },
  { slug: 'agent-skills', label: 'Skills & Plugins', group: 'Agents',
    purpose: 'Reusable skill bundles agents can compose.' },
  { slug: 'agent-executions', label: 'Agent Observability', group: 'Agents',
    purpose: 'Per-agent execution traces: tool calls, sub-agent dispatch, token usage.' },

  // Integrations
  { slug: 'slack-integration', label: 'Slack', group: 'Integrations', purpose: 'Slack app installation, channel allow-list, command routing.' },
  { slug: 'teams-integration', label: 'Microsoft Teams', group: 'Integrations', purpose: 'Teams bot installation + channel routing.' },
  { slug: 'integration-logs', label: 'Integration Logs', group: 'Integrations', purpose: 'Cross-integration request/error log.' },

  // Prompt Engineering
  { slug: 'prompt-modules', label: 'Prompt Modules', group: 'Prompts',
    purpose: 'Composable system-prompt building blocks. Agents reference module ids in prompt_modules and the loader concatenates at runtime.' },
  { slug: 'prompt-effectiveness', label: 'Effectiveness', group: 'Prompts',
    purpose: 'Per-prompt-module success/failure rates derived from agent feedback.' },
  { slug: 'prompt-metrics', label: 'Prompt Metrics', group: 'Prompts',
    purpose: 'Token usage + latency + cost per prompt template.' },
  // 'prompts' (Legacy Templates) was retired; the corresponding sidebar
  // entry is gone, so listing it here would emit dead deep-links. Use
  // 'prompt-modules' instead.

  // Content & Data
  { slug: 'templates', label: 'Chat Templates', group: 'Content',
    purpose: 'Saved canned chat starts admins can publish to all users (e.g., onboarding).' },
  { slug: 'pipeline-settings', label: 'Pipeline Settings', group: 'Content',
    purpose: 'Chat pipeline stage toggles: DLP scan, RAG injection, tool gating, image moderation.' },
  { slug: 'shared-kb', label: 'Shared Knowledge Base', group: 'Content',
    purpose: 'Tenant-wide RAG corpus: upload docs, manage embeddings, query test (beta).' },
  { slug: 'data-layer', label: 'Unified Data Layer', group: 'Content',
    purpose: 'Status of pgvector, Milvus, Redis. Re-index controls.' },
  { slug: 'user-context', label: 'User Memory', group: 'Content',
    purpose: 'Per-user long-term memory entries (UserMemoryService). Inspect / clear.' },

  // Chargeback
  { slug: 'chargeback-dashboard', label: 'Cost Management', group: 'Chargeback',
    purpose: 'Cost rollups by user, team, provider, model. Budgets and alerts.' },

  // Monitoring
  { slug: 'user-activity', label: 'User Activity', group: 'Monitoring',
    purpose: 'Per-user activity timeline: sessions, messages, last-active.' },
  { slug: 'analytics', label: 'Usage Analytics', group: 'Monitoring',
    purpose: 'Platform-wide usage rollups: sessions, tokens, cost, tool calls, P95/P99 latency, error rate, success rate.' },
  { slug: 'feedback', label: 'Feedback Analytics', group: 'Monitoring',
    purpose: 'Thumbs-up/down feedback aggregated per model + per agent.' },
  { slug: 'audit', label: 'Audit Logs', group: 'Monitoring',
    purpose: 'Filtered audit log query view (admin actions, sensitive events).' },
  // The standalone 'performance' Monitoring entry was folded into the
  // Dashboard Overview tabs; the deep-link slug is gone. Direct readers
  // who ask about latency/throughput at #llm-performance instead.
  { slug: 'errors', label: 'Monitoring & Logs', group: 'Monitoring',
    purpose: 'Error rate dashboards + recent error sample. Loki backend.' },
  { slug: 'context-window', label: 'Context Window Metrics', group: 'Monitoring',
    purpose: 'How much of each model context window is being consumed per request — surface bloat.' },
  { slug: 'embeddings', label: 'Embedding Metrics', group: 'Monitoring',
    purpose: 'Embedding query latency, dimension distribution, model used per request.' },
  { slug: 'grafana', label: 'Grafana Dashboards', group: 'Monitoring',
    purpose: 'External link to the Grafana stack for deep ops dashboards.' },
  { slug: 'test-harness', label: 'Test Harness', group: 'Monitoring',
    purpose: 'Run UC test suites against this cluster from the admin UI.' },

  // Security
  { slug: 'auth-access', label: 'Auth Access Control', group: 'Security',
    purpose: 'Tenant SSO / OIDC settings, group-to-role mapping, MFA enforcement.' },
  { slug: 'permissions', label: 'User Permissions', group: 'Security',
    purpose: 'Per-user role + capability matrix. Admin/RO/etc. assignments.' },
  { slug: 'user-lockout', label: 'User Lockouts', group: 'Security',
    purpose: 'Auto-lockout policy (failed-login threshold), manual lock/unlock.' },
  { slug: 'tokens', label: 'API Token Management', group: 'Security',
    purpose: 'Per-user API tokens for programmatic access, scope, expiry, revoke.' },
  { slug: 'network', label: 'Network Security', group: 'Security',
    purpose: 'Per-tenant IP allow/deny, WAF rule overrides, CIDR import.' },
  { slug: 'webhook-security', label: 'Webhook Security', group: 'Security',
    purpose: 'HMAC signing keys for outbound webhooks, replay protection windows.' },
  { slug: 'dlp-config', label: 'DLP Configuration', group: 'Security',
    purpose: 'Data-loss-prevention regex rules with severity, action (redact/block), and per-rule toggles. DlpScanStage enforces them at chat priority 25 (pre-LLM).' },
];

/**
 * Compact prompt-context block: every page on one line.
 * Cost: ~3500 tokens for 62 pages. The Smart Router will pick a model
 * with enough context window to fit this + the user's question.
 */
export function buildAdminCorpusPromptBlock(): string {
  const byGroup = new Map<string, AdminPageEntry[]>();
  for (const e of ADMIN_PAGE_CORPUS) {
    const arr = byGroup.get(e.group) ?? [];
    arr.push(e);
    byGroup.set(e.group, arr);
  }
  const lines: string[] = [
    'ADMIN CONSOLE PAGE CATALOG (every page is reachable in this admin shell):',
    '',
  ];
  for (const [group, entries] of byGroup) {
    lines.push(`## ${group}`);
    for (const e of entries) {
      lines.push(`- [${e.label}](#${e.slug}) — ${e.purpose}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
