/**
 * AgentManagementView - Admin view for managing agent definitions
 * Provides CRUD operations for agent registry (platform + custom agents)
 * with skills association, selectable models, and theme-safe styling.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Save, X, Search, Play, ChevronDown, ChevronRight } from '@/shared/icons';
import { AgentExecutionDashboard } from './AgentExecutionDashboard';
import { AgentPlayground } from './AgentPlayground';
import { SkillsMarketplaceView } from './SkillsMarketplaceView';

interface ModelConfig {
  primaryModel?: string;
  fallbackModel?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
}

interface AgentDefinition {
  id: string;
  name?: string;
  display_name: string;
  description?: string;
  agent_type: string;
  model_config: ModelConfig;
  system_prompt: string;
  graph_definition?: Record<string, any>;
  rate_limits?: Record<string, any>;
  cost_limits?: Record<string, any>;
  tools_whitelist: string[];
  skills: string[];
  delegation: Record<string, any>;
  background: Record<string, any> | null;
  category?: string;
  tags?: string[];
  icon?: string;
  color?: string;
  enabled: boolean;
  version?: number;
  created_by?: string;
  created_at: string;
  _count?: { executions: number };
  prompt_strategy?: string;  // "composite" | "custom"
  prompt_modules?: string[];
  prompt_mode?: string;      // "full" | "minimal"
  max_spawn_depth?: number;
  max_children?: number;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  capabilities?: Record<string, boolean>;
  maxTokens?: number;
}

interface SkillDefinition {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  type?: string;
  source?: string;
  tags?: string[];
}

interface AgentManagementViewProps {
  theme: string;
}

// Role badge colors using opacity variants that work on any background
const ROLE_STYLES: Record<string, { bg: string; text: string }> = {
  reasoning:          { bg: 'color-mix(in srgb, var(--color-secondary) 15%, transparent)',  text: 'var(--color-secondary)' },
  data_query:         { bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',    text: 'var(--color-primary)' },
  code_execution:     { bg: 'color-mix(in srgb, var(--color-success) 15%, transparent)',    text: 'var(--color-success)' },
  tool_orchestration: { bg: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',    text: 'var(--color-warning)' },
  summarization:      { bg: 'color-mix(in srgb, var(--color-secondary) 15%, transparent)',  text: 'var(--color-secondary)' },
  planning:           { bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',    text: 'var(--color-primary)' },
  validation:         { bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)',      text: 'var(--color-error)' },
  synthesis:          { bg: 'color-mix(in srgb, var(--color-secondary) 15%, transparent)',  text: 'var(--color-secondary)' },
  custom:             { bg: 'color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)', text: 'var(--color-text-tertiary)' },
};

const ROLE_OPTIONS = ['reasoning', 'data_query', 'code_execution', 'tool_orchestration', 'summarization', 'planning', 'validation', 'synthesis', 'custom'];

export const AgentManagementView: React.FC<AgentManagementViewProps> = ({ theme }) => {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'registry' | 'skills' | 'playground' | 'observability'>('registry');
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testAgentId, setTestAgentId] = useState('');
  const [testingAgentId, setTestingAgentId] = useState<string | null>(null);
  const [inlineTestInput, setInlineTestInput] = useState('');
  const [inlineTestOutput, setInlineTestOutput] = useState<{response: string; model: string; tokens: number; durationMs: number; toolCalls: string[]} | null>(null);
  const [inlineTestLoading, setInlineTestLoading] = useState(false);
  const [testResolvedPrompt, setTestResolvedPrompt] = useState<string | null>(null);

  // Available models from LLM providers
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  // Available skills
  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([]);
  // Prompt modules
  const [availableModules, setAvailableModules] = useState<Array<{id: string; name: string; category: string; description: string; priority: number}>>([]);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/agents', { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch agents: ${response.statusText}`);
      const data = await response.json();
      const normalized = (data.agents || []).map((a: any) => ({
        ...a,
        display_name: a.display_name || a.name || a.id,
        description: a.description || a.system_prompt?.slice(0, 120) || '',
        agent_type: a.agent_type || a.role || 'custom',
        model_config: a.model_config || (a.model ? { primaryModel: a.model } : {}),
        tools_whitelist: a.tools_whitelist || a.tools || [],
        system_prompt: a.system_prompt || '',
        skills: a.skills || [],
        delegation: a.delegation || {},
        background: a.background || null,
        enabled: a.enabled !== false,
        created_at: a.created_at || '',
        // Prompt composition fields
        prompt_strategy: a.prompt_strategy || a.promptStrategy || 'composite',
        prompt_modules: a.prompt_modules || a.promptModules || [],
        prompt_mode: a.prompt_mode || a.promptMode || 'full',
        max_spawn_depth: a.max_spawn_depth ?? a.maxSpawnDepth ?? 3,
        max_children: a.max_children ?? a.maxChildren ?? 5,
        // Persona fields
        persona_role: a.persona?.role || '',
        persona_tone: a.persona?.tone || 'professional',
        persona_boundaries: a.persona?.boundaries || '',
        persona_bootstrap: a.persona?.bootstrap || '',
        // Tool policy fields
        tool_policy_mode: a.toolPolicy?.mode || 'allow_all',
        tool_policy_list: (a.toolPolicy?.toolList || []).join(', '),
        tool_policy_auto_detect_high_risk: a.toolPolicy?.autoDetectHighRisk !== false,
      }));
      setAgents(normalized);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/llm-providers', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      const models: AvailableModel[] = [];
      for (const provider of (data.providers || [])) {
        if (!provider.enabled) continue;
        for (const model of (provider.models || [])) {
          models.push({
            id: model.id || model.name,
            name: model.name || model.id,
            provider: provider.displayName || provider.name,
            capabilities: model.capabilities,
            maxTokens: model.maxTokens,
          });
        }
      }
      setAvailableModels(models);
    } catch { /* non-critical */ }
  }, []);

  const fetchSkills = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/agents/skills', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      setAvailableSkills(data.skills || []);
    } catch { /* non-critical */ }
  }, []);

  const fetchPromptModules = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/prompt-modules', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      setAvailableModules(data.modules || []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchAgents(); fetchModels(); fetchSkills(); fetchPromptModules(); }, [fetchAgents, fetchModels, fetchSkills, fetchPromptModules]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent definition?')) return;
    try {
      const response = await fetch(`/api/admin/agents/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Failed to delete agent');
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSave = async (agent: AgentDefinition) => {
    try {
      const method = agent.id ? 'PUT' : 'POST';
      const url = agent.id ? `/api/admin/agents/${agent.id}` : '/api/admin/agents';
      const agentAny = agent as any;
      const payload: Record<string, any> = {
        name: agent.name || agent.display_name.toLowerCase().replace(/\s+/g, '-'),
        displayName: agent.display_name,
        description: agent.description || '',
        agentType: agent.agent_type,
        modelConfig: agent.model_config,
        systemPrompt: agent.system_prompt,
        toolsWhitelist: agent.tools_whitelist,
        skills: agent.skills,
        delegation: agent.delegation,
        background: agent.background,
        category: agent.category || 'custom',
        tags: agent.tags || [],
        icon: agent.icon,
        enabled: agent.enabled,
        promptStrategy: agent.prompt_strategy || 'composite',
        promptModules: agent.prompt_modules || [],
        promptMode: agent.prompt_mode || 'full',
        maxSpawnDepth: agent.max_spawn_depth ?? 3,
        maxChildren: agent.max_children ?? 5,
        persona: {
          role: agentAny.persona_role || '',
          tone: agentAny.persona_tone || 'professional',
          boundaries: agentAny.persona_boundaries || '',
          bootstrap: agentAny.persona_bootstrap || '',
        },
        toolPolicy: {
          mode: agentAny.tool_policy_mode || 'allow_all',
          toolList: (agentAny.tool_policy_list || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          autoDetectHighRisk: agentAny.tool_policy_auto_detect_high_risk !== false,
        },
      };
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to save agent');
      setEditingAgent(null);
      fetchAgents();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTest = async (agentId: string) => {
    if (!testInput.trim()) return;
    setTestLoading(true);
    setTestOutput('');
    try {
      const response = await fetch(`/api/admin/agents/${agentId}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testInput }),
      });
      const data = await response.json();
      setTestOutput(data.output || JSON.stringify(data, null, 2));
    } catch (err: any) {
      setTestOutput(`Error: ${err.message}`);
    } finally {
      setTestLoading(false);
    }
  };

  const runAgentTest = async (agentId: string) => {
    if (!inlineTestInput.trim()) return;
    setInlineTestLoading(true);
    setInlineTestOutput(null);
    const startTime = Date.now();
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ task: inlineTestInput }),
      });
      const data = await res.json();
      setInlineTestOutput({
        response: data.output || data.error || 'No response',
        model: data.metrics?.modelUsed || data.model || 'unknown',
        tokens: (data.metrics?.totalInputTokens || 0) + (data.metrics?.totalOutputTokens || 0),
        durationMs: Date.now() - startTime,
        toolCalls: data.results?.[0]?.toolCallsExecuted?.map((t: any) => t.name) || [],
      });
    } catch (err: any) {
      setInlineTestOutput({ response: `Error: ${err.message}`, model: '', tokens: 0, durationMs: Date.now() - startTime, toolCalls: [] });
    } finally {
      setInlineTestLoading(false);
    }
  };

  const filteredAgents = agents.filter(a =>
    a.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.agent_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const platformAgents = filteredAgents.filter(a => !a.background);
  const backgroundAgents = filteredAgents.filter(a => a.background);

  const roleBadge = (role: string) => {
    const s = ROLE_STYLES[role] || ROLE_STYLES.custom;
    return { backgroundColor: s.bg, color: s.text };
  };

  const toggleSkill = (skillId: string) => {
    if (!editingAgent) return;
    const current = editingAgent.skills || [];
    const next = current.includes(skillId)
      ? current.filter(s => s !== skillId)
      : [...current, skillId];
    setEditingAgent({ ...editingAgent, skills: next });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-secondary)' }}>Loading agents...</div>;
  }

  // Core prompt modules that are always included (locked)
  const CORE_MODULES = ['identity-default', 'safety', 'continuation'];

  const renderAgentCard = (agent: AgentDefinition) => {
    const isExpanded = expandedAgent === agent.id;
    const moduleCount = (agent.prompt_modules?.length || 0);

    return (
      <div
        key={agent.id}
        className="rounded-lg overflow-hidden transition-colors mb-1.5"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: `1px solid ${isExpanded ? 'var(--color-border-active, color-mix(in srgb, var(--color-border) 80%, var(--color-primary)))' : 'var(--color-border)'}`,
        }}
      >
        {/* Agent row */}
        <div className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer" onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}>
          <div className="flex-shrink-0 text-xs transition-transform" style={{ color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <ChevronRight size={12} />
          </div>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.display_name}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ ...roleBadge(agent.agent_type), fontFamily: "'JetBrains Mono', monospace" }}>
            {agent.agent_type}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 40%, transparent))', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
            {agent.model_config?.primaryModel || 'auto'}
          </span>
          {agent.prompt_strategy === 'composite' && moduleCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 12%, transparent)', color: 'var(--color-accent, var(--color-primary))', fontFamily: "'JetBrains Mono', monospace" }}>
              composite &mdash; {moduleCount} module{moduleCount !== 1 ? 's' : ''}
            </span>
          )}
          {agent.background && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)', fontFamily: "'JetBrains Mono', monospace" }}>
              background
            </span>
          )}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            {(agent.tools_whitelist?.length || 0) > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)', fontFamily: "'JetBrains Mono', monospace" }}>
                {agent.tools_whitelist.length} tool{agent.tools_whitelist.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={e => {
                e.stopPropagation();
                if (testingAgentId === agent.id) {
                  setTestingAgentId(null);
                } else {
                  setTestingAgentId(agent.id);
                  setExpandedAgent(agent.id);
                  setInlineTestOutput(null);
                  setInlineTestInput('');
                  fetch(`/api/agents/resolve?id=${agent.id}&mode=chat`, { credentials: 'include' })
                    .then(r => r.json())
                    .then(d => setTestResolvedPrompt(d.systemPrompt || null))
                    .catch(() => setTestResolvedPrompt(null));
                }
              }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: testingAgentId === agent.id ? 'var(--color-warning)' : 'var(--text-tertiary)' }}
              title={testingAgentId === agent.id ? 'Close test' : 'Test'}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-success)')}
              onMouseLeave={e => (e.currentTarget.style.color = testingAgentId === agent.id ? 'var(--color-warning)' : 'var(--text-tertiary)')}
            ><Play size={13} /></button>
            <button
              onClick={e => { e.stopPropagation(); setEditingAgent({ ...agent }); }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              title="Edit"
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent, var(--color-primary))')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            ><Edit size={13} /></button>
            <button
              onClick={e => { e.stopPropagation(); handleDelete(agent.id); }}
              className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              title="Delete"
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
            ><Trash2 size={13} /></button>
          </div>
        </div>

        {/* Expanded detail */}
        {isExpanded && (
          <div className="px-4 pb-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            {agent.description && (
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{agent.description}</p>
            )}

            {/* 2-column detail grid */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>Model Config</div>
                <div className="text-xs space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                  <div>
                    <span style={{ color: 'var(--text-tertiary)' }}>Primary:</span>{' '}
                    {agent.model_config?.primaryModel || 'auto (slider)'}
                    {agent.model_config?.temperature != null && <> &nbsp;<span style={{ color: 'var(--text-tertiary)' }}>Temp:</span> {agent.model_config.temperature}</>}
                    {agent.model_config?.maxTokens && <> &nbsp;<span style={{ color: 'var(--text-tertiary)' }}>Max:</span> {agent.model_config.maxTokens.toLocaleString()}</>}
                  </div>
                  {agent.model_config?.fallbackModel && (
                    <div><span style={{ color: 'var(--text-tertiary)' }}>Fallback:</span> {agent.model_config.fallbackModel}</div>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>Spawn Limits</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>Depth:</span> {agent.max_spawn_depth ?? 1} &nbsp;
                  <span style={{ color: 'var(--text-tertiary)' }}>Children:</span> {agent.max_children ?? 5} &nbsp;
                  <span style={{ color: 'var(--text-tertiary)' }}>Mode:</span> {agent.prompt_mode || 'full'}
                </div>
              </div>
            </div>

            {/* Tools */}
            {agent.tools_whitelist?.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>Tools</div>
                <div className="flex flex-wrap gap-1">
                  {agent.tools_whitelist.map(t => (
                    <span key={t} className="px-2 py-0.5 text-[10px] font-medium rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 40%, transparent))', color: 'var(--text-secondary)', border: '1px solid var(--color-border)', fontFamily: "'JetBrains Mono', monospace" }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Prompt Modules */}
            {agent.prompt_modules && agent.prompt_modules.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>Prompt Modules</div>
                <div className="flex flex-wrap gap-1">
                  {agent.prompt_modules.map(m => {
                    const isLocked = CORE_MODULES.includes(m);
                    return (
                      <span key={m} className="px-2.5 py-0.5 text-[10px] font-semibold rounded-full" style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 12%, transparent)',
                        color: 'var(--color-accent, var(--color-primary))',
                        border: '1px solid color-mix(in srgb, var(--color-accent, var(--color-primary)) 20%, transparent)',
                        opacity: isLocked ? 0.55 : 1,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{m}</span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Skills */}
            {agent.skills?.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>Skills</div>
                <div className="flex flex-wrap gap-1">
                  {agent.skills.map(s => {
                    const skill = availableSkills.find(sk => sk.id === s || sk.name === s);
                    return (
                      <span key={s} className="px-2 py-0.5 text-[10px] font-medium rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-secondary) 10%, transparent)', color: 'var(--color-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {skill?.display_name || skill?.name || s}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* System prompt preview (only for custom strategy) */}
            {agent.prompt_strategy !== 'composite' && agent.system_prompt && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.8px' }}>System Prompt</div>
                <pre className="text-[11px] p-2.5 rounded-md overflow-auto max-h-24 whitespace-pre-wrap" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 20%, transparent))', color: 'var(--text-secondary)', border: '1px solid var(--color-border)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {agent.system_prompt.slice(0, 500)}{agent.system_prompt.length > 500 ? '...' : ''}
                </pre>
              </div>
            )}

            {/* Inline Test Panel */}
            {testingAgentId === agent.id && (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }}>
                <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 8%, transparent)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-success)', letterSpacing: '0.8px' }}>Agent Test</span>
                  {testResolvedPrompt && (
                    <button
                      onClick={() => setPreviewPrompt(testResolvedPrompt)}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded hover:opacity-80"
                      style={{ color: 'var(--color-accent, var(--color-primary))' }}
                    >View Composed Prompt ({testResolvedPrompt.length.toLocaleString()} chars)</button>
                  )}
                </div>
                <div className="p-3 space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inlineTestInput}
                      onChange={e => setInlineTestInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && runAgentTest(agent.id)}
                      placeholder="Enter a task to test this agent..."
                      className="flex-1 px-3 py-2 rounded-md text-xs outline-none"
                      style={{ backgroundColor: 'var(--color-surfaceSecondary, var(--color-surface))', border: '1px solid var(--color-border)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={() => runAgentTest(agent.id)}
                      disabled={inlineTestLoading || !inlineTestInput.trim()}
                      className="px-4 py-2 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ backgroundColor: 'var(--color-success)' }}
                    >{inlineTestLoading ? 'Running...' : 'Run Test'}</button>
                  </div>
                  {inlineTestOutput && (
                    <div className="rounded-md p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 20%, transparent))', border: '1px solid var(--color-border)' }}>
                      <div className="flex flex-wrap gap-4 mb-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        <span>Model: <strong style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{inlineTestOutput.model}</strong></span>
                        <span>Tokens: <strong style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{inlineTestOutput.tokens.toLocaleString()}</strong></span>
                        <span>Duration: <strong style={{ color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{(inlineTestOutput.durationMs / 1000).toFixed(1)}s</strong></span>
                        {inlineTestOutput.toolCalls.length > 0 && (
                          <span>Tools: <strong style={{ color: 'var(--color-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{inlineTestOutput.toolCalls.join(', ')}</strong></span>
                        )}
                      </div>
                      <pre className="text-[11px] overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {inlineTestOutput.response}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ maxWidth: '100%' }}>
      {/* Sticky Page Header */}
      <div className="flex flex-wrap items-center gap-3 px-7 py-4" style={{ borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--color-bg, var(--color-surface))' }}>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>Agent Registry</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {agents.length} agents &mdash; {platformAgents.length} platform &mdash; {backgroundAgents.length} background &mdash; {availableModels.length} models
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ backgroundColor: 'var(--color-surface)' }}>
            {(['registry', 'skills', 'playground', 'observability'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors capitalize"
                style={activeTab === tab
                  ? { backgroundColor: 'var(--color-accent, var(--color-primary))', color: '#fff' }
                  : { color: 'var(--text-tertiary)' }
                }
              >{tab}</button>
            ))}
          </div>
          <button
            onClick={() => setEditingAgent({
              id: '', display_name: '', agent_type: 'custom',
              model_config: { primaryModel: '', temperature: 0.7, maxTokens: 4000, maxIterations: 5 },
              system_prompt: '', tools_whitelist: [],
              skills: [], delegation: {}, background: null, enabled: true, created_at: '',
              prompt_strategy: 'composite', prompt_modules: [], prompt_mode: 'full',
              max_spawn_depth: 3, max_children: 5,
            })}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: '#fff' }}
          >
            <Plus size={12} /> New Agent
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 p-2 rounded-lg text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)', color: 'var(--color-error)' }}>
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">dismiss</button>
        </div>
      )}

      {/* Search */}
      <div className="px-7 py-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search agents by name, role, or description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md text-xs outline-none transition-colors"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-7 pb-4">
        {activeTab === 'registry' && (
          <div className="space-y-2">
            {/* Platform Agents */}
            <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '1.2px' }}>
              Platform Agents ({platformAgents.length})
            </div>
            {platformAgents.map(renderAgentCard)}

            {/* Background Agents */}
            {backgroundAgents.length > 0 && (
              <>
                <div className="text-[10px] font-bold uppercase mt-5 mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '1.2px' }}>
                  Background Agents ({backgroundAgents.length})
                </div>
                {backgroundAgents.map(renderAgentCard)}
              </>
            )}

            {filteredAgents.length === 0 && (
              <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                {searchQuery ? 'No agents match your search.' : 'No agents found. Check openagentic-proxy connectivity.'}
              </div>
            )}
          </div>
        )}

        {activeTab === 'skills' && (
          <SkillsMarketplaceView theme={theme} />
        )}

        {activeTab === 'playground' && (
          <AgentPlayground theme={theme} agents={agents as any} />
        )}

        {activeTab === 'observability' && (
          <AgentExecutionDashboard theme={theme} />
        )}
      </div>

      {/* Prompt Preview Modal */}
      {previewPrompt !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewPrompt(null)}>
          <div
            className="rounded-xl w-[640px] max-h-[75vh] flex flex-col shadow-2xl"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Composed Prompt Preview</h3>
              <button onClick={() => setPreviewPrompt(null)} className="p-1 rounded-lg transition-opacity hover:opacity-70" style={{ color: 'var(--color-text-secondary)' }}><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {previewPrompt}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setEditingAgent(null)}>
          <div
            className="rounded-xl w-[680px] max-h-[85vh] overflow-y-auto shadow-2xl"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {editingAgent.id ? 'Edit Agent' : 'Create Agent'}
              </h3>
              <button onClick={() => setEditingAgent(null)} className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: 'var(--color-text-secondary)' }}><X size={16} /></button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* Identity */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Identity</h4>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Display Name</label>
                  <input
                    value={editingAgent.display_name}
                    onChange={e => setEditingAgent({ ...editingAgent, display_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                    style={{
                      backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                      border: '1px solid var(--color-border, var(--color-border-default))',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Role / Type</label>
                    <select
                      value={editingAgent.agent_type}
                      onChange={e => setEditingAgent({ ...editingAgent, agent_type: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Description</label>
                    <input
                      value={editingAgent.description || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                      placeholder="What does this agent do?"
                    />
                  </div>
                </div>
              </div>

              {/* Model Configuration */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Model Configuration</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                      Primary Model <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(blank = slider)</span>
                    </label>
                    <select
                      value={editingAgent.model_config?.primaryModel || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, model_config: { ...editingAgent.model_config, primaryModel: e.target.value } })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="">Auto (slider-based)</option>
                      {availableModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Fallback Model</label>
                    <select
                      value={editingAgent.model_config?.fallbackModel || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, model_config: { ...editingAgent.model_config, fallbackModel: e.target.value } })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="">None</option>
                      {availableModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Max Iterations</label>
                    <input
                      type="number"
                      value={editingAgent.model_config?.maxIterations || 5}
                      onChange={e => setEditingAgent({ ...editingAgent, model_config: { ...editingAgent.model_config, maxIterations: parseInt(e.target.value) || 5 } })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      value={editingAgent.model_config?.temperature ?? 0.7}
                      onChange={e => setEditingAgent({ ...editingAgent, model_config: { ...editingAgent.model_config, temperature: parseFloat(e.target.value) || 0.7 } })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Max Tokens</label>
                    <input
                      type="number"
                      value={editingAgent.model_config?.maxTokens || 4000}
                      onChange={e => setEditingAgent({ ...editingAgent, model_config: { ...editingAgent.model_config, maxTokens: parseInt(e.target.value) || 4000 } })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Skills */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Skills</h4>
                {availableSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableSkills.map(skill => {
                      const isSelected = (editingAgent.skills || []).includes(skill.id) || (editingAgent.skills || []).includes(skill.name);
                      return (
                        <button
                          key={skill.id}
                          onClick={() => toggleSkill(skill.id || skill.name)}
                          className="px-2.5 py-1 text-xs rounded-lg transition-all border"
                          style={isSelected ? {
                            backgroundColor: 'color-mix(in srgb, var(--color-secondary) 20%, transparent)',
                            borderColor: 'var(--color-secondary)',
                            color: 'var(--color-secondary)',
                          } : {
                            backgroundColor: 'transparent',
                            borderColor: 'var(--color-border, var(--color-border-default))',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {isSelected ? '✓ ' : ''}{skill.display_name || skill.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <p className="text-xs mb-2" style={{ color: 'var(--color-text-tertiary)' }}>No skills defined. Enter skill names manually (comma-separated):</p>
                    <input
                      value={(editingAgent.skills || []).join(', ')}
                      onChange={e => setEditingAgent({ ...editingAgent, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                      placeholder="skill_name_1, skill_name_2"
                    />
                  </div>
                )}
              </div>

              {/* Persona */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Persona</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Role</label>
                    <input
                      value={(editingAgent as any).persona_role || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, persona_role: e.target.value } as any)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                      placeholder="e.g. Cloud Infrastructure Specialist"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Tone</label>
                    <select
                      value={(editingAgent as any).persona_tone || 'professional'}
                      onChange={e => setEditingAgent({ ...editingAgent, persona_tone: e.target.value } as any)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="professional">Professional</option>
                      <option value="casual">Casual</option>
                      <option value="technical">Technical</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                    Boundaries <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(what the agent should NOT do)</span>
                  </label>
                  <textarea
                    value={(editingAgent as any).persona_boundaries || ''}
                    onChange={e => setEditingAgent({ ...editingAgent, persona_boundaries: e.target.value } as any)}
                    className="w-full px-3 py-2 rounded-lg text-sm h-16 resize-none outline-none transition-colors"
                    style={{
                      backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                      border: '1px solid var(--color-border, var(--color-border-default))',
                      color: 'var(--color-text-primary)',
                    }}
                    placeholder="e.g. Never delete production resources without explicit approval"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                    Bootstrap Instructions <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(initial context for the agent)</span>
                  </label>
                  <textarea
                    value={(editingAgent as any).persona_bootstrap || ''}
                    onChange={e => setEditingAgent({ ...editingAgent, persona_bootstrap: e.target.value } as any)}
                    className="w-full px-3 py-2 rounded-lg text-sm h-20 resize-none outline-none transition-colors font-mono text-xs"
                    style={{
                      backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                      border: '1px solid var(--color-border, var(--color-border-default))',
                      color: 'var(--color-text-primary)',
                    }}
                    placeholder="Instructions provided to the agent at the start of every session"
                  />
                </div>
              </div>

              {/* Tool Policy */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Tool Policy</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>Mode</label>
                    <select
                      value={(editingAgent as any).tool_policy_mode || 'allow_all'}
                      onChange={e => setEditingAgent({ ...editingAgent, tool_policy_mode: e.target.value } as any)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="allow_all">Allow All</option>
                      <option value="allow_selected">Allow Selected</option>
                      <option value="deny_selected">Deny Selected</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={(editingAgent as any).tool_policy_auto_detect_high_risk !== false}
                        onChange={e => setEditingAgent({ ...editingAgent, tool_policy_auto_detect_high_risk: e.target.checked } as any)}
                        className="rounded"
                      />
                      High-risk tool auto-detection
                    </label>
                  </div>
                </div>
                {(editingAgent as any).tool_policy_mode && (editingAgent as any).tool_policy_mode !== 'allow_all' && (
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                      Tool List <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(comma-separated)</span>
                    </label>
                    <input
                      value={(editingAgent as any).tool_policy_list || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, tool_policy_list: e.target.value } as any)}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                      placeholder="admin_postgres_raw_query, azure_create_resource_group, k8s_delete"
                    />
                  </div>
                )}
                <div className="p-2 rounded-lg text-xs" style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-warning) 5%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 15%, transparent)',
                  color: 'var(--color-text-secondary)',
                }}>
                  <strong style={{ color: 'var(--color-warning)' }}>High-risk tools</strong> (admin_postgres_raw_query, azure_create_resource_group, k8s_delete, etc.) trigger HITL approval when auto-detection is enabled.
                </div>
              </div>

              {/* Prompt Configuration */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Prompt Configuration</h4>

                {/* Strategy toggle */}
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg p-0.5" style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))' }}>
                    {(['composite', 'custom'] as const).map(strategy => (
                      <button
                        key={strategy}
                        onClick={() => setEditingAgent({ ...editingAgent, prompt_strategy: strategy })}
                        className="px-3 py-1 text-xs rounded-md transition-colors capitalize"
                        style={(editingAgent.prompt_strategy || 'composite') === strategy
                          ? { backgroundColor: 'var(--color-accent, var(--color-accent-primary))', color: '#fff' }
                          : { color: 'var(--color-text-secondary)' }
                        }
                      >{strategy === 'composite' ? 'Composable' : 'Custom'}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Mode:</label>
                    <select
                      value={editingAgent.prompt_mode || 'full'}
                      onChange={e => setEditingAgent({ ...editingAgent, prompt_mode: e.target.value })}
                      className="px-2 py-1 rounded text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      <option value="full">Full</option>
                      <option value="minimal">Minimal</option>
                    </select>
                  </div>
                </div>

                {/* Composable modules */}
                {(editingAgent.prompt_strategy || 'composite') === 'composite' && (
                  <div className="space-y-3">
                    {(() => {
                      const CORE_MODULES = ['identity-default', 'safety', 'continuation'];
                      const CATEGORY_ORDER = ['core', 'mode', 'capability', 'domain'];
                      const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
                        core:       { bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)',     text: 'var(--color-error)' },
                        mode:       { bg: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',   text: 'var(--color-primary)' },
                        capability: { bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',   text: 'var(--color-success)' },
                        domain:     { bg: 'color-mix(in srgb, var(--color-secondary) 12%, transparent)', text: 'var(--color-secondary)' },
                      };

                      const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
                        acc[cat] = availableModules.filter(m => m.category === cat).sort((a, b) => a.priority - b.priority);
                        return acc;
                      }, {} as Record<string, typeof availableModules>);

                      // Also gather modules in unrecognized categories
                      const knownCats = new Set(CATEGORY_ORDER);
                      const otherModules = availableModules.filter(m => !knownCats.has(m.category));
                      if (otherModules.length > 0) grouped['other'] = otherModules;

                      const selectedModules = editingAgent.prompt_modules || [];

                      const toggleModule = (moduleId: string) => {
                        if (CORE_MODULES.includes(moduleId)) return;
                        const current = editingAgent.prompt_modules || [];
                        const next = current.includes(moduleId)
                          ? current.filter(m => m !== moduleId)
                          : [...current, moduleId];
                        setEditingAgent({ ...editingAgent, prompt_modules: next });
                      };

                      return (
                        <>
                          {availableModules.length === 0 && (
                            <div className="p-3 rounded-lg text-xs" style={{
                              backgroundColor: 'color-mix(in srgb, var(--color-warning) 5%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--color-warning) 15%, transparent)',
                              color: 'var(--color-text-secondary)',
                            }}>
                              No prompt modules loaded. Ensure the API endpoint <code style={{ color: 'var(--color-text-primary)' }}>/api/admin/prompt-modules</code> is available.
                            </div>
                          )}
                          {Object.entries(grouped).map(([category, modules]) => {
                            if (modules.length === 0) return null;
                            const catStyle = CATEGORY_COLORS[category] || { bg: 'color-mix(in srgb, var(--color-text-tertiary) 12%, transparent)', text: 'var(--color-text-tertiary)' };
                            return (
                              <div key={category}>
                                <div className="text-xs uppercase tracking-wider mb-1.5 font-medium" style={{ color: catStyle.text }}>
                                  {category}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {modules.map(mod => {
                                    const isCore = CORE_MODULES.includes(mod.id);
                                    const isSelected = isCore || selectedModules.includes(mod.id);
                                    return (
                                      <button
                                        key={mod.id}
                                        onClick={() => toggleModule(mod.id)}
                                        disabled={isCore}
                                        title={mod.description || mod.name}
                                        className="px-2 py-0.5 text-xs rounded-full transition-all border flex items-center gap-1"
                                        style={isSelected ? {
                                          backgroundColor: catStyle.bg,
                                          borderColor: catStyle.text,
                                          color: catStyle.text,
                                          opacity: isCore ? 0.7 : 1,
                                          cursor: isCore ? 'default' : 'pointer',
                                        } : {
                                          backgroundColor: 'transparent',
                                          borderColor: 'var(--color-border, var(--color-border-default))',
                                          color: 'var(--color-text-secondary)',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        {isCore && <span style={{ fontSize: '9px' }}>LOCKED</span>}
                                        {!isCore && isSelected && <span style={{ fontSize: '10px' }}>+</span>}
                                        {mod.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                          {/* Preview button */}
                          {editingAgent.id && (
                            <button
                              onClick={() => {
                                fetch(`/api/agents/resolve?id=${editingAgent.id}&mode=chat`, { credentials: 'include' })
                                  .then(r => r.json())
                                  .then(data => setPreviewPrompt(data.systemPrompt || 'No composed prompt available'))
                                  .catch(() => setPreviewPrompt('Failed to load preview'));
                              }}
                              className="px-3 py-1.5 text-xs rounded-lg transition-opacity hover:opacity-80 border"
                              style={{
                                borderColor: 'var(--color-accent, var(--color-accent-primary))',
                                color: 'var(--color-accent, var(--color-accent-primary))',
                                backgroundColor: 'color-mix(in srgb, var(--color-accent, var(--color-accent-primary)) 8%, transparent)',
                              }}
                            >
                              Preview Composed Prompt
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Custom system prompt */}
                {(editingAgent.prompt_strategy || 'composite') === 'custom' && (
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>System Prompt</label>
                    <textarea
                      value={editingAgent.system_prompt || ''}
                      onChange={e => setEditingAgent({ ...editingAgent, system_prompt: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm h-32 resize-none outline-none transition-colors font-mono text-xs"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                )}

                {/* Tools Whitelist */}
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                    Tools Whitelist <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(comma-separated, blank = all)</span>
                  </label>
                  <input
                    value={(editingAgent.tools_whitelist || []).join(', ')}
                    onChange={e => setEditingAgent({ ...editingAgent, tools_whitelist: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                    style={{
                      backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                      border: '1px solid var(--color-border, var(--color-border-default))',
                      color: 'var(--color-text-primary)',
                    }}
                    placeholder="web_search, web_fetch, memory_store"
                  />
                </div>
              </div>

              {/* Spawn Limits */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Spawn Limits</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                      Max Spawn Depth <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(1-5)</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={editingAgent.max_spawn_depth ?? 3}
                      onChange={e => setEditingAgent({ ...editingAgent, max_spawn_depth: Math.min(5, Math.max(1, parseInt(e.target.value) || 1)) })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-primary)' }}>
                      Max Children <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 'normal' }}>(1-20)</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={editingAgent.max_children ?? 5}
                      onChange={e => setEditingAgent({ ...editingAgent, max_children: Math.min(20, Math.max(1, parseInt(e.target.value) || 1)) })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
                        border: '1px solid var(--color-border, var(--color-border-default))',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--color-border, var(--color-border-default))' }}>
              <button
                onClick={() => setEditingAgent(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border, var(--color-border-default))' }}
              >Cancel</button>
              <button
                onClick={() => handleSave(editingAgent)}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--color-accent, var(--color-accent-primary))' }}
              >
                <Save size={14} /> Save Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
