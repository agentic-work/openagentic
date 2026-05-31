/**
 * Node Properties Panel
 * Professional right sidebar panel for configuring workflow nodes
 * Enhanced with better form controls, validation, and micro-interactions
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2, AlertCircle, Info, ChevronDown, Check } from '@/shared/icons';
import type { Node } from 'reactflow';
import type { NodeData } from '../types/workflow.types';
import { isFieldRequired } from '../utils/workflowValidator';
// Schema-driven settings — exposes required-field markers, enum values, defaults
// from the /node-schemas registry. UI agent #3 consumes this for full UX.
import { useNodeSchemaSettings } from '../hooks/useNodeSchemaSettings';
import { useNodeSchemas } from '../hooks/useNodeSchemas';
import { NodeDocsPanel } from './NodeDocsPanel';
import { fetchAgents as fetchAgentRegistry } from '../services/agentRegistryApi';
import { MultiAgentSlotEditor } from './MultiAgentSlotEditor';

// Fetch full agent config from the DB (SOT) — includes system_prompt, tools, model_config, thinking
const _agentConfigCache = new Map<string, { data: any; ts: number }>();
let _fullAgentListCache: { agents: any[]; ts: number } | null = null;

async function fetchFullAgentConfig(agentId: string): Promise<any | null> {
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
        const data = await res.json();
        _fullAgentListCache = { agents: Array.isArray(data) ? data : (data.agents || []), ts: Date.now() };
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
const AgentSOTConfig: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [config, setConfig] = React.useState<any>(null);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    fetchFullAgentConfig(agentId).then(setConfig);
  }, [agentId]);

  if (!config) return null;

  const modelConfig = config.model_config || config.modelConfig || {};
  const tools = config.tools_whitelist || config.tools || [];
  const systemPrompt = config.system_prompt || config.systemPrompt || '';

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      background: 'var(--color-surface)',
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
          <div><strong>Model:</strong> {modelConfig.primaryModel || modelConfig.defaultModel || config.model || 'auto'}</div>
          <div><strong>Temperature:</strong> {modelConfig.temperature ?? '—'}</div>
          <div><strong>Max Tokens:</strong> {modelConfig.maxTokens ?? '—'}</div>
          <div><strong>Thinking:</strong> {modelConfig.enableThinking ? `Enabled (budget: ${modelConfig.thinkingBudget || '—'})` : 'Disabled'}</div>
          {tools.length > 0 && (
            <div><strong>Tools ({tools.length}):</strong> {tools.slice(0, 5).join(', ')}{tools.length > 5 ? ` +${tools.length - 5} more` : ''}</div>
          )}
          {systemPrompt && (
            <div style={{ marginTop: 4 }}>
              <strong>System Prompt:</strong>
              <div style={{
                marginTop: 2, padding: '6px 8px', borderRadius: 4,
                background: 'rgba(0,0,0,0.15)', fontSize: 10, lineHeight: 1.4,
                maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {systemPrompt.substring(0, 500)}{systemPrompt.length > 500 ? '...' : ''}
              </div>
            </div>
          )}
          {config.skills && config.skills.length > 0 && (
            <div><strong>Skills:</strong> {config.skills.map((s: any) => s.name || s).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
};

interface NodePropertiesPanelProps {
  node: Node<NodeData> | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<NodeData>) => void;
  onDelete: (nodeId: string) => void;
  availableModels?: string[];
  availableTools?: Array<{ name: string; server: string; description?: string; inputSchema?: any }>;
  theme?: 'light' | 'dark';
}

// Form input components for consistent styling - CSS variable based for theme adherence
const FormInput: React.FC<{
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  min?: number;
  max?: number;
  required?: boolean;
  error?: boolean;
}> = ({ label, value, onChange, type = 'text', placeholder, helpText, min, max, required, error }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
      {required && <span style={{ color: '#f59e0b', marginLeft: 4, fontWeight: 800 }}>*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      data-required-field={required ? 'true' : undefined}
      data-field-error={error ? 'true' : undefined}
      className="w-full px-3 py-2.5 rounded-lg border text-sm transition-all focus:outline-none focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderColor: error ? '#ef4444' : 'var(--color-border)',
        color: 'var(--color-text)',
        ...(error ? { boxShadow: '0 0 0 1px rgba(239,68,68,0.3)' } : {}),
      }}
    />
    {error && !value && (
      <p className="text-xs mt-1 flex items-center gap-1" data-testid="required-field-error" style={{ color: '#ef4444' }}>
        <AlertCircle style={{ width: 10, height: 10 }} /> Required
      </p>
    )}
    {helpText && !error && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

const FormTextarea: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  monospace?: boolean;
  required?: boolean;
  error?: boolean;
}> = ({ label, value, onChange, rows = 3, placeholder, helpText, monospace = false, required, error }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
      {required && <span style={{ color: '#f59e0b', marginLeft: 4, fontWeight: 800 }}>*</span>}
    </label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      data-required-field={required ? 'true' : undefined}
      data-field-error={error ? 'true' : undefined}
      className={`w-full px-3 py-2.5 rounded-lg border text-sm transition-all resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary ${monospace ? 'font-mono' : ''}`}
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderColor: error ? '#ef4444' : 'var(--color-border)',
        color: 'var(--color-text)',
        ...(error ? { boxShadow: '0 0 0 1px rgba(239,68,68,0.3)' } : {}),
      }}
    />
    {helpText && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

const FormSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  isDark?: boolean;
  helpText?: string;
}> = ({ label, value, onChange, options, helpText }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 rounded-lg border text-sm transition-all appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1.5em 1.5em',
        paddingRight: '2.5rem'
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {helpText && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-xs font-semibold uppercase tracking-wider pt-2" style={{ color: 'var(--color-text-tertiary)' }}>
    {label}
  </div>
);

export const NodePropertiesPanel: React.FC<NodePropertiesPanelProps> = ({
  node,
  onClose,
  onUpdate,
  onDelete,
  availableModels = [],
  availableTools = [],
  theme = 'dark',
}) => {
  const [nodeData, setNodeData] = useState<NodeData>(node?.data || {} as NodeData);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showUniversalAdvanced, setShowUniversalAdvanced] = useState(false);

  // Schema-driven settings — available for downstream consumers and future
  // required-field marker rendering. Falls back gracefully for legacy node types.
  const schemaSettings = useNodeSchemaSettings(node?.type as string ?? '');
  // Full schema object (for the Docs panel) keyed by the same node type.
  const { byType: schemasByType } = useNodeSchemas();
  const fullSchema = schemasByType[node?.type as string ?? ''] ?? null;

  // Agent ID dropdown state (must be at component level for hooks rules)
  const [agentOptions, setAgentOptions] = useState<Array<{ id: string; display_name: string; agent_type: string; model?: string }>>([]);
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (node?.data) {
      setNodeData(node.data);
      setHasChanges(false);
    }
  }, [node]);

  // Fetch agents when panel opens for agent node types
  useEffect(() => {
    if (
      node?.type === 'agent_single' ||
      node?.type === 'agent_supervisor' ||
      node?.type === 'agent_pool' ||
      node?.type === 'multi_agent'
    ) {
      fetchAgentRegistry().then(setAgentOptions);
    }
  }, [node?.type]);

  // Close agent dropdown on outside click
  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as HTMLElement)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentDropdownOpen]);

  if (!node) return null;

  const isDark = theme === 'dark';

  const handleSave = () => {
    onUpdate(node.id, nodeData);
    setHasChanges(false);
    setShowSaveConfirmation(true);
    setTimeout(() => setShowSaveConfirmation(false), 2000);
  };

  const handleDelete = () => {
    if (confirm(`Delete node "${nodeData.label}"?`)) {
      onDelete(node.id);
      onClose();
    }
  };

  const updateData = (key: keyof NodeData, value: any) => {
    setNodeData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const renderTriggerConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Trigger Type
        </label>
        <select
          value={nodeData.triggerType || 'manual'}
          onChange={(e) => updateData('triggerType', e.target.value as any)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="manual">Manual</option>
          <option value="schedule">Schedule (Cron)</option>
          <option value="chat_message">Chat Message</option>
          <option value="file_upload">File Upload</option>
          <option value="webhook">Webhook</option>
          <option value="admin_action">Admin Action</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          How the workflow is started. Manual requires user action; Schedule uses cron; Webhook listens for HTTP calls.
        </p>
      </div>

      {nodeData.triggerType === 'schedule' && (
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Cron Expression
          </label>
          <input
            type="text"
            value={nodeData.triggerConfig?.cron || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, cron: e.target.value })}
            placeholder="0 */6 * * *"
            className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
            style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Example: 0 */6 * * * (every 6 hours)
          </p>
        </div>
      )}

      {nodeData.triggerType === 'chat_message' && (
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Message Pattern (optional)
          </label>
          <input
            type="text"
            value={nodeData.triggerConfig?.messagePattern || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, messagePattern: e.target.value })}
            placeholder="e.g., /workflow.*"
            className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
            style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Regex pattern to match incoming messages. Leave empty to trigger on any message.
          </p>
        </div>
      )}
    </div>
  );

  const renderMCPToolConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          MCP Tool
          <span style={{ color: '#f59e0b', marginLeft: 4, fontWeight: 800 }}>*</span>
        </label>
        <select
          value={nodeData.toolName || ''}
          onChange={(e) => {
            const selectedTool = availableTools.find(t => t.name === e.target.value);
            updateData('toolName', e.target.value);
            if (selectedTool) {
              updateData('serverName', selectedTool.server);
              updateData('toolServer', selectedTool.server);
              // Build default arguments from schema with default values
              if (selectedTool.inputSchema?.properties) {
                const defaults: Record<string, any> = {};
                for (const [k, v] of Object.entries(selectedTool.inputSchema.properties) as [string, any][]) {
                  if (v.default != null) defaults[k] = v.default;
                }
                updateData('arguments', defaults);
              }
            }
          }}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            borderColor: !nodeData.toolName ? '#f59e0b' : 'var(--color-border)',
            color: 'var(--color-text)',
            ...(!nodeData.toolName ? { boxShadow: '0 0 0 1px rgba(245,158,11,0.3)' } : {}),
          }}
        >
          <option value="">Select a tool...</option>
          {availableTools.map((tool) => (
            <option key={`${tool.server}-${tool.name}`} value={tool.name}>
              {tool.name} ({tool.server})
            </option>
          ))}
        </select>
        {nodeData.toolName && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Server: {nodeData.serverName}
          </p>
        )}
        {!nodeData.toolName && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f59e0b' }}>
            <AlertCircle style={{ width: 10, height: 10 }} /> Required — select an MCP tool
          </p>
        )}
      </div>

      {/* Schema-driven argument builder */}
      {(() => {
        const selectedTool = availableTools.find(t => t.name === nodeData.toolName);
        const schema = selectedTool?.inputSchema;
        const properties = schema?.properties || {};
        const required = schema?.required || [];
        const hasSchema = Object.keys(properties).length > 0;
        const args = typeof nodeData.arguments === 'object' && nodeData.arguments !== null ? nodeData.arguments : {};

        if (hasSchema) {
          return (
            <div className="space-y-3">
              <label className="block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Arguments
              </label>
              {Object.entries(properties).map(([key, prop]: [string, any]) => {
                const isRequired = required.includes(key);
                const value = (args as Record<string, any>)[key] ?? prop.default ?? '';
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {key}
                      {isRequired && <span style={{ color: '#f59e0b', marginLeft: 3 }}>*</span>}
                    </label>
                    {prop.description && (
                      <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        {prop.description}
                      </p>
                    )}
                    {prop.enum ? (
                      <select
                        value={String(value)}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value };
                          updateData('arguments', newArgs);
                        }}
                        className="w-full px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="">Select...</option>
                        {prop.enum.map((v: string) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : prop.type === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!value}
                          onChange={(e) => {
                            const newArgs = { ...args, [key]: e.target.checked };
                            updateData('arguments', newArgs);
                          }}
                          className="rounded"
                        />
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>{value ? 'true' : 'false'}</span>
                      </label>
                    ) : prop.type === 'number' || prop.type === 'integer' ? (
                      <input
                        type="number"
                        value={value}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value ? Number(e.target.value) : '' };
                          updateData('arguments', newArgs);
                        }}
                        placeholder={prop.default != null ? String(prop.default) : ''}
                        className="w-full px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value };
                          updateData('arguments', newArgs);
                        }}
                        placeholder={prop.default != null ? String(prop.default) : `Enter ${key}...`}
                        className="w-full px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      />
                    )}
                  </div>
                );
              })}
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Use {'{{nodeId.content}}'} or {'{{trigger.body.*}}'} for dynamic values from previous nodes.
              </p>
            </div>
          );
        }

        // Fallback: raw JSON editor when no schema available
        return (
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Arguments (JSON)
            </label>
            <textarea
              value={typeof nodeData.arguments === 'string' ? nodeData.arguments : JSON.stringify(nodeData.arguments || {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  updateData('arguments', parsed);
                } catch {
                  updateData('arguments', e.target.value as any);
                }
              }}
              rows={6}
              className="w-full px-3 py-2 rounded-lg border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
              style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              placeholder='{}'
            />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              JSON object of arguments passed to the tool. Use {'{{input}}'} for dynamic values from previous nodes.
            </p>
          </div>
        );
      })()}
    </div>
  );

  const renderLLMConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Model
        </label>
        <select
          value={nodeData.model || ''}
          onChange={(e) => updateData('model', e.target.value)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="auto">Auto (platform default)</option>
          {availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Select a model from configured providers, or use Auto to let the platform route automatically.
        </p>
      </div>

      <FormTextarea
        label="System Prompt"
        value={nodeData.systemPrompt || ''}
        onChange={(v) => updateData('systemPrompt', v)}
        rows={3}
        placeholder="You are a helpful assistant..."
        helpText="System prompt sets the AI's persona and instructions. Use {{variables}} for dynamic values."
      />

      <FormTextarea
        label="User Prompt Template"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{variable}} for input data..."
        helpText="Use {{input}} to reference previous node output"
        required={isFieldRequired('llm_completion', 'prompt')}
        error={isFieldRequired('llm_completion', 'prompt') && !nodeData.prompt?.trim()}
      />

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Temperature: {nodeData.temperature ?? 0.7}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={nodeData.temperature ?? 0.7}
          onChange={(e) => updateData('temperature', parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Precise</span>
          <span>Creative</span>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Max Tokens
        </label>
        <input
          type="number"
          value={nodeData.maxTokens || 1000}
          onChange={(e) => updateData('maxTokens', parseInt(e.target.value))}
          min="1"
          max="32000"
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Maximum tokens the model can generate in its response. Higher values allow longer outputs but cost more.
        </p>
      </div>
    </div>
  );

  const renderCodeConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Language
        </label>
        <select
          value={nodeData.language || 'javascript'}
          onChange={(e) => updateData('language', e.target.value as any)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="bash">Bash</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Runtime language for the code block. JavaScript runs in a sandboxed V8 environment.
        </p>
      </div>

      <FormTextarea
        label="Code"
        value={nodeData.code || ''}
        onChange={(v) => updateData('code', v)}
        rows={12}
        placeholder={`// Access input data:\nconst input = $input;\n\n// Return output:\nreturn { result: input };`}
        monospace
        helpText="Use $input to access previous node's output. The return value becomes this node's output."
        required={isFieldRequired('code', 'code')}
        error={isFieldRequired('code', 'code') && !nodeData.code?.trim()}
      />
    </div>
  );

  const renderConditionConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Condition Expression"
        value={nodeData.condition || ''}
        onChange={(v) => updateData('condition', v)}
        placeholder="e.g., $input.value > 100"
        helpText="Expression evaluated against the input data. Use $input to reference the previous node's output."
        required={isFieldRequired('condition', 'condition')}
        error={isFieldRequired('condition', 'condition') && !(nodeData.condition || (nodeData as any).expression)}
      />

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Operator
        </label>
        <select
          value={nodeData.operator || 'equals'}
          onChange={(e) => updateData('operator', e.target.value as any)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="equals">Equals</option>
          <option value="contains">Contains</option>
          <option value="greater_than">Greater Than</option>
          <option value="less_than">Less Than</option>
          <option value="regex">Regex Match</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Comparison operator. True branch follows when condition matches; false branch otherwise.
        </p>
      </div>
    </div>
  );

  const renderTransformConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Transform Type
        </label>
        <select
          value={nodeData.transformType || 'map'}
          onChange={(e) => updateData('transformType', e.target.value as any)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="map">Map</option>
          <option value="filter">Filter</option>
          <option value="reduce">Reduce</option>
          <option value="jsonpath">JSONPath</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Map transforms each item; Filter keeps matching items; Reduce aggregates into one value; JSONPath extracts data.
        </p>
      </div>

      <FormTextarea
        label="Expression"
        value={nodeData.transformExpression || ''}
        onChange={(v) => updateData('transformExpression', v)}
        rows={4}
        placeholder={nodeData.transformType === 'jsonpath' ? '$.data[*].name' : 'item => item.value * 2'}
        monospace
        helpText={nodeData.transformType === 'jsonpath'
          ? 'JSONPath expression to extract data. Example: $.data.results[0].name'
          : 'JavaScript arrow function. Example: item => item.value * 2'}
        required={isFieldRequired('transform', 'transform')}
        error={isFieldRequired('transform', 'transform') && !(nodeData.transformExpression || (nodeData as any).transform || (nodeData as any).expression || (nodeData as any).template || nodeData.code)}
      />
    </div>
  );

  const AdvancedToggle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div>
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs font-medium mt-2 mb-3 transition-colors hover:opacity-80"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
      </button>
      {showAdvanced && <div className="space-y-4">{children}</div>}
    </div>
  );

  const renderHttpRequestConfig = () => (
    <div className="space-y-4">
      <FormSelect
        label="Method"
        value={(nodeData as any).method || 'GET'}
        onChange={(v) => updateData('method' as any, v)}
        options={[
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'DELETE', label: 'DELETE' },
          { value: 'PATCH', label: 'PATCH' },
        ]}
        isDark={isDark}
        helpText="HTTP method for the request. GET for fetching data, POST for creating, PUT/PATCH for updating."
      />
      <FormInput
        label="URL"
        value={(nodeData as any).url || ''}
        onChange={(v) => updateData('url' as any, v)}
        placeholder="https://api.example.com/endpoint"
        isDark={isDark}
        helpText="Use {{variable}} for dynamic values"
        required={isFieldRequired('http_request', 'url')}
        error={isFieldRequired('http_request', 'url') && !(nodeData as any).url?.trim()}
      />
      <AdvancedToggle>
        <FormTextarea
          label="Headers (JSON)"
          value={(nodeData as any).headers || '{}'}
          onChange={(v) => updateData('headers' as any, v)}
          rows={4}
          placeholder={'{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{token}}"\n}'}
          isDark={isDark}
          monospace
          helpText="JSON object of request headers"
        />
        <FormTextarea
          label="Body"
          value={(nodeData as any).body || ''}
          onChange={(v) => updateData('body' as any, v)}
          rows={6}
          placeholder={'{\n  "key": "value"\n}'}
          isDark={isDark}
          monospace
          helpText="Request body (for POST/PUT/PATCH)"
        />
        <FormInput
          label="Timeout (ms)"
          value={(nodeData as any).timeout || 30000}
          onChange={(v) => updateData('timeout' as any, v)}
          type="number"
          isDark={isDark}
          min={1000}
          max={300000}
          helpText="Request timeout in milliseconds"
        />
      </AdvancedToggle>
    </div>
  );

  const renderApprovalConfig = () => (
    <div className="space-y-4">
      <FormTextarea
        label="Approval Message"
        value={(nodeData as any).message || ''}
        onChange={(v) => updateData('message' as any, v)}
        rows={3}
        placeholder="Please review and approve this workflow step..."
        isDark={isDark}
        helpText="Message shown to approvers"
      />
      <FormInput
        label="Approvers"
        value={(nodeData as any).approvers || ''}
        onChange={(v) => updateData('approvers' as any, v)}
        placeholder="user@example.com, team-lead@example.com"
        isDark={isDark}
        helpText="Comma-separated email addresses"
        required={isFieldRequired('approval', 'approvers')}
        error={isFieldRequired('approval', 'approvers') && !((nodeData as any).approvers || (nodeData as any).approverRole || (nodeData as any).notifyChannel)}
      />
      <AdvancedToggle>
        <FormInput
          label="Timeout (hours)"
          value={(nodeData as any).approvalTimeout || 24}
          onChange={(v) => updateData('approvalTimeout' as any, v)}
          type="number"
          isDark={isDark}
          min={1}
          max={720}
          helpText="Auto-reject after this many hours"
        />
        <FormInput
          label="Escalation Email"
          value={(nodeData as any).escalationEmail || ''}
          onChange={(v) => updateData('escalationEmail' as any, v)}
          placeholder="manager@example.com"
          isDark={isDark}
          helpText="Notified if approval times out"
        />
      </AdvancedToggle>
    </div>
  );

  const renderWaitConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Duration"
        value={(nodeData as any).duration || 5}
        onChange={(v) => updateData('duration' as any, v)}
        type="number"
        isDark={isDark}
        min={1}
        helpText="How long to wait before continuing"
      />
      <FormSelect
        label="Unit"
        value={(nodeData as any).durationUnit || 'seconds'}
        onChange={(v) => updateData('durationUnit' as any, v)}
        options={[
          { value: 'ms', label: 'Milliseconds' },
          { value: 'seconds', label: 'Seconds' },
          { value: 'minutes', label: 'Minutes' },
          { value: 'hours', label: 'Hours' },
        ]}
        isDark={isDark}
        helpText="Time unit for the wait duration"
      />
    </div>
  );

  const renderAgentSpawnConfig = () => {
    const toolPolicyMode = (nodeData as any).toolPolicyMode || 'allow_all';
    const selectedTools: string[] = (nodeData as any).selectedTools || [];

    return (
    <div className="space-y-4">
      <FormSelect
        label="Agent Type"
        value={(nodeData as any).agentType || 'chat'}
        onChange={(v) => updateData('agentType' as any, v)}
        options={[
          { value: 'chat', label: 'Chat Agent' },
          { value: 'code', label: 'Code Agent' },
          { value: 'research', label: 'Research Agent' },
        ]}
        isDark={isDark}
        helpText="Type of agent to spawn"
      />

      {/* Persona Section (collapsible) */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowPersona(!showPersona)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Persona</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPersona ? '' : '-rotate-90'}`} />
        </button>
        {showPersona && (
          <div className="px-3 pb-3 space-y-3">
            <FormSelect label="Tone" value={(nodeData as any).tone || 'professional'}
              options={[
                { value: 'professional', label: 'Professional' },
                { value: 'casual', label: 'Casual' },
                { value: 'technical', label: 'Technical' },
              ]}
              onChange={(v) => updateData('tone' as any, v)}
              helpText="Communication style for agent responses." />
            <FormTextarea label="Boundaries" value={(nodeData as any).boundaries || ''}
              onChange={(v) => updateData('boundaries' as any, v)} rows={2}
              placeholder="e.g., Do not access production databases..."
              helpText="What the agent should NOT do." />
            <FormTextarea label="Bootstrap Instructions" value={(nodeData as any).bootstrapInstructions || ''}
              onChange={(v) => updateData('bootstrapInstructions' as any, v)} rows={3}
              placeholder="Initial instructions before the main task..."
              helpText="Prepended to the agent's system prompt." />
          </div>
        )}
      </div>

      {/* Model */}
      {/* 2026-04-19 — Intelligence slider removed (task #144). Model is
          chosen by SmartModelRouter; per-user × per-model spend caps live
          in UserModelBudgetService. Leave Model field for explicit override. */}
      <SectionLabel label="Model" />
      <FormInput label="Model Override" value={(nodeData as any).model || ''}
        onChange={(v) => updateData('model' as any, v)} placeholder="Leave empty for auto routing"
        helpText="Pin a specific model for this node; leave blank for Smart Router." />
      <FormInput label="Max Turns" value={(nodeData as any).maxIterations || 10}
        onChange={(v) => updateData('maxIterations' as any, parseInt(v) || 10)} type="number" min={1} max={50}
        helpText="Maximum reasoning/tool-use turns." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={(nodeData as any).enableThinking || false}
          onChange={(e) => updateData('enableThinking' as any, e.target.checked)}
          className="rounded" id="spawn-enable-thinking" />
        <label htmlFor="spawn-enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Enable extended thinking
        </label>
      </div>
      {(nodeData as any).enableThinking && (
        <FormInput label="Thinking Budget (tokens)" value={(nodeData as any).thinkingBudget || 8192}
          onChange={(v) => updateData('thinkingBudget' as any, parseInt(v) || 8192)} type="number"
          min={1024} max={32000} helpText="Token budget for the thinking phase." />
      )}

      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="The task or question the agent will work on."
        required
        error={!nodeData.prompt?.trim()}
      />

      {/* Tool Policy (collapsible) */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowToolPolicy(!showToolPolicy)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Tool Policy</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showToolPolicy ? '' : '-rotate-90'}`} />
        </button>
        {showToolPolicy && (
          <div className="px-3 pb-3 space-y-3">
            <FormSelect label="Mode" value={toolPolicyMode}
              options={[
                { value: 'allow_all', label: 'Allow All Tools' },
                { value: 'allow_selected', label: 'Allow Selected Only' },
                { value: 'deny_selected', label: 'Deny Selected' },
              ]}
              onChange={(v) => updateData('toolPolicyMode' as any, v)} />
            {toolPolicyMode !== 'allow_all' && (
              <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                {availableTools.map(tool => (
                  <label key={`${tool.server}-${tool.name}`} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                    <input type="checkbox" className="rounded"
                      checked={selectedTools.includes(tool.name)}
                      onChange={(e) => {
                        const newTools = e.target.checked
                          ? [...selectedTools, tool.name]
                          : selectedTools.filter((t: string) => t !== tool.name);
                        updateData('selectedTools' as any, newTools);
                      }} />
                    <span style={{ color: 'var(--color-text)' }}>{tool.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Budgets & Approval */}
      <SectionLabel label="Budgets" />
      <FormInput label="Cost Budget ($)" value={(nodeData as any).costBudget || ''}
        onChange={(v) => updateData('costBudget' as any, parseFloat(v) || undefined)} type="number" min={0}
        placeholder="No limit" helpText="Maximum cost this agent can spend." />
      <FormInput label="Tool Call Limit" value={(nodeData as any).toolCallLimit || ''}
        onChange={(v) => updateData('toolCallLimit' as any, parseInt(v) || undefined)} type="number" min={1}
        placeholder="25 (default)" helpText="Maximum tool calls before forcing a final answer." />
      <FormSelect label="Approval Policy" value={(nodeData as any).approvalPolicy || 'none'}
        options={[
          { value: 'none', label: 'None' },
          { value: 'high_risk', label: 'High-Risk Tools Only' },
          { value: 'all', label: 'All Tool Calls' },
        ]}
        onChange={(v) => updateData('approvalPolicy' as any, v)} />

      {/* Memory */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowAgentMemory(!showAgentMemory)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Memory</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAgentMemory ? '' : '-rotate-90'}`} />
        </button>
        {showAgentMemory && (
          <div className="px-3 pb-3 space-y-3">
            <div className="flex items-center gap-3 py-1">
              <input type="checkbox" checked={(nodeData as any).persistMemory || false}
                onChange={(e) => updateData('persistMemory' as any, e.target.checked)}
                className="rounded" id="spawn-persist-memory" />
              <label htmlFor="spawn-persist-memory" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Persist Memory
              </label>
            </div>
            {(nodeData as any).persistMemory && (
              <FormSelect label="Memory Scope" value={(nodeData as any).memoryScope || 'node'}
                options={[
                  { value: 'node', label: 'Node' },
                  { value: 'workflow', label: 'Workflow' },
                  { value: 'global', label: 'Global' },
                ]}
                onChange={(v) => updateData('memoryScope' as any, v)} />
            )}
          </div>
        )}
      </div>

      <AdvancedToggle>
        <FormTextarea
          label="System Prompt"
          value={nodeData.systemPrompt || ''}
          onChange={(v) => updateData('systemPrompt', v)}
          rows={3}
          placeholder="You are a helpful assistant..."
          isDark={isDark}
          helpText="Sets the agent's persona and behavior."
        />
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input type="range" min="0" max="2" step="0.1" value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', parseFloat(e.target.value))} className="w-full" />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span><span>Creative</span>
          </div>
        </div>
        <FormInput label="Max Tokens" value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', parseInt(v) || 1000)} type="number" isDark={isDark}
          min={1} max={32000} helpText="Maximum tokens the model can generate." />
      </AdvancedToggle>
    </div>
    );
  };

  const renderSynthConfig = () => (
    <div className="space-y-4">
      <FormSelect
        label="Strategy"
        value={(nodeData as any).strategy || 'concat'}
        onChange={(v) => updateData('strategy' as any, v)}
        options={[
          { value: 'concat', label: 'Concatenate' },
          { value: 'summarize', label: 'Summarize' },
          { value: 'vote', label: 'Majority Vote' },
        ]}
        isDark={isDark}
        helpText="How to combine outputs from parallel branches"
      />
      <AdvancedToggle>
        <FormTextarea
          label="Synthesis Prompt"
          value={(nodeData as any).synthPrompt || ''}
          onChange={(v) => updateData('synthPrompt' as any, v)}
          rows={4}
          placeholder="Combine the following outputs into a single coherent response..."
          isDark={isDark}
          helpText="Used with 'summarize' strategy; prompt sent to LLM"
        />
      </AdvancedToggle>
    </div>
  );

  const renderLoopConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Iterate Over"
        value={(nodeData as any).iterateOver || ''}
        onChange={(v) => updateData('iterateOver' as any, v)}
        placeholder="$input.items"
        isDark={isDark}
        helpText="Expression that resolves to an array to iterate over"
      />
      <FormInput
        label="Item Variable Name"
        value={(nodeData as any).itemVariable || 'item'}
        onChange={(v) => updateData('itemVariable' as any, v)}
        placeholder="item"
        isDark={isDark}
        helpText="Variable name to reference each item (e.g. $item)"
      />
    </div>
  );

  const renderMergeConfig = () => (
    <div className="space-y-4">
      <FormSelect
        label="Merge Strategy"
        value={(nodeData as any).mergeStrategy || 'array'}
        onChange={(v) => updateData('mergeStrategy' as any, v)}
        options={[
          { value: 'array', label: 'Array - Collect into array' },
          { value: 'object', label: 'Object - Merge key-value pairs' },
          { value: 'concat', label: 'Concat - Concatenate strings' },
        ]}
        isDark={isDark}
        helpText="How to combine inputs from multiple branches"
      />
    </div>
  );

  const renderOpenagenticConfig = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Language
        </label>
        <select
          value={nodeData.language || 'javascript'}
          onChange={(e) => updateData('language', e.target.value as any)}
          className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
          style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="bash">Bash</option>
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Language for the code block. Runs in a secure Openagentic exec pod with full dev tooling.
        </p>
      </div>

      <FormTextarea
        label="Code"
        value={nodeData.code || ''}
        onChange={(v) => updateData('code', v)}
        rows={12}
        placeholder={`// Access input data:\nconst input = $input;\n\n// Return output:\nreturn { result: input };`}
        monospace
        helpText="Use $input to access previous node's output. Executed in an isolated container with persistent workspace."
        required={isFieldRequired('openagentic', 'code')}
        error={isFieldRequired('openagentic', 'code') && !nodeData.code?.trim()}
      />
    </div>
  );

  const renderBedrockConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Model ID"
        value={(nodeData as any).modelId || ''}
        onChange={(v) => updateData('modelId' as any, v)}
        placeholder="us.anthropic.claude-opus-4-6-v1"
        isDark={isDark}
        helpText="Bedrock model identifier"
      />
      <FormSelect
        label="Region"
        value={(nodeData as any).region || 'us-east-1'}
        onChange={(v) => updateData('region' as any, v)}
        options={[
          { value: 'us-east-1', label: 'US East (N. Virginia)' },
          { value: 'us-west-2', label: 'US West (Oregon)' },
          { value: 'eu-west-1', label: 'EU (Ireland)' },
        ]}
        isDark={isDark}
        helpText="AWS region where the Bedrock model is deployed"
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('bedrock', 'prompt')}
        error={isFieldRequired('bedrock', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );

  const renderVertexConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Model ID"
        value={(nodeData as any).modelId || ''}
        onChange={(v) => updateData('modelId' as any, v)}
        placeholder="gemini-2.0-flash"
        isDark={isDark}
        helpText="Vertex AI model identifier"
      />
      <FormInput
        label="Location"
        value={(nodeData as any).location || 'us-central1'}
        onChange={(v) => updateData('location' as any, v)}
        placeholder="us-central1"
        isDark={isDark}
        helpText="GCP region for the Vertex AI endpoint"
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('vertex', 'prompt')}
        error={isFieldRequired('vertex', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );

  const renderAzureAIConfig = () => (
    <div className="space-y-4">
      <FormInput
        label="Deployment Name"
        value={(nodeData as any).deploymentName || ''}
        onChange={(v) => updateData('deploymentName' as any, v)}
        placeholder="gpt-4o-deployment"
        isDark={isDark}
        helpText="Azure OpenAI deployment name"
        required={isFieldRequired('azure_ai', 'deploymentName')}
        error={isFieldRequired('azure_ai', 'deploymentName') && !((nodeData as any).deploymentName || (nodeData as any).deployment)}
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('azure_ai', 'prompt')}
        error={isFieldRequired('azure_ai', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );

  const renderOpenagenticLLMConfig = () => {
    return (
    <div className="space-y-4">
      {/* 2026-04-19 — Intelligence slider removed (task #144). Model
          selection goes through SmartModelRouter; admin configures
          per-user × per-model budgets in the User Permissions view. */}
      <FormTextarea
        label="System Prompt"
        value={nodeData.systemPrompt || ''}
        onChange={(v) => updateData('systemPrompt', v)}
        rows={3}
        placeholder="You are a helpful assistant..."
        isDark={isDark}
        helpText="System prompt sets the AI's persona and instructions. Use {{variables}} for dynamic values."
      />
      <FormTextarea
        label="User Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output"
        required={isFieldRequired('openagentic_llm', 'prompt')}
        error={isFieldRequired('openagentic_llm', 'prompt') && !nodeData.prompt?.trim()}
      />
      <FormSelect
        label="Model Override"
        value={(nodeData as any).modelOverride || 'auto'}
        onChange={(v) => updateData('modelOverride' as any, v)}
        options={[
          { value: 'auto', label: 'Auto (Smart Router)' },
          ...availableModels.map(m => ({ value: m, label: m })),
        ]}
        isDark={isDark}
        helpText="Pin a specific model for this node; leave on Auto for Smart Router."
      />
      <AdvancedToggle>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input type="range" min="0" max="2" step="0.1" value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', parseFloat(e.target.value))} className="w-full" />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span><span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput label="Max Tokens" value={nodeData.maxTokens || 4096}
          onChange={(v) => updateData('maxTokens', parseInt(v) || 4096)} type="number" isDark={isDark} min={1} max={32000}
          helpText="Maximum tokens the model can generate. Higher values allow longer outputs but cost more." />
        <div className="flex items-center gap-3 py-1">
          <input type="checkbox" checked={(nodeData as any).enableThinking || false}
            onChange={(e) => updateData('enableThinking' as any, e.target.checked)}
            className="rounded" id="enable-thinking" />
          <label htmlFor="enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Enable extended thinking
          </label>
        </div>
        <p className="text-xs -mt-2 ml-7" style={{ color: 'var(--color-text-tertiary)' }}>
          Allows the model to reason step-by-step before responding. Improves accuracy on complex tasks.
        </p>
        {(nodeData as any).enableThinking && (
          <FormInput label="Thinking Budget (tokens)" value={(nodeData as any).thinkingBudget || 8192}
            onChange={(v) => updateData('thinkingBudget' as any, parseInt(v) || 8192)} type="number" isDark={isDark}
            min={1024} max={32000} helpText="Token budget for the thinking phase" />
        )}
      </AdvancedToggle>
    </div>
  );
  };

  const renderMultiAgentConfig = () => {
    const agents: any[] = Array.isArray((nodeData as any).agents) ? (nodeData as any).agents : [];
    const pattern: string = (nodeData as any).pattern || 'parallel';
    const updateAgents = (next: any[]) => updateData('agents' as any, next);
    const addAgent = () => updateAgents([...agents, { agentId: '', taskDescription: '' }]);
    const removeAgent = (i: number) => updateAgents(agents.filter((_, idx) => idx !== i));
    const updateAgent = (i: number, patch: Partial<any>) =>
      updateAgents(agents.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

    return (
      <div className="space-y-4">
        <div className="p-2.5 rounded-lg text-xs" style={{ background: 'rgba(33,150,243,0.08)', color: '#2196f3', border: '1px solid rgba(33,150,243,0.2)' }}>
          Multi-agent orchestration. Pick a <strong>pattern</strong> below, then add registered agents from the SOT registry. Each slot accepts an <code>agentId</code>; inline ghost agents are deprecated — register agents in the Admin console first.
        </div>

        <FormSelect
          label="Orchestration Pattern"
          value={pattern}
          onChange={(v) => updateData('pattern' as any, v)}
          options={[
            { value: 'parallel', label: 'Parallel — fan out, aggregate' },
            { value: 'sequential', label: 'Sequential — handoff chain' },
            { value: 'supervisor', label: 'Supervisor — manager + workers' },
            { value: 'debate', label: 'Debate — pro/con/judge' },
          ]}
          isDark={isDark}
          helpText="Maps to openagentic-proxy orchestration mode. Debate routes through sequential with explicit framing."
        />

        <div>
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Agents ({agents.length})
          </label>
          {agents.length === 0 && (
            <div className="text-xs italic mb-2" style={{ color: 'var(--color-text-tertiary, #999)' }}>
              No agents yet — click <strong>+ Add agent</strong> below.
            </div>
          )}
          <div className="space-y-2">
            {agents.map((spec, i) => (
              <MultiAgentSlotEditor
                key={i}
                index={i}
                spec={spec}
                agentOptions={agentOptions}
                availableModels={availableModels}
                onChange={(patch) => updateAgent(i, patch)}
                onRemove={() => removeAgent(i)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addAgent}
            className="mt-2 text-xs"
            style={{ padding: '6px 10px', background: 'rgba(33,150,243,0.12)', color: '#2196f3', border: '1px solid rgba(33,150,243,0.3)', borderRadius: 4, cursor: 'pointer' }}
          >
            + Add agent
          </button>
        </div>

        <FormInput label="Max Concurrency" value={(nodeData as any).maxConcurrency || 5}
          onChange={(v) => updateData('maxConcurrency' as any, parseInt(v) || 5)} type="number" isDark={isDark}
          min={1} max={20} helpText="Cap on simultaneous agents (parallel pattern only)." />

        <FormSelect
          label="Aggregation Strategy"
          value={(nodeData as any).aggregationStrategy || 'merge'}
          onChange={(v) => updateData('aggregationStrategy' as any, v)}
          options={[
            { value: 'merge', label: 'Merge — combine all outputs' },
            { value: 'first', label: 'First — fastest agent wins' },
            { value: 'vote', label: 'Vote — majority consensus' },
          ]}
          isDark={isDark}
          helpText="How to combine outputs across agents."
        />

        <AdvancedToggle>
          <FormInput label="Total Timeout (ms)" value={(nodeData as any).timeoutMs || 120000}
            onChange={(v) => updateData('timeoutMs' as any, parseInt(v) || 120000)} type="number" isDark={isDark}
            min={5000} max={600000} helpText="Wall-clock cap across all agents." />
          <FormSelect
            label="Share context across agents"
            value={(nodeData as any).sharedContext === false ? 'false' : 'true'}
            onChange={(v) => updateData('sharedContext' as any, v === 'true')}
            options={[
              { value: 'true', label: 'Yes — prepend upstream input as context' },
              { value: 'false', label: 'No — agents see only their task' },
            ]}
            isDark={isDark}
          />
        </AdvancedToggle>
      </div>
    );
  };

  // ─── Agent-Proxy Node Config ───────────────────────────────────────
  const [showPersona, setShowPersona] = useState(false);
  const [showToolPolicy, setShowToolPolicy] = useState(false);
  const [showAgentMemory, setShowAgentMemory] = useState(false);

  const renderAgentSingleConfig = () => {
    const toolPolicyMode = (nodeData as any).toolPolicyMode || 'allow_all';
    const selectedTools: string[] = (nodeData as any).selectedTools || [];
    const currentAgentId = (nodeData as any).agentId || '';
    const filteredAgents = agentOptions.filter(a =>
      !agentSearchQuery || a.display_name.toLowerCase().includes(agentSearchQuery.toLowerCase()) || a.id.toLowerCase().includes(agentSearchQuery.toLowerCase())
    );
    const selectedAgent = agentOptions.find(a => a.id === currentAgentId);

    return (
    <div className="space-y-4">
      <SectionLabel label="Agent Configuration" />
      {/* Agent ID — searchable dropdown with fallback to text input */}
      <div ref={agentDropdownRef} style={{ position: 'relative' }}>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          Agent ID {isFieldRequired('agent_single', 'agentId') && <span style={{ color: '#f44336' }}>*</span>}
        </label>
        <div
          onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
          style={{
            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--color-border)', background: 'var(--color-surface)',
            fontSize: 13, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedAgent ? `${selectedAgent.display_name} (${selectedAgent.agent_type})` : currentAgentId || 'Select an agent...'}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
        </div>
        <AnimatePresence>
          {agentDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', maxHeight: 240, overflowY: 'auto',
              }}
            >
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
                <input
                  autoFocus
                  value={agentSearchQuery}
                  onChange={(e) => setAgentSearchQuery(e.target.value)}
                  placeholder="Search agents..."
                  style={{
                    width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 4,
                    border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)',
                    color: 'var(--color-text)', outline: 'none',
                  }}
                />
              </div>
              {filteredAgents.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>No agents found</div>
              )}
              {filteredAgents.map(agent => (
                <div
                  key={agent.id}
                  onClick={() => {
                    updateData('agentId' as any, agent.id);
                    setAgentDropdownOpen(false);
                    setAgentSearchQuery('');
                  }}
                  style={{
                    padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                    background: agent.id === currentAgentId ? 'var(--color-surface-hover)' : 'transparent',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = agent.id === currentAgentId ? 'var(--color-surface-hover)' : 'transparent'; }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{agent.display_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {agent.agent_type}{agent.model ? ` · ${agent.model}` : ''} · {agent.id}
                  </div>
                </div>
              ))}
              {/* Manual entry option */}
              <div style={{ padding: '6px 12px', borderTop: '1px solid var(--color-border)' }}>
                <FormInput label="" value={currentAgentId}
                  onChange={(v) => updateData('agentId' as any, v)}
                  placeholder="Or enter custom agent ID..."
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
          Select from registry or enter a custom ID
        </div>
      </div>

      {/* Agent SOT Config — read-only view of full agent config from database */}
      {currentAgentId && selectedAgent && (
        <AgentSOTConfig agentId={currentAgentId} />
      )}

      {/* Persona Section (collapsible) */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowPersona(!showPersona)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Persona</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPersona ? '' : '-rotate-90'}`} />
        </button>
        {showPersona && (
          <div className="px-3 pb-3 space-y-3">
            <FormSelect label="Role" value={(nodeData as any).role || 'custom'}
              options={[
                { value: 'reasoning', label: 'Reasoning' },
                { value: 'data_query', label: 'Data Query' },
                { value: 'tool_orchestration', label: 'Tool Orchestration' },
                { value: 'summarization', label: 'Summarization' },
                { value: 'code_execution', label: 'Code Execution' },
                { value: 'planning', label: 'Planning' },
                { value: 'validation', label: 'Validation' },
                { value: 'synthesis', label: 'Synthesis' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => updateData('role' as any, v)}
              helpText="The agent's specialization." />
            <FormSelect label="Tone" value={(nodeData as any).tone || 'professional'}
              options={[
                { value: 'professional', label: 'Professional' },
                { value: 'casual', label: 'Casual' },
                { value: 'technical', label: 'Technical' },
              ]}
              onChange={(v) => updateData('tone' as any, v)}
              helpText="Communication style for agent responses." />
            <FormTextarea label="Boundaries" value={(nodeData as any).boundaries || ''}
              onChange={(v) => updateData('boundaries' as any, v)} rows={2}
              placeholder="e.g., Do not access production databases, do not generate executable code..."
              helpText="What the agent should NOT do. Enforced in the system prompt." />
            <FormTextarea label="Bootstrap Instructions" value={(nodeData as any).bootstrapInstructions || ''}
              onChange={(v) => updateData('bootstrapInstructions' as any, v)} rows={3}
              placeholder="Initial instructions or context given before the main task..."
              helpText="Prepended to the agent's system prompt for additional context." />
          </div>
        )}
      </div>

      {/* Model */}
      {/* 2026-04-19 — Intelligence slider removed (task #144). Model is
          chosen by SmartModelRouter unless an override is set; per-user
          × per-model spend caps live in UserModelBudgetService. */}
      <SectionLabel label="Model" />
      <FormInput label="Model Override" value={(nodeData as any).model || ''}
        onChange={(v) => updateData('model' as any, v)}
        placeholder="Leave empty for auto routing"
        helpText="Pin a specific model for this node; leave blank for Smart Router." />
      <FormInput label="Max Turns" value={(nodeData as any).maxTurns || 5}
        onChange={(v) => updateData('maxTurns' as any, parseInt(v) || 5)} type="number" min={1} max={50}
        helpText="Maximum reasoning/tool-use turns before returning." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={(nodeData as any).enableThinking || false}
          onChange={(e) => updateData('enableThinking' as any, e.target.checked)}
          className="rounded" id="agent-enable-thinking" />
        <label htmlFor="agent-enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Enable extended thinking
        </label>
      </div>
      {(nodeData as any).enableThinking && (
        <FormInput label="Thinking Budget (tokens)" value={(nodeData as any).thinkingBudget || 8192}
          onChange={(v) => updateData('thinkingBudget' as any, parseInt(v) || 8192)} type="number"
          min={1024} max={32000} helpText="Token budget for the thinking phase." />
      )}

      {/* Tool Policy (collapsible) */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowToolPolicy(!showToolPolicy)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Tool Policy</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showToolPolicy ? '' : '-rotate-90'}`} />
        </button>
        {showToolPolicy && (
          <div className="px-3 pb-3 space-y-3">
            <FormSelect label="Mode" value={toolPolicyMode}
              options={[
                { value: 'allow_all', label: 'Allow All Tools' },
                { value: 'allow_selected', label: 'Allow Selected Only' },
                { value: 'deny_selected', label: 'Deny Selected' },
              ]}
              onChange={(v) => updateData('toolPolicyMode' as any, v)}
              helpText="Controls which tools the agent can use." />
            {toolPolicyMode !== 'allow_all' && (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {toolPolicyMode === 'allow_selected' ? 'Allowed Tools' : 'Denied Tools'}
                </label>
                <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  {availableTools.length === 0 ? (
                    <p className="text-xs py-2 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No tools available</p>
                  ) : (
                    availableTools.map(tool => (
                      <label key={`${tool.server}-${tool.name}`} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                        <input type="checkbox" className="rounded"
                          checked={selectedTools.includes(tool.name)}
                          onChange={(e) => {
                            const newTools = e.target.checked
                              ? [...selectedTools, tool.name]
                              : selectedTools.filter((t: string) => t !== tool.name);
                            updateData('selectedTools' as any, newTools);
                          }} />
                        <span style={{ color: 'var(--color-text)' }}>{tool.name}</span>
                        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>({tool.server})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Budgets */}
      <SectionLabel label="Budgets" />
      <FormInput label="Cost Budget ($)" value={(nodeData as any).costBudget || ''}
        onChange={(v) => updateData('costBudget' as any, parseFloat(v) || undefined)} type="number" min={0}
        placeholder="No limit"
        helpText="Maximum cost this agent can spend on LLM calls." />
      <FormInput label="Tool Call Limit" value={(nodeData as any).toolCallLimit || ''}
        onChange={(v) => updateData('toolCallLimit' as any, parseInt(v) || undefined)} type="number" min={1}
        placeholder="25 (default)"
        helpText="Maximum number of tool calls before forcing a final answer." />

      {/* Approval */}
      <SectionLabel label="Approval" />
      <FormSelect label="Approval Policy" value={(nodeData as any).approvalPolicy || 'none'}
        options={[
          { value: 'none', label: 'None' },
          { value: 'high_risk', label: 'High-Risk Tools Only' },
          { value: 'all', label: 'All Tool Calls' },
        ]}
        onChange={(v) => updateData('approvalPolicy' as any, v)}
        helpText="When to require human approval for tool calls." />

      {/* Memory (collapsible) */}
      <div className="border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={() => setShowAgentMemory(!showAgentMemory)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}>
          <span>Memory</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAgentMemory ? '' : '-rotate-90'}`} />
        </button>
        {showAgentMemory && (
          <div className="px-3 pb-3 space-y-3">
            <div className="flex items-center gap-3 py-1">
              <input type="checkbox" checked={(nodeData as any).persistMemory || false}
                onChange={(e) => updateData('persistMemory' as any, e.target.checked)}
                className="rounded" id="agent-persist-memory" />
              <label htmlFor="agent-persist-memory" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Persist Memory
              </label>
            </div>
            {(nodeData as any).persistMemory && (
              <FormSelect label="Memory Scope" value={(nodeData as any).memoryScope || 'node'}
                options={[
                  { value: 'node', label: 'Node - This node only' },
                  { value: 'workflow', label: 'Workflow - Shared across workflow' },
                  { value: 'global', label: 'Global - Persists across executions' },
                ]}
                onChange={(v) => updateData('memoryScope' as any, v)}
                helpText="How broadly the agent's memory is shared." />
            )}
          </div>
        )}
      </div>

      {/* System Prompt Override */}
      <FormTextarea label="System Prompt Override" value={(nodeData as any).systemPrompt || ''}
        onChange={(v) => updateData('systemPrompt' as any, v)}
        placeholder="Override the agent's system prompt (optional)"
        helpText="Custom system prompt. Overrides the role-based default. Use {{input}} for dynamic values." />

      <FormInput label="Timeout (ms)" value={(nodeData as any).timeout || 60000}
        onChange={(v) => updateData('timeout' as any, parseInt(v) || 60000)} type="number" min={5000}
        helpText="Maximum execution time in milliseconds. Agent is terminated if exceeded." />
    </div>
    );
  };

  const renderAgentPoolConfig = () => (
    <div className="space-y-4">
      <SectionLabel label="Agent Pool Configuration" />
      <FormInput label="Concurrency" value={(nodeData as any).concurrency || 5}
        onChange={(v) => updateData('concurrency' as any, parseInt(v) || 5)} type="number" min={1} max={20}
        helpText="Maximum agents running in parallel." />
      <FormSelect label="Aggregation Strategy" value={(nodeData as any).aggregation || 'merge'}
        options={[
          { value: 'first', label: 'First - Fastest agent wins' },
          { value: 'vote', label: 'Vote - Majority consensus' },
          { value: 'merge', label: 'Merge - Concatenate all outputs' },
          { value: 'supervisor_synthesis', label: 'Supervisor Synthesis - LLM combines results' },
        ]}
        onChange={(v) => updateData('aggregation' as any, v)}
        helpText="How to combine results from all agents." />
      <FormInput label="Timeout Per Agent (s)" value={(nodeData as any).timeoutPerAgent || 60}
        onChange={(v) => updateData('timeoutPerAgent' as any, parseInt(v) || 60)} type="number" min={5} max={600}
        helpText="Maximum time each agent can run before being terminated." />
      <div className="text-[12px] p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
        Configure individual agents by connecting Agent nodes to this pool's input handles.
      </div>
    </div>
  );

  const renderAgentSupervisorConfig = () => (
    <div className="space-y-4">
      <SectionLabel label="Supervisor Configuration" />
      <FormTextarea label="Supervisor Instructions" value={(nodeData as any).supervisorPrompt || ''}
        onChange={(v) => updateData('supervisorPrompt' as any, v)} rows={4}
        placeholder="You are a supervisor managing a team of worker agents. Delegate tasks based on each worker's specialization..."
        helpText="Instructions for how the supervisor should plan, delegate, and quality-check worker outputs." />
      <FormInput label="Supervisor Model" value={(nodeData as any).supervisorModel || ''}
        onChange={(v) => updateData('supervisorModel' as any, v)}
        placeholder="e.g., claude-sonnet-4-6"
        helpText="Should be a capable model (e.g., Claude Sonnet or GPT-4o) for planning and delegation." />
      <FormInput label="Max Delegation Rounds" value={(nodeData as any).maxDelegationRounds || 5}
        onChange={(v) => updateData('maxDelegationRounds' as any, parseInt(v) || 5)} type="number" min={1} max={20}
        helpText="Maximum number of delegation cycles before the supervisor must finalize." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={(nodeData as any).allowDynamicWorkers || false}
          onChange={(e) => updateData('allowDynamicWorkers' as any, e.target.checked)}
          className="rounded" id="allow-dynamic-workers" />
        <label htmlFor="allow-dynamic-workers" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Allow dynamic worker creation
        </label>
      </div>
      <p className="text-xs -mt-2 ml-7" style={{ color: 'var(--color-text-tertiary)' }}>
        When enabled, the supervisor can spawn new worker agents on-the-fly for tasks not covered by connected workers.
      </p>
      <FormTextarea label="Worker Agents (JSON)" value={(nodeData as any).workers ? JSON.stringify((nodeData as any).workers, null, 2) : ''}
        onChange={(v) => { try { updateData('workers' as any, JSON.parse(v)); } catch { /* wait for valid JSON */ } }}
        rows={5} monospace
        placeholder={'[\n  { "id": "researcher", "role": "research", "model": "auto" },\n  { "id": "writer", "role": "summarization", "model": "auto" }\n]'}
        helpText="JSON array of worker agent definitions. Each needs at least an id and role." />
      <div className="text-[12px] p-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
        You can also connect worker Agent nodes to this supervisor visually on the canvas.
      </div>
    </div>
  );

  const renderTextNoteConfig = () => (
    <div className="space-y-4">
      <FormTextarea
        label="Text Content"
        value={(nodeData as any).text || ''}
        onChange={(v) => updateData('text' as any, v)}
        rows={6}
        placeholder="Describe what this part of the flow does..."
        isDark={isDark}
        helpText="Markdown-style text that appears on the canvas as an annotation"
      />
      <FormInput
        label="Font Size"
        value={(nodeData as any).fontSize || 13}
        onChange={(v) => updateData('fontSize' as any, v)}
        type="number"
        isDark={isDark}
        min={10}
        max={24}
        helpText="Text size in pixels (10-24)"
      />
      <FormInput
        label="Text Color"
        value={(nodeData as any).textColor || '#c9d1d9'}
        onChange={(v) => updateData('textColor' as any, v)}
        isDark={isDark}
        helpText="Hex color for the text (e.g., #c9d1d9)"
      />
      <FormInput
        label="Background Color"
        value={(nodeData as any).bgColor || 'transparent'}
        onChange={(v) => updateData('bgColor' as any, v)}
        isDark={isDark}
        helpText="Background color. Use 'transparent' for no background."
      />
    </div>
  );

  const renderUniversalAdvancedConfig = () => {
    const retryPolicy = (nodeData as any).retryPolicy || {};
    const onError = (nodeData as any).onError || 'stop';

    return (
      <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => setShowUniversalAdvanced(!showUniversalAdvanced)}
          className="w-full flex items-center justify-between py-3 text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <span>Advanced Configuration</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showUniversalAdvanced ? '' : '-rotate-90'}`} />
        </button>
        {showUniversalAdvanced && (
          <div className="space-y-4 pb-2">
            {/* Disabled toggle */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="node-disabled"
                checked={(nodeData as any).disabled || false}
                onChange={(e) => updateData('disabled' as any, e.target.checked)}
                className="rounded"
              />
              <label htmlFor="node-disabled" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Disabled (skip during execution)
              </label>
            </div>

            {/* Timeout */}
            <FormInput
              label="Timeout (seconds)"
              value={(nodeData as any).timeoutMs ? Math.round((nodeData as any).timeoutMs / 1000) : ''}
              onChange={(v) => updateData('timeoutMs' as any, v ? parseInt(v) * 1000 : undefined)}
              type="number"
              placeholder="30"
              isDark={isDark}
              min={1}
              helpText="Max time before node is killed. Leave empty for workflow default."
            />

            {/* On Error */}
            <FormSelect
              label="On Error"
              value={onError}
              onChange={(v) => updateData('onError' as any, v)}
              options={[
                { value: 'stop', label: 'Stop Workflow' },
                { value: 'continue', label: 'Continue' },
                { value: 'retry', label: 'Retry' },
                { value: 'error_handler', label: 'Route to Error Handler' },
              ]}
              isDark={isDark}
            />

            {/* Retry Policy */}
            {onError === 'retry' && (
              <div className="space-y-3 pl-3 border-l-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                  Retry Policy
                </div>
                <FormInput
                  label="Max Retries"
                  value={retryPolicy.maxRetries ?? 3}
                  onChange={(v) => updateData('retryPolicy' as any, { ...retryPolicy, maxRetries: parseInt(v) || 3 })}
                  type="number"
                  isDark={isDark}
                  min={1}
                  max={10}
                />
                <FormInput
                  label="Delay (ms)"
                  value={retryPolicy.delayMs ?? 1000}
                  onChange={(v) => updateData('retryPolicy' as any, { ...retryPolicy, delayMs: parseInt(v) || 1000 })}
                  type="number"
                  isDark={isDark}
                  min={100}
                />
                <FormSelect
                  label="Backoff Strategy"
                  value={retryPolicy.backoff || 'fixed'}
                  onChange={(v) => updateData('retryPolicy' as any, { ...retryPolicy, backoff: v })}
                  options={[
                    { value: 'fixed', label: 'Fixed' },
                    { value: 'exponential', label: 'Exponential' },
                  ]}
                  isDark={isDark}
                />
              </div>
            )}

            {/* Pinned Test Output */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="checkbox"
                  id="use-pinned-data"
                  checked={(nodeData as any).usePinnedData || false}
                  onChange={(e) => updateData('usePinnedData' as any, e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="use-pinned-data" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Use pinned data instead of executing
                </label>
              </div>
              <FormTextarea
                label="Pinned Test Output"
                value={(nodeData as any).pinnedData || ''}
                onChange={(v) => updateData('pinnedData' as any, v)}
                rows={4}
                placeholder='{"result": "sample output"}'
                isDark={isDark}
                monospace
                helpText="JSON data returned when pinned mode is active. Useful for testing downstream nodes."
              />
            </div>

            {/* Output Format */}
            <FormSelect
              label="Output Format"
              value={(nodeData as any).outputFormat || 'auto'}
              onChange={(v) => updateData('outputFormat' as any, v === 'auto' ? undefined : v)}
              options={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'markdown', label: 'Markdown' },
                { value: 'html', label: 'HTML' },
                { value: 'json', label: 'JSON' },
                { value: 'table', label: 'Table' },
              ]}
              isDark={isDark}
              helpText="How this node's output should be formatted in the results panel."
            />

            {/* Persist to Milvus */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="persist-to-milvus"
                checked={(nodeData as any).persistToMilvus || false}
                onChange={(e) => updateData('persistToMilvus' as any, e.target.checked)}
                className="rounded"
              />
              <label htmlFor="persist-to-milvus" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Save output to Knowledge Base
              </label>
            </div>

            {/* Notes */}
            <FormTextarea
              label="Notes"
              value={(nodeData as any).notes || ''}
              onChange={(v) => updateData('notes' as any, v)}
              rows={3}
              placeholder="Internal documentation about this node..."
              isDark={isDark}
              helpText="Freeform notes for documentation. Not used during execution."
            />
          </div>
        )}
      </div>
    );
  };

  const renderErrorHandlerConfig = () => (
    <div className="space-y-4">
      <FormSelect label="Error Action" value={(nodeData as any).errorAction || 'log'}
        onChange={(v) => updateData('errorAction' as any, v)}
        options={[
          { value: 'log', label: 'Log - Record and continue' },
          { value: 'retry', label: 'Retry - Re-execute failed node' },
          { value: 'notify', label: 'Notify - Send alert' },
          { value: 'transform', label: 'Transform - Convert error to output' },
        ]}
        helpText="What to do when an error reaches this handler." />
      <FormTextarea label="Error Message Template" value={(nodeData as any).errorMessage || ''}
        onChange={(v) => updateData('errorMessage' as any, v)} rows={3}
        placeholder="Error in {{nodeId}}: {{error.message}}"
        helpText="Template for error output. Use {{error.message}}, {{error.stack}}, {{nodeId}}." />
      <AdvancedToggle>
        <FormInput label="Max Retries" value={(nodeData as any).maxRetries || 3}
          onChange={(v) => updateData('maxRetries' as any, parseInt(v) || 3)} type="number"
          min={0} max={10} helpText="Number of retry attempts (for retry action)." />
        <FormInput label="Retry Delay (ms)" value={(nodeData as any).retryDelay || 1000}
          onChange={(v) => updateData('retryDelay' as any, parseInt(v) || 1000)} type="number"
          min={100} max={60000} helpText="Delay between retries." />
        <FormSelect label="Backoff" value={(nodeData as any).backoff || 'exponential'}
          onChange={(v) => updateData('backoff' as any, v)}
          options={[
            { value: 'fixed', label: 'Fixed' },
            { value: 'exponential', label: 'Exponential' },
          ]}
          helpText="Retry delay strategy." />
      </AdvancedToggle>
    </div>
  );

  const renderSlackConfig = () => (
    <div className="space-y-4">
      <FormInput label="Channel" value={(nodeData as any).channel || ''}
        onChange={(v) => updateData('channel' as any, v)}
        placeholder="#general or C01234567"
        helpText="Slack channel name or ID."
        required error={!(nodeData as any).channel?.trim()} />
      <FormTextarea label="Message" value={(nodeData as any).message || ''}
        onChange={(v) => updateData('message' as any, v)} rows={4}
        placeholder="Workflow {{workflowName}} completed: {{input}}"
        helpText="Supports Slack mrkdwn and {{variable}} templates."
        required error={!(nodeData as any).message?.trim()} />
      <AdvancedToggle>
        <FormInput label="Bot Name" value={(nodeData as any).botName || 'OpenAgentic'}
          onChange={(v) => updateData('botName' as any, v)} helpText="Display name for the bot." />
        <FormInput label="Thread TS" value={(nodeData as any).threadTs || ''}
          onChange={(v) => updateData('threadTs' as any, v)}
          placeholder="Optional - reply in thread"
          helpText="Thread timestamp to reply in an existing thread." />
      </AdvancedToggle>
    </div>
  );

  const renderTeamsConfig = () => (
    <div className="space-y-4">
      <FormInput label="Webhook URL" value={(nodeData as any).webhookUrl || ''}
        onChange={(v) => updateData('webhookUrl' as any, v)}
        placeholder="https://outlook.office.com/webhook/..."
        helpText="Microsoft Teams incoming webhook URL. Use {{secret:teams_webhook}} for secrets."
        required error={!(nodeData as any).webhookUrl?.trim()} />
      <FormTextarea label="Message" value={(nodeData as any).message || ''}
        onChange={(v) => updateData('message' as any, v)} rows={4}
        placeholder="Workflow completed with result: {{input}}"
        helpText="Message body. Supports {{variable}} templates."
        required error={!(nodeData as any).message?.trim()} />
      <AdvancedToggle>
        <FormInput label="Title" value={(nodeData as any).title || ''}
          onChange={(v) => updateData('title' as any, v)}
          placeholder="Workflow Notification"
          helpText="Card title shown in the Teams message." />
      </AdvancedToggle>
    </div>
  );

  const renderEmailConfig = () => (
    <div className="space-y-4">
      <FormInput label="To" value={(nodeData as any).to || ''}
        onChange={(v) => updateData('to' as any, v)}
        placeholder="user@example.com"
        helpText="Recipient email address(es), comma-separated."
        required error={!(nodeData as any).to?.trim()} />
      <FormInput label="Subject" value={(nodeData as any).subject || ''}
        onChange={(v) => updateData('subject' as any, v)}
        placeholder="Workflow Result: {{workflowName}}"
        helpText="Email subject line. Supports {{variable}} templates."
        required error={!(nodeData as any).subject?.trim()} />
      <FormTextarea label="Body" value={(nodeData as any).body || ''}
        onChange={(v) => updateData('body' as any, v)} rows={6}
        placeholder="The workflow completed with the following output:\n\n{{input}}"
        helpText="Email body. Supports HTML and {{variable}} templates."
        required error={!(nodeData as any).body?.trim()} />
      <AdvancedToggle>
        <FormInput label="CC" value={(nodeData as any).cc || ''}
          onChange={(v) => updateData('cc' as any, v)} placeholder="cc@example.com"
          helpText="CC recipients, comma-separated." />
        <FormSelect label="Format" value={(nodeData as any).bodyFormat || 'html'}
          onChange={(v) => updateData('bodyFormat' as any, v)}
          options={[{ value: 'html', label: 'HTML' }, { value: 'text', label: 'Plain Text' }]}
          helpText="Email body format." />
      </AdvancedToggle>
    </div>
  );

  const renderPagerDutyConfig = () => (
    <div className="space-y-4">
      <FormInput label="Service ID" value={(nodeData as any).serviceId || ''}
        onChange={(v) => updateData('serviceId' as any, v)}
        placeholder="P1234567"
        helpText="PagerDuty service ID to create the incident on."
        required error={!(nodeData as any).serviceId?.trim()} />
      <FormInput label="Title" value={(nodeData as any).title || ''}
        onChange={(v) => updateData('title' as any, v)}
        placeholder="[OpenAgentic] {{error.message}}"
        helpText="Incident title. Supports {{variable}} templates."
        required error={!(nodeData as any).title?.trim()} />
      <FormSelect label="Severity" value={(nodeData as any).severity || 'warning'}
        onChange={(v) => updateData('severity' as any, v)}
        options={[
          { value: 'critical', label: 'Critical' },
          { value: 'error', label: 'Error' },
          { value: 'warning', label: 'Warning' },
          { value: 'info', label: 'Info' },
        ]}
        helpText="Incident severity level." />
      <FormTextarea label="Details" value={(nodeData as any).details || ''}
        onChange={(v) => updateData('details' as any, v)} rows={3}
        placeholder="Workflow {{workflowName}} failed at node {{nodeId}}"
        helpText="Incident body/details." />
    </div>
  );

  const renderServiceNowConfig = () => (
    <div className="space-y-4">
      <FormSelect label="Table" value={(nodeData as any).table || 'incident'}
        onChange={(v) => updateData('table' as any, v)}
        options={[
          { value: 'incident', label: 'Incident' },
          { value: 'change_request', label: 'Change Request' },
          { value: 'problem', label: 'Problem' },
          { value: 'sc_request', label: 'Service Request' },
        ]}
        helpText="ServiceNow table to create the record in." />
      <FormInput label="Short Description" value={(nodeData as any).shortDescription || ''}
        onChange={(v) => updateData('shortDescription' as any, v)}
        placeholder="Automated ticket from workflow"
        helpText="Ticket short description."
        required error={!(nodeData as any).shortDescription?.trim()} />
      <FormTextarea label="Description" value={(nodeData as any).description || ''}
        onChange={(v) => updateData('description' as any, v)} rows={4}
        placeholder="Workflow output:\n{{input}}"
        helpText="Full ticket description. Supports {{variable}} templates." />
      <AdvancedToggle>
        <FormSelect label="Priority" value={(nodeData as any).priority || '3'}
          onChange={(v) => updateData('priority' as any, v)}
          options={[
            { value: '1', label: '1 - Critical' },
            { value: '2', label: '2 - High' },
            { value: '3', label: '3 - Moderate' },
            { value: '4', label: '4 - Low' },
          ]}
          helpText="Ticket priority level." />
        <FormInput label="Assignment Group" value={(nodeData as any).assignmentGroup || ''}
          onChange={(v) => updateData('assignmentGroup' as any, v)}
          placeholder="IT Operations"
          helpText="ServiceNow assignment group." />
      </AdvancedToggle>
    </div>
  );

  const renderJiraConfig = () => (
    <div className="space-y-4">
      <FormInput label="Project Key" value={(nodeData as any).projectKey || ''}
        onChange={(v) => updateData('projectKey' as any, v)}
        placeholder="PROJ"
        helpText="Jira project key."
        required error={!(nodeData as any).projectKey?.trim()} />
      <FormSelect label="Issue Type" value={(nodeData as any).issueType || 'Task'}
        onChange={(v) => updateData('issueType' as any, v)}
        options={[
          { value: 'Bug', label: 'Bug' },
          { value: 'Task', label: 'Task' },
          { value: 'Story', label: 'Story' },
          { value: 'Epic', label: 'Epic' },
        ]}
        helpText="Jira issue type." />
      <FormInput label="Summary" value={(nodeData as any).summary || ''}
        onChange={(v) => updateData('summary' as any, v)}
        placeholder="[OpenAgentic] {{workflowName}} result"
        helpText="Issue summary/title."
        required error={!(nodeData as any).summary?.trim()} />
      <FormTextarea label="Description" value={(nodeData as any).jiraDescription || ''}
        onChange={(v) => updateData('jiraDescription' as any, v)} rows={4}
        placeholder="Workflow output:\n\n{{input}}"
        helpText="Issue description. Supports Jira wiki markup and {{variable}} templates." />
      <AdvancedToggle>
        <FormInput label="Labels" value={(nodeData as any).labels || ''}
          onChange={(v) => updateData('labels' as any, v)}
          placeholder="openagentic, automated"
          helpText="Comma-separated labels." />
        <FormInput label="Assignee" value={(nodeData as any).assignee || ''}
          onChange={(v) => updateData('assignee' as any, v)}
          placeholder="user@example.com"
          helpText="Jira user to assign the issue to." />
      </AdvancedToggle>
    </div>
  );

  const renderDiscordConfig = () => (
    <div className="space-y-4">
      <FormInput label="Webhook URL" value={(nodeData as any).webhookUrl || ''}
        onChange={(v) => updateData('webhookUrl' as any, v)}
        placeholder="https://discord.com/api/webhooks/..."
        helpText="Discord webhook URL. Use {{secret:discord_webhook}} for secrets."
        required error={!(nodeData as any).webhookUrl?.trim()} />
      <FormTextarea label="Message" value={(nodeData as any).message || ''}
        onChange={(v) => updateData('message' as any, v)} rows={4}
        placeholder="Workflow completed: {{input}}"
        helpText="Message content. Supports Discord markdown and {{variable}} templates."
        required error={!(nodeData as any).message?.trim()} />
      <AdvancedToggle>
        <FormInput label="Username" value={(nodeData as any).username || 'OpenAgentic'}
          onChange={(v) => updateData('username' as any, v)} helpText="Bot display name." />
      </AdvancedToggle>
    </div>
  );

  const renderUserContextConfig = () => (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg text-xs" style={{ background: 'rgba(33,150,243,0.08)', color: '#2196f3', border: '1px solid rgba(33,150,243,0.2)' }}>
        Loads cross-mode user context (chat history, preferences, recent interactions) to enrich downstream nodes.
      </div>
      <FormSelect label="Context Scope" value={(nodeData as any).contextScope || 'recent'}
        onChange={(v) => updateData('contextScope' as any, v)}
        options={[
          { value: 'recent', label: 'Recent - Last 24h interactions' },
          { value: 'session', label: 'Session - Current session only' },
          { value: 'full', label: 'Full - All available context' },
        ]}
        helpText="How much user context to load." />
      <FormInput label="Max Items" value={(nodeData as any).maxItems || 10}
        onChange={(v) => updateData('maxItems' as any, parseInt(v) || 10)} type="number"
        min={1} max={100} helpText="Maximum context items to include." />
    </div>
  );

  const renderRagQueryConfig = () => (
    <div className="space-y-4">
      <FormInput label="Collection Name" value={(nodeData as any).collectionName || ''}
        onChange={(v) => updateData('collectionName' as any, v)}
        placeholder="my_knowledge_base"
        helpText="Milvus collection to query."
        required error={!(nodeData as any).collectionName?.trim()} />
      <FormTextarea label="Query" value={(nodeData as any).queryText || ''}
        onChange={(v) => updateData('queryText' as any, v)} rows={3}
        placeholder="{{input.message}}"
        helpText="Search query text. Supports {{input}} template variables."
        required error={!(nodeData as any).queryText?.trim()} />
      <FormInput label="Top K" value={(nodeData as any).topK || 10}
        onChange={(v) => updateData('topK' as any, parseInt(v) || 10)} type="number"
        min={1} max={100} helpText="Number of results to return." />
      <FormTextarea label="Filters (JSON)" value={(nodeData as any).filters || '{}'}
        onChange={(v) => updateData('filters' as any, v)} rows={2} monospace
        placeholder='{"category": "docs"}'
        helpText="Optional Milvus filter expression as JSON." />
      <AdvancedToggle>
        <FormSelect label="Embedding Model" value={(nodeData as any).embeddingModel || 'auto'}
          onChange={(v) => updateData('embeddingModel' as any, v)}
          options={[
            { value: 'auto', label: 'Auto (platform default)' },
            ...availableModels.filter(m => m.includes('embed')).map(m => ({ value: m, label: m })),
          ]}
          helpText="Model used to embed the query text." />
      </AdvancedToggle>
    </div>
  );

  const renderFileUploadConfig = () => (
    <div className="space-y-4">
      <FormInput label="Collection Name" value={(nodeData as any).collectionName || ''}
        onChange={(v) => updateData('collectionName' as any, v)}
        placeholder="my_knowledge_base"
        helpText="Target Milvus collection for ingestion."
        required error={!(nodeData as any).collectionName?.trim()} />
      <FormSelect label="Source Type" value={(nodeData as any).fileSource || 'input_data'}
        onChange={(v) => updateData('fileSource' as any, v)}
        options={[
          { value: 'input_data', label: 'Input Data - From upstream node' },
          { value: 'url', label: 'URL - Fetch from remote URL' },
          { value: 'file_path', label: 'File Path - Local/mounted path' },
        ]}
        helpText="Where to read the file from." />
      <FormInput label="Chunk Size" value={(nodeData as any).chunkSize || 512}
        onChange={(v) => updateData('chunkSize' as any, parseInt(v) || 512)} type="number"
        min={64} max={8192} helpText="Characters per chunk for splitting." />
      <FormInput label="Chunk Overlap" value={(nodeData as any).chunkOverlap || 50}
        onChange={(v) => updateData('chunkOverlap' as any, parseInt(v) || 50)} type="number"
        min={0} max={1024} helpText="Overlap between adjacent chunks." />
      <AdvancedToggle>
        <FormSelect label="Embedding Model" value={(nodeData as any).embeddingModel || 'auto'}
          onChange={(v) => updateData('embeddingModel' as any, v)}
          options={[
            { value: 'auto', label: 'Auto (platform default)' },
            ...availableModels.filter(m => m.includes('embed')).map(m => ({ value: m, label: m })),
          ]}
          helpText="Model used to generate embeddings." />
      </AdvancedToggle>
    </div>
  );

  const renderWebhookResponseConfig = () => (
    <div className="space-y-4">
      <FormInput label="Status Code" value={(nodeData as any).statusCode || 200}
        onChange={(v) => updateData('statusCode' as any, parseInt(v) || 200)} type="number"
        min={100} max={599} helpText="HTTP status code to return (e.g. 200, 201, 400)." />
      <FormTextarea label="Headers (JSON)" value={(nodeData as any).headers || '{}'}
        onChange={(v) => updateData('headers' as any, v)} rows={3} monospace
        placeholder='{"Content-Type": "application/json"}'
        helpText="Response headers as JSON object." />
      <FormTextarea label="Body Template" value={(nodeData as any).bodyTemplate || ''}
        onChange={(v) => updateData('bodyTemplate' as any, v)} rows={4} monospace
        placeholder='{"result": "{{input}}"}'
        helpText="Response body. Supports {{input}} template variables." />
    </div>
  );

  const renderSwitchConfig = () => {
    const cases: Array<{ value: string; label: string }> = (nodeData as any).cases || [];
    return (
      <div className="space-y-4">
        <FormInput label="Expression" value={(nodeData as any).expression || ''}
          onChange={(v) => updateData('expression' as any, v)}
          placeholder="$input.status"
          helpText="Expression to evaluate. Each case matches against this value."
          required error={!(nodeData as any).expression?.trim()} />
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Cases
          </label>
          <div className="space-y-2">
            {cases.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={c.value}
                  onChange={(e) => {
                    const updated = [...cases];
                    updated[i] = { ...updated[i], value: e.target.value };
                    updateData('cases' as any, updated);
                  }}
                  placeholder="Value"
                  className="flex-1 px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <input
                  type="text"
                  value={c.label}
                  onChange={(e) => {
                    const updated = [...cases];
                    updated[i] = { ...updated[i], label: e.target.value };
                    updateData('cases' as any, updated);
                  }}
                  placeholder="Label"
                  className="flex-1 px-2 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  onClick={() => {
                    const updated = cases.filter((_, idx) => idx !== i);
                    updateData('cases' as any, updated);
                  }}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors"
                  style={{ color: '#ef4444' }}
                  title="Remove case"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const updated = [...cases, { value: `case_${cases.length + 1}`, label: `Case ${cases.length + 1}` }];
              updateData('cases' as any, updated);
            }}
            className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            + Add Case
          </button>
          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Each case creates an output port. Add a "default" case for unmatched values.
          </p>
        </div>
      </div>
    );
  };

  const renderParallelConfig = () => (
    <div className="space-y-4">
      <FormSelect label="Mode" value={(nodeData as any).mode || 'split'}
        onChange={(v) => updateData('mode' as any, v)}
        options={[
          { value: 'split', label: 'Split - Fan-out to parallel branches' },
          { value: 'join', label: 'Join - Fan-in and aggregate results' },
        ]}
        helpText="Split distributes input to branches; Join waits for all branches to complete." />
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={(nodeData as any).waitForAll !== false}
            onChange={(e) => updateData('waitForAll' as any, e.target.checked)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Wait for All</span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          When enabled, waits for all branches before continuing. When disabled, continues when any branch completes.
        </p>
      </div>
      <FormInput label="Timeout (ms)" value={(nodeData as any).timeoutMs || 60000}
        onChange={(v) => updateData('timeoutMs' as any, parseInt(v) || 60000)} type="number"
        min={1000} max={600000} helpText="Max time to wait for branches to complete." />
    </div>
  );

  const renderReasoningConfig = () => (
    <div className="space-y-4">
      <FormTextarea label="Prompt" value={(nodeData as any).prompt || ''}
        onChange={(v) => updateData('prompt' as any, v)} rows={5}
        placeholder="Analyze the following data and provide a detailed reasoning..."
        helpText="The reasoning prompt. Supports {{input}} template variables."
        required error={!(nodeData as any).prompt?.trim()} />
      <FormInput label="Thinking Budget (tokens)" value={(nodeData as any).thinkingBudget || 16384}
        onChange={(v) => updateData('thinkingBudget' as any, parseInt(v) || 16384)} type="number"
        min={1024} max={131072} helpText="Maximum tokens allocated for chain-of-thought reasoning." />
      <FormSelect label="Model" value={(nodeData as any).model || 'auto'}
        onChange={(v) => updateData('model' as any, v)}
        options={[
          { value: 'auto', label: 'Auto (platform routing)' },
          ...availableModels.map(m => ({ value: m, label: m })),
        ]}
        helpText="Model to use for reasoning. Auto uses platform model routing." />
      <FormSelect label="Output Format" value={(nodeData as any).outputFormat || 'text'}
        onChange={(v) => updateData('outputFormat' as any, v)}
        options={[
          { value: 'text', label: 'Text - Plain text output' },
          { value: 'json', label: 'JSON - Structured JSON output' },
          { value: 'markdown', label: 'Markdown - Formatted markdown' },
        ]}
        helpText="Format of the reasoning output." />
    </div>
  );

  const renderNodeConfig = () => {
    switch (node.type) {
      case 'trigger':
        return renderTriggerConfig();
      case 'mcp_tool':
        return renderMCPToolConfig();
      case 'llm_completion':
        return renderLLMConfig();
      case 'openagentic_llm':
        return renderOpenagenticLLMConfig();
      case 'multi_agent':
        return renderMultiAgentConfig();
      case 'bedrock':
        return renderBedrockConfig();
      case 'vertex':
        return renderVertexConfig();
      case 'azure_ai':
        return renderAzureAIConfig();
      case 'code':
        return renderCodeConfig();
      case 'condition':
        return renderConditionConfig();
      case 'transform':
        return renderTransformConfig();
      case 'http_request':
        return renderHttpRequestConfig();
      case 'approval':
      case 'human_approval':
        return renderApprovalConfig();
      case 'wait':
        return renderWaitConfig();
      case 'agent_spawn':
      case 'a2a':
        return renderAgentSpawnConfig();
      case 'agent_single':
        return renderAgentSingleConfig();
      case 'agent_pool':
        return renderAgentPoolConfig();
      case 'agent_supervisor':
        return renderAgentSupervisorConfig();
      case 'synth':
        return renderSynthConfig();
      case 'loop':
        return renderLoopConfig();
      case 'merge':
        return renderMergeConfig();
      case 'openagentic':
        return renderOpenagenticConfig();
      case 'text':
        return renderTextNoteConfig();
      case 'error_handler':
        return renderErrorHandlerConfig();
      case 'slack_message':
        return renderSlackConfig();
      case 'teams_message':
        return renderTeamsConfig();
      case 'outlook_email':
      case 'send_email':
        return renderEmailConfig();
      case 'pagerduty_incident':
        return renderPagerDutyConfig();
      case 'servicenow_ticket':
        return renderServiceNowConfig();
      case 'jira_issue':
        return renderJiraConfig();
      case 'discord_message':
        return renderDiscordConfig();
      case 'user_context':
        return renderUserContextConfig();
      case 'rag_query':
        return renderRagQueryConfig();
      case 'file_upload':
        return renderFileUploadConfig();
      case 'webhook_response':
        return renderWebhookResponseConfig();
      case 'switch':
        return renderSwitchConfig();
      case 'parallel':
        return renderParallelConfig();
      case 'reasoning':
        return renderReasoningConfig();
      default:
        // Generic schema-driven renderer — fires for any node type that's
        // migrated to the schema registry but doesn't have an explicit
        // case above. Loops schema.settings[] and emits an input per
        // setting based on its declared type, with required-field markers
        // pulled from the schema (NOT the legacy NODE_REQUIRED_FIELDS map).
        // Closes the gap users hit when a node says "X is required" via
        // the validator but the panel has no input for X.
        return renderSchemaDrivenConfig();
    }
  };

  /** Generic schema-driven settings renderer. Used as the fallback for
   *  any node type without an explicit case above. */
  const renderSchemaDrivenConfig = () => {
    if (!schemaSettings.hasSchema || schemaSettings.settings.length === 0) {
      return (
        <div style={{
          padding: '12px',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--color-text-tertiary)',
        }}>
          No schema definition available for <code>{node.type}</code>. This
          node type isn't yet migrated to the schema-driven plugin
          registry — its data fields can still be edited via the JSON
          inspector below.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {schemaSettings.settings.map((setting) => {
          const value = (nodeData as any)[setting.name] ?? '';
          const isRequired = setting.required === true;
          const hasError = isRequired && (value === '' || value == null);
          const labelText = setting.label || setting.name;
          const helpText = setting.description;

          if (setting.type === 'enum' && Array.isArray(setting.values)) {
            return (
              <FormSelect
                key={setting.name}
                label={labelText + (isRequired ? ' *' : '')}
                value={String(value || setting.default || '')}
                onChange={(v) => updateData(setting.name as any, v)}
                options={setting.values.map((v) => ({ value: v, label: v }))}
                helpText={helpText}
              />
            );
          }
          if (setting.type === 'boolean') {
            return (
              <div key={setting.name} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{labelText}</div>
                  {helpText && <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{helpText}</div>}
                </div>
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => updateData(setting.name as any, e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
              </div>
            );
          }
          if (setting.type === 'number') {
            return (
              <FormInput
                key={setting.name}
                label={labelText}
                value={value as number}
                onChange={(v) => updateData(setting.name as any, Number(v))}
                type="number"
                placeholder={setting.placeholder}
                helpText={helpText}
                min={setting.min}
                max={setting.max}
                required={isRequired}
                error={hasError}
              />
            );
          }
          if (setting.type === 'json' || setting.type === 'object') {
            return (
              <FormTextarea
                key={setting.name}
                label={labelText}
                value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
                onChange={(v) => updateData(setting.name as any, v)}
                rows={6}
                placeholder={setting.placeholder || '{ }'}
                helpText={helpText}
                monospace
                required={isRequired}
                error={hasError}
              />
            );
          }
          if (setting.type === 'code') {
            return (
              <FormTextarea
                key={setting.name}
                label={labelText}
                value={String(value || '')}
                onChange={(v) => updateData(setting.name as any, v)}
                rows={8}
                placeholder={setting.placeholder}
                helpText={helpText}
                monospace
                required={isRequired}
                error={hasError}
              />
            );
          }
          if (setting.type === 'secret_ref') {
            return (
              <FormInput
                key={setting.name}
                label={labelText}
                value={String(value || '')}
                onChange={(v) => updateData(setting.name as any, v)}
                placeholder={setting.placeholder || '{{secret:NAME}}'}
                helpText={helpText || 'Reference a secret with `{{secret:NAME}}` syntax — never paste literal credentials.'}
                required={isRequired}
                error={hasError}
              />
            );
          }
          // Default: plain string input. Long fields go to a textarea
          // so the user can edit prompts comfortably.
          const isLong = (setting.placeholder || '').length > 80
            || setting.name.toLowerCase().includes('prompt')
            || setting.name.toLowerCase().includes('description')
            || setting.name.toLowerCase().includes('query');
          if (isLong) {
            return (
              <FormTextarea
                key={setting.name}
                label={labelText}
                value={String(value || '')}
                onChange={(v) => updateData(setting.name as any, v)}
                rows={4}
                placeholder={setting.placeholder}
                helpText={helpText}
                required={isRequired}
                error={hasError}
              />
            );
          }
          return (
            <FormInput
              key={setting.name}
              label={labelText}
              value={String(value || '')}
              onChange={(v) => updateData(setting.name as any, v)}
              placeholder={setting.placeholder}
              helpText={helpText}
              required={isRequired}
              error={hasError}
            />
          );
        })}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      className="w-80 border-l overflow-y-auto"
      data-has-schema={schemaSettings.hasSchema ? 'true' : 'false'}
      data-node-type={node?.type}
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="sticky top-0 z-10 p-4 border-b backdrop-blur-sm"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-surface) 95%, transparent)',
          borderColor: 'var(--color-border)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Node Properties
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="text-xs px-2 py-1 rounded"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {node.type?.replace(/_/g, ' ').toUpperCase()}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Validation Errors Banner */}
        {node.data?.validationErrors && (node.data.validationErrors as any[]).length > 0 && (
          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 8,
            padding: '8px 10px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle style={{ width: 12, height: 12 }} />
              {(node.data.validationErrors as any[]).length} validation {(node.data.validationErrors as any[]).length === 1 ? 'issue' : 'issues'}
            </div>
            {(node.data.validationErrors as any[]).map((err: any, i: number) => (
              <div key={i} style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5, paddingLeft: 16 }}>
                {err.field ? `${err.field}: ` : ''}{err.message}
              </div>
            ))}
          </div>
        )}

        {/* Error banner for failed nodes */}
        {nodeData?.executionState === 'failed' && nodeData?.executionError && (
          <div style={{
            margin: '0 0 16px 0', padding: '10px 12px', borderRadius: 8,
            background: 'rgba(244, 67, 54, 0.1)', border: '1px solid rgba(244, 67, 54, 0.3)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#f44336', marginBottom: 4 }}>
              Execution Error
            </div>
            <div style={{
              fontSize: 11, color: 'var(--color-text)', lineHeight: 1.5,
              maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'rgba(0,0,0,0.1)', padding: '6px 8px', borderRadius: 4,
            }}>
              {String(nodeData.executionError).substring(0, 500)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('fixNodeWithAI', {
                    detail: {
                      nodeId: node?.id,
                      nodeLabel: nodeData?.label || node?.id,
                      nodeType: node?.type,
                      error: nodeData.executionError,
                      config: JSON.stringify(nodeData, null, 2).substring(0, 500),
                    }
                  }));
                }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: 'linear-gradient(135deg, #7c4dff, #536dfe)', color: '#fff',
                  border: 'none', cursor: 'pointer',
                }}
              >
                Fix with AI
              </button>
              <button
                onClick={() => {
                  if (node?.id) {
                    onUpdate(node.id, { executionState: undefined, executionError: undefined } as any);
                  }
                }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)', cursor: 'pointer',
                }}
              >
                Clear Error
              </button>
            </div>
          </div>
        )}

        {/* Node Label */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Label
          </label>
          <input
            type="text"
            value={nodeData.label || ''}
            onChange={(e) => updateData('label', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Display name shown on the canvas. Use a short, descriptive name.
          </p>
        </div>

        {/* Node Description */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Description (optional)
          </label>
          <textarea
            value={nodeData.description || ''}
            onChange={(e) => updateData('description', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-accent-primary"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Optional notes about this node's purpose. Shown as a tooltip on the canvas.
          </p>
        </div>

        {/* Node-specific config */}
        <div className="pt-4 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Configuration
          </h4>
          {renderNodeConfig()}
        </div>

        {/* Schema-driven docs panel — shows ai.shortDescription, whenToUse,
         * I/O ports, and outputAssertions for any node whose type is
         * registered in the schema-driven plugin registry. Pulled from the
         * same useNodeSchemas hook used by the schema-driven settings
         * fallback above; renders nothing when the type isn't registered. */}
        {schemaSettings.hasSchema && (
          <div
            className="border-t pt-4"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="node-docs-section"
          >
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Docs
            </h4>
            <NodeDocsPanel schema={fullSchema} />
          </div>
        )}

        {/* Universal Advanced Configuration */}
        {renderUniversalAdvancedConfig()}

        {/* Action buttons */}
        <div className="pt-4 border-t space-y-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <motion.button
            whileHover={hasChanges ? { scale: 1.02 } : {}}
            whileTap={hasChanges ? { scale: 0.98 } : {}}
            onClick={handleSave}
            disabled={!hasChanges}
            className={`
              w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200
              ${showSaveConfirmation
                ? 'bg-emerald-500 text-white'
                : hasChanges
                ? 'bg-accent-primary text-white hover:bg-accent-primary/90 shadow-lg shadow-accent-primary/20'
                : 'cursor-not-allowed opacity-50'
              }
            `}
            style={!hasChanges && !showSaveConfirmation ? {
              backgroundColor: 'var(--color-bg-secondary)',
              color: 'var(--color-text-tertiary)',
            } : undefined}
          >
            {showSaveConfirmation ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </>
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30"
          >
            <Trash2 className="w-4 h-4" />
            Delete Node
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};
