/**
 * AgentsContent — list / create / toggle / test workflow agents.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, RefreshCw, Play } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';
import {
  btnPrimary, btnPrimaryStyle, inputClass, inputStyle,
  tableHeaderClass, tableHeaderStyle, tableCellClass, tableCellStyle,
} from '../sectionShared';

interface AgentModelConfig { model?: string; primaryModel?: string }

interface WorkflowAgent {
  id?: string;
  display_name?: string;
  agent_type?: string;
  category?: string;
  tools_whitelist?: string[];
  model_config?: AgentModelConfig;
  system_prompt?: string;
  enabled?: boolean;
  icon?: string;
}

/** Raw agent shape as returned by the agents/proxy endpoints, before normalization. */
interface RawAgent {
  id?: string;
  name?: string;
  display_name?: string;
  agent_type?: string;
  role?: string;
  model_config?: AgentModelConfig;
  model?: string;
  tools_whitelist?: string[];
  tools?: string[];
  system_prompt?: string;
  category?: string;
  enabled?: boolean;
  icon?: string;
}

export const AgentsContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [agents, setAgents] = useState<WorkflowAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAgent, setNewAgent] = useState({
    display_name: '',
    system_prompt: '',
    model: '',
    tools_whitelist: '' as string,
    max_turns: 15,
    budget: 0,
  });
  const [testingId, setTestingId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      // Try workflow-scoped agents endpoint first (non-admin), fall back to admin endpoint
      let res = await fetch(workflowEndpoint('/workflows/agents'), { headers });
      if (!res.ok) {
        res = await fetch('/api/admin/agents', { headers });
      }
      if (res.ok) {
        const data = await res.json();
        // Normalize openagentic-proxy format (name/role/model/tools) to UI format
        const normalized: WorkflowAgent[] = (data.agents || []).map((a: RawAgent) => ({
          ...a,
          display_name: a.display_name || a.name || a.id,
          agent_type: a.agent_type || a.role || 'custom',
          model_config: a.model_config || (a.model ? { primaryModel: a.model } : {}),
          tools_whitelist: a.tools_whitelist || a.tools || [],
          system_prompt: a.system_prompt || '',
          category: a.category || 'platform',
          enabled: a.enabled !== false,
        }));
        setAgents(normalized);
      }
    } catch { /* non-admin */ }
    finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleCreate = useCallback(async () => {
    if (!newAgent.display_name.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const body = {
        display_name: newAgent.display_name.trim(),
        system_prompt: newAgent.system_prompt.trim(),
        model_config: { model: newAgent.model || undefined },
        tools_whitelist: newAgent.tools_whitelist ? newAgent.tools_whitelist.split(',').map(t => t.trim()).filter(Boolean) : [],
        max_turns: newAgent.max_turns,
        budget: newAgent.budget || undefined,
        category: 'custom',
        agent_type: 'worker',
        enabled: true,
      };
      const res = await fetch('/api/admin/agents', { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.ok) {
        setNewAgent({ display_name: '', system_prompt: '', model: '', tools_whitelist: '', max_turns: 15, budget: 0 });
        setShowCreate(false);
        fetchAgents();
      }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [newAgent, getAuthHeaders, fetchAgents]);

  const handleToggle = useCallback(async (agent: WorkflowAgent) => {
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch(`/api/admin/agents/${agent.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      fetchAgents();
    } catch { /* silently handle */ }
  }, [getAuthHeaders, fetchAgents]);

  const [testResult, setTestResult] = useState<{ agentId: string; success: boolean; output?: string; error?: string } | null>(null);

  const handleTest = useCallback(async (agentId: string) => {
    setTestingId(agentId);
    setTestResult(null);
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(`/api/agents/${agentId}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task: 'Briefly describe what you can do in 2-3 sentences.' }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ agentId, success: true, output: data.output || data.result || JSON.stringify(data).substring(0, 500) });
      } else {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTestResult({ agentId, success: false, error: errorData.error || errorData.message || `HTTP ${res.status}` });
      }
    } catch (err) {
      setTestResult({ agentId, success: false, error: err.message || 'Network error' });
    } finally {
      setTestingId(null);
    }
  }, [getAuthHeaders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
        </span>
        <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary} style={btnPrimaryStyle}>
          <span className="flex items-center gap-1.5">
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Create Agent'}
          </span>
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <input type="text" value={newAgent.display_name} onChange={e => setNewAgent(a => ({ ...a, display_name: e.target.value }))} placeholder="Agent name" className={inputClass} style={inputStyle} />
              <textarea value={newAgent.system_prompt} onChange={e => setNewAgent(a => ({ ...a, system_prompt: e.target.value }))} placeholder="System prompt..." rows={3} className={`${inputClass} resize-none`} style={inputStyle} />
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={newAgent.model} onChange={e => setNewAgent(a => ({ ...a, model: e.target.value }))} placeholder="Model (e.g. claude-sonnet-4-6)" className={inputClass} style={inputStyle} />
                <input type="text" value={newAgent.tools_whitelist} onChange={e => setNewAgent(a => ({ ...a, tools_whitelist: e.target.value }))} placeholder="Tools whitelist (comma-separated)" className={inputClass} style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ssm-newagent-max-turns" className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Max turns</label>
                  <input id="ssm-newagent-max-turns" type="number" value={newAgent.max_turns} onChange={e => setNewAgent(a => ({ ...a, max_turns: Number(e.target.value) }))} className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label htmlFor="ssm-newagent-budget" className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Budget (tokens, 0 = unlimited)</label>
                  <input id="ssm-newagent-budget" type="number" value={newAgent.budget} onChange={e => setNewAgent(a => ({ ...a, budget: Number(e.target.value) }))} className={inputClass} style={inputStyle} />
                </div>
              </div>
              <button onClick={handleCreate} disabled={saving || !newAgent.display_name.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                {saving ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agents table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface)' }}>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Agent</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Type</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Category</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Tools</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Model</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Enabled</th>
              <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            ) : agents.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No agents configured</td></tr>
            ) : (
              agents.map(agent => (
                <tr key={agent.id} className="transition-colors hover:bg-[var(--color-surface)]">
                  <td className={tableCellClass} style={tableCellStyle}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{agent.icon || '\uD83E\uDD16'}</span>
                      <span className="font-medium">{agent.display_name}</span>
                    </div>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                      {agent.agent_type}
                    </span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs">{agent.category || '-'}</span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs">{agent.tools_whitelist?.length || 0}</span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                      {agent.model_config?.model || 'auto'}
                    </span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <button onClick={() => handleToggle(agent)} className="relative w-9 h-5 rounded-full transition-colors" style={{ backgroundColor: agent.enabled !== false ? 'var(--color-success)' : 'var(--color-surface-2)' }}>
                      <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-surface shadow" animate={{ left: agent.enabled !== false ? 18 : 2 }} transition={{ duration: 0.15 }} />
                    </button>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => handleTest(agent.id)}
                        disabled={testingId === agent.id}
                        className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                        title="Test agent"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {testingId === agent.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Test result display */}
      <AnimatePresence>
        {testResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              padding: '10px 14px', borderRadius: 8, marginTop: 8,
              background: testResult.success ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)',
              border: `1px solid ${testResult.success ? 'color-mix(in srgb, var(--color-success) 30%, transparent)' : 'color-mix(in srgb, var(--color-error) 30%, transparent)'}`,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 11, fontWeight: 600, color: testResult.success ? 'var(--color-success)' : 'var(--color-error)' }}>
                {testResult.success ? 'Test Passed' : 'Test Failed'}
              </span>
              <button onClick={() => setTestResult(null)} style={{ color: 'var(--color-text-tertiary)', padding: 2 }}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <div style={{
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-secondary)', maxHeight: 120, overflowY: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {testResult.output || testResult.error || 'No output'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
