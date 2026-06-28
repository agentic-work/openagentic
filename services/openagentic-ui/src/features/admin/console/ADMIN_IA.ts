/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * ADMIN_IA — the rewrite information-architecture SoT.
 *
 * 10 domains · 55 leaves. This is the GROUPING / PRESENTATION SoT; it
 * encodes the domain structure with display titles, mnemonics, icons,
 * and default-open groups, keyed by canonical leaf id (the contract key).
 *
 * Sidebar order = exactly the order of DOMAINS below. Groups
 * `models`/`flows`/`agents` open by default (OPEN_GROUPS).
 */
import type {
  AdminConsoleDomain,
  AdminConsoleLeaf,
  AdminConsoleLeafIndexEntry,
} from './types'

/**
 * Domain icons — single SVG <path d="…"> strings, ported verbatim from
 * the mock's `const I` map. Stroke is `currentColor`, so they resolve
 * to the active theme foreground/accent at paint time (no color baked in).
 */
export const DOMAIN_ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  models: 'M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zM12 12l8-4.5M12 12v8M12 12L4 7.5',
  flows: 'M5 4h6v6H5zM13 14h6v6h-6zM8 10v4h8M16 14v-4',
  agents:
    'M12 2a4 4 0 014 4v2a4 4 0 11-8 0V6a4 4 0 014-4zM4 21v-2a6 6 0 016-6h4a6 6 0 016 6v2',
  tools: 'M14 7l-1.5-1.5a3.5 3.5 0 00-5 5L3 14l3 3 3.5-4.5a3.5 3.5 0 005-5z',
  integ:
    'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
  prompts: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  content: 'M4 4h16v4H4zM4 12h10v8H4zM18 12h2v8h-2z',
  obs: 'M3 3v18h18M7 14l3-3 3 3 5-6',
  sys: 'M12 1l3 5 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z',
} as const

const L = (id: string, name: string, mn: string): AdminConsoleLeaf => ({ id, name, mn })

/**
 * ADMIN_DOMAINS — the 10-domain taxonomy in sidebar order.
 * NAV[0] HOME has no leaves (no badge, no chevron); it routes to the
 * Home dashboard.
 */
export const ADMIN_DOMAINS: AdminConsoleDomain[] = [
  { id: 'home', name: 'Home', icon: DOMAIN_ICONS.home, leaves: [] },

  // NAV[1] — Models & Providers (7) · open by default
  {
    id: 'models',
    name: 'Models & Providers',
    icon: DOMAIN_ICONS.models,
    leaves: [
      L('providers', 'Provider Management', 'lp'),
      L('model-management', 'Models', 'lm'),
      L('default-models', 'Default Models', 'ld'),
      L('router-tuning', 'Router Tuning', 'lr'),
      L('ollama', 'Ollama Hosts', 'lo'),
      L('tiered-fc', 'Tiered Function Calling', 'lt'),
      L('llm-performance', 'Performance Metrics', 'lf'),
    ],
  },

  // NAV[2] — Flows (9) · open by default
  {
    id: 'flows',
    name: 'Flows',
    icon: DOMAIN_ICONS.flows,
    leaves: [
      L('workflows', 'All Workflows', 'fw'),
      L('executions', 'All Executions', 'fe'),
      L('flow-costs', 'Flow Costs', 'fc'),
      L('failures', 'Failures', 'fx'),
      L('audit-logs', 'Audit Logs', 'fa'),
      L('credentials', 'Credentials', 'fr'),
      L('governance', 'Governance', 'fg'),
      L('kpi-dashboard', 'KPI Dashboard', 'fk'),
      L('teams', 'Teams', 'ft'),
    ],
  },

  // NAV[3] — Agents (4) · open by default
  {
    id: 'agents',
    name: 'Agents',
    icon: DOMAIN_ICONS.agents,
    leaves: [
      L('agent-registry', 'Agent Registry', 'ag'),
      L('agent-ops', 'AgentOps', 'ao'),
      L('agent-skills', 'Skills & Plugins', 'as'),
      L('agent-executions', 'Executions', 'ax'),
    ],
  },

  // NAV[4] — Tools & MCP (3)
  {
    id: 'tools',
    name: 'Tools & MCP',
    icon: DOMAIN_ICONS.tools,
    leaves: [
      L('mcp-fleet', 'MCP Fleet', 'tf'),
      L('enriched-tools', 'Enriched Tools', 'te'),
      L('skills-ecosystem', 'Skills Ecosystem', 'tk'),
    ],
  },

  // NAV[5] — Integrations (3)
  {
    id: 'integrations',
    name: 'Integrations',
    icon: DOMAIN_ICONS.integ,
    leaves: [
      L('slack', 'Slack', 'is'),
      L('ms-teams', 'Microsoft Teams', 'it'),
      L('integration-logs', 'Integration Logs', 'il'),
    ],
  },

  // NAV[6] — Prompts (4)
  {
    id: 'prompts',
    name: 'Prompts',
    icon: DOMAIN_ICONS.prompts,
    leaves: [
      L('prompt-modules', 'Modules', 'pm'),
      L('pipeline-settings', 'Pipeline Settings', 'pp'),
      L('prompt-effectiveness', 'Effectiveness', 'pe'),
      L('prompt-metrics', 'Metrics', 'px'),
    ],
  },

  // NAV[7] — Content (4)
  {
    id: 'content',
    name: 'Content',
    icon: DOMAIN_ICONS.content,
    leaves: [
      L('templates', 'Templates', 'nt'),
      L('shared-kb', 'Shared Knowledge Base', 'nk'),
      L('data-layer', 'Unified Data Layer', 'nd'),
      L('user-memory', 'User Memory', 'nm'),
    ],
  },

  // NAV[8] — Observability (11)
  {
    id: 'obs',
    name: 'Observability',
    icon: DOMAIN_ICONS.obs,
    leaves: [
      L('cluster-health', 'Cluster Health', 'mh'),
      L('analytics', 'Usage Analytics', 'my'),
      L('user-activity', 'User Activity', 'ma'),
      L('errors', 'Monitoring & Errors', 'me'),
      L('slo', 'SLOs', 'ms'),
      L('context-window', 'Context Window', 'mw'),
      L('embeddings', 'Embeddings', 'mb'),
      L('audit', 'Audit Logs', 'md'),
      L('feedback', 'Feedback', 'mf'),
      L('test-harness', 'Test Harness', 'mt'),
      L('chargeback', 'Cost Management', 'bc'),
    ],
  },

  // NAV[9] — System & Security (10)
  {
    id: 'system',
    name: 'System & Security',
    icon: DOMAIN_ICONS.sys,
    leaves: [
      L('users', 'User Management', 'su'),
      L('auth-access', 'Auth Access Control', 'sa'),
      L('permissions', 'User Permissions', 'sp'),
      L('user-lockouts', 'User Lockouts', 'sl'),
      L('tokens', 'API Tokens', 'st'),
      L('system-settings', 'System Settings', 'ss'),
      L('rate-limits', 'Rate Limits', 'sr'),
      L('network-security', 'Network Security', 'sn'),
      L('webhook-security', 'Webhook Security', 'sw'),
      L('dlp-config', 'DLP Configuration', 'sd'),
    ],
  },
]

/** Domain id → domain. */
export const DOMAIN_BY_ID: Record<string, AdminConsoleDomain> = Object.fromEntries(
  ADMIN_DOMAINS.map((d) => [d.id, d]),
)

/** Canonical leaf id → leaf + its parent domain. */
export const LEAF_INDEX: Record<string, AdminConsoleLeafIndexEntry> = (() => {
  const out: Record<string, AdminConsoleLeafIndexEntry> = {}
  for (const d of ADMIN_DOMAINS) {
    for (const l of d.leaves) {
      out[l.id] = { ...l, domain: d.id, domainName: d.name }
    }
  }
  return out
})()

/** Mnemonic (2-char) → canonical leaf id, for cmd-K + keyboard jump. */
export const LEAF_BY_MNEMONIC: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const d of ADMIN_DOMAINS) {
    for (const l of d.leaves) out[l.mn] = l.id
  }
  return out
})()

/** Total leaf count. */
export const LEAF_COUNT = Object.keys(LEAF_INDEX).length

/** Default-open sidebar groups (blueprint §1). */
export const DEFAULT_OPEN_GROUPS: ReadonlySet<string> = new Set(['models', 'flows', 'agents'])

/** The default landing leaf-less route (the Home dashboard domain). */
export const HOME_DOMAIN_ID = 'home'

/** Resolve the parent domain id of a leaf (for active-rail + auto-open). */
export function domainOfLeaf(leafId: string | null | undefined): string | null {
  if (!leafId) return null
  return LEAF_INDEX[leafId]?.domain ?? null
}
