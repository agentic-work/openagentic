/**
 * AgentSOTConfig — read-only view of an agent's full source-of-truth config
 * from the Admin DB (/api/admin/agents), shown inline under the Agent-Single
 * node's Agent ID picker.
 *
 * This module is the SINGLE owner of the agent-config fetch cache
 * (`_agentConfigCache` + `_fullAgentListCache`) — moved here as one unit from
 * the panel so the only consumer (this component) owns it.
 */

import React from 'react';

// Shape of an agent record returned by /api/admin/agents. The endpoint mixes
// snake_case and camelCase keys depending on source, so fields are optional and
// the index signature keeps it permissive without resorting to `any`.
export interface AgentRecord {
  id?: string;
  agent_type?: string;
  agentType?: string;
  model?: string;
  model_config?: Record<string, unknown>;
  modelConfig?: Record<string, unknown>;
  tools_whitelist?: string[];
  tools?: string[];
  system_prompt?: string;
  systemPrompt?: string;
  skills?: Array<string | { name?: string }>;
  [key: string]: unknown;
}

// Fetch full agent config from the DB (SOT) — includes system_prompt, tools, model_config, thinking
const _agentConfigCache = new Map<string, { data: AgentRecord; ts: number }>();
let _fullAgentListCache: { agents: AgentRecord[]; ts: number } | null = null;

async function fetchFullAgentConfig(agentId: string): Promise<AgentRecord | null> {
  if (!agentId) return null;
  const cached = _agentConfigCache.get(agentId);
  if (cached && Date.now() - cached.ts < 120000) return cached.data;
  try {
    // Fetch full agent list (the list endpoint returns complete config for each agent)
    if (!_fullAgentListCache || Date.now() - _fullAgentListCache.ts > 60000) {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/admin/agents', { headers, credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as AgentRecord[] | { agents?: AgentRecord[] };
        _fullAgentListCache = {
          agents: Array.isArray(data) ? data : (data.agents ?? []),
          ts: Date.now(),
        };
        // Cache each agent individually
        for (const agent of _fullAgentListCache.agents) {
          if (agent.id) _agentConfigCache.set(agent.id, { data: agent, ts: Date.now() });
        }
      }
    }
    return _agentConfigCache.get(agentId)?.data || null;
  } catch { /* ignore */ }
  return null;
}

/** Inline component showing the full agent config from the DB (SOT) */
export const AgentSOTConfig: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [config, setConfig] = React.useState<AgentRecord | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    fetchFullAgentConfig(agentId).then(setConfig);
  }, [agentId]);

  if (!config) return null;

  const modelConfig: Record<string, unknown> =
    config.model_config || config.modelConfig || {};
  const tools: string[] = config.tools_whitelist || config.tools || [];
  const systemPrompt: string = config.system_prompt || config.systemPrompt || '';
  // Coerce a dynamic model-config value to a renderable string with a dash fallback.
  const mc = (key: string): string => {
    const v = modelConfig[key];
    return v == null || v === '' ? '—' : String(v);
  };

  return (
    <div className="glass-surface-subtle" style={{
      border: '1px solid var(--glass-border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
        }}
      >
        <span>Agent Source Config (DB)</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div style={{ padding: '0 12px 10px', fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
          <div><strong>Type:</strong> {config.agent_type || config.agentType || '—'}</div>
          <div><strong>Model:</strong> {String(modelConfig.primaryModel || modelConfig.defaultModel || config.model || 'auto')}</div>
          <div><strong>Temperature:</strong> {mc('temperature')}</div>
          <div><strong>Max Tokens:</strong> {mc('maxTokens')}</div>
          <div><strong>Thinking:</strong> {modelConfig.enableThinking ? `Enabled (budget: ${mc('thinkingBudget')})` : 'Disabled'}</div>
          {tools.length > 0 && (
            <div><strong>Tools ({tools.length}):</strong> {tools.slice(0, 5).join(', ')}{tools.length > 5 ? ` +${tools.length - 5} more` : ''}</div>
          )}
          {systemPrompt && (
            <div style={{ marginTop: 4 }}>
              <strong>System Prompt:</strong>
              <div style={{
                marginTop: 2, padding: '6px 8px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--glass-page-bg) 55%, transparent)', fontSize: 10, lineHeight: 1.4,
                maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {systemPrompt.substring(0, 500)}{systemPrompt.length > 500 ? '...' : ''}
              </div>
            </div>
          )}
          {config.skills && config.skills.length > 0 && (
            <div><strong>Skills:</strong> {config.skills.map((s) => (typeof s === 'string' ? s : s.name ?? '')).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
};
