/**
 * sectionShared — shared types, style constants, color maps, and small
 * presentational primitives used across the per-section content modules
 * of SidebarSectionModal.
 *
 * IMPORTANT: this module must NOT import anything from `./content/*` —
 * the content modules import from here, so a back-import would create a
 * cycle. Keep it leaf-level (React + shared icons only).
 */

import React from 'react';
import type { TemplateMeta } from '../../TemplateLegend';

// ---------------------------------------------------------------------------
// Section identity
// ---------------------------------------------------------------------------

export type SidebarSectionType =
  | 'nodes'
  | 'credentials'
  | 'agents'
  | 'artifacts'
  | 'data'
  | 'variables'
  | 'webhooks'
  | 'api'
  | 'team'
  | 'playground'
  | 'deployed'
  | 'my_workflows'
  | 'templates'
  | 'settings'
  | 'versions'
  | 'runs'
  | 'insights';

export const sectionTitles: Record<SidebarSectionType, string> = {
  nodes: 'Node Catalog',
  credentials: 'Credentials & Connections',
  agents: 'Agent Configuration',
  artifacts: 'Artifacts',
  data: 'Data Stores',
  variables: 'Workflow Variables',
  webhooks: 'Webhooks',
  api: 'API Endpoints',
  team: 'Team & Sharing',
  // marketplace removed — consolidated into templates
  playground: 'Agent Playground',
  deployed: 'Deployed Workflows',
  my_workflows: 'My Workflows',
  templates: 'Templates',
  settings: 'Workflow Settings',
  versions: 'Version History',
  runs: 'My Runs',
  insights: 'Insights',
};

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

export const inputClass =
  'glass-field w-full px-3 py-2 text-sm rounded-lg';

export const inputStyle: React.CSSProperties = {};

export const btnPrimary =
  'px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50';

export const btnPrimaryStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-accent)',
  color: 'var(--color-on-accent)',
};

export const tableHeaderClass =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider';

export const tableHeaderStyle: React.CSSProperties = {
  color: 'var(--color-text-tertiary)',
  borderBottom: '1px solid var(--color-border)',
};

export const tableCellClass = 'px-3 py-2.5 text-sm';
export const tableCellStyle: React.CSSProperties = {
  color: 'var(--color-text)',
  borderBottom: '1px solid var(--color-border)',
};

export const scopeColors: Record<string, string> = {
  global: 'var(--color-info)',
  group: 'var(--color-accent)',
  workflow: 'var(--color-warning)',
};

export const methodColors: Record<string, string> = {
  POST: 'var(--color-success)',
  GET: 'var(--color-info)',
  PUT: 'var(--color-warning)',
  DELETE: 'var(--color-error)',
};

export const roleColors: Record<string, string> = {
  viewer: 'var(--color-fg-muted)',
  editor: 'var(--color-info)',
  executor: 'var(--color-warning)',
  admin: 'var(--color-accent)',
};

export type VariableType = 'string' | 'number' | 'boolean' | 'json' | 'secret_ref';

export const typeColors: Record<VariableType, string> = {
  string: 'var(--color-info)',
  number: 'var(--color-warning)',
  boolean: 'var(--color-success)',
  json: 'var(--color-accent)',
  secret_ref: 'var(--color-error)',
};

export const COMMON_EXPRESSIONS = [
  { label: 'Trigger Body Field', expr: '{{trigger.body.field}}' },
  { label: 'Node Output', expr: '{{nodes.nodeId.output}}' },
  { label: 'Env Variable', expr: '{{env.KEY}}' },
  { label: 'Execution ID', expr: '{{execution.id}}' },
  { label: 'Current Timestamp', expr: '{{now}}' },
  { label: 'User ID', expr: '{{user.id}}' },
];

// ---------------------------------------------------------------------------
// Shared data shapes (used by 2+ content modules / the public seam)
// ---------------------------------------------------------------------------

export interface WebhookCall {
  timestamp: string;
  status_code: number;
  response_time_ms: number;
}

export interface WebhookStats {
  last_calls?: WebhookCall[];
}

export interface Webhook {
  id: string;
  name: string;
  method: string;
  url: string;
  status?: string;
  response_mode?: string;
  stats?: WebhookStats;
}

export interface Execution {
  id: string;
  workflow?: { name?: string };
  workflow_name?: string;
  workflow_id?: string;
  status?: string;
  created_at?: string;
  started_at?: string;
  duration_ms?: number;
}

export interface WorkflowNode {
  type?: string;
}

export interface WorkflowSummary {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  category?: string;
  status?: string;
  is_template?: boolean;
  is_public?: boolean;
  executionCount?: number;
  updated_at?: string;
  updatedAt?: string;
  nodes?: WorkflowNode[];
  definition?: { nodes?: WorkflowNode[] };
  meta?: TemplateMeta;
}

export interface WorkflowSettings {
  execution?: { defaultModel?: string; defaultTimeout?: number; maxExecutionTime?: number };
  costs?: { perExecution?: number; daily?: number; monthly?: number; onExceeded?: string };
  retry?: { count?: number; delayMs?: number; backoff?: string };
  environmentVariables?: Record<string, string>;
  tags?: string;
  visibility?: string;
  [key: string]: unknown;
}

export interface WorkflowVersion {
  id?: string;
  version?: number;
  created_at?: string;
  changelog?: string;
}

// ---------------------------------------------------------------------------
// Sub-tab button
// ---------------------------------------------------------------------------

export const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 text-sm font-medium rounded-[var(--ctl-radius)] transition-colors"
    style={{
      backgroundColor: active ? 'var(--glass-accent-fill-2)' : 'transparent',
      borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
      color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    }}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

export const StatusDot: React.FC<{ color: string }> = ({ color }) => (
  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
);
