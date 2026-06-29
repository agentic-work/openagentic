/**
 * Agent node config groups: agent-spawn / a2a, agent-single (with the
 * searchable registry dropdown + DB source-of-truth viewer), agent-pool,
 * agent-supervisor, multi-agent orchestration, and the synth combiner.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '@/shared/icons';
import { onKeyActivate } from '@/utils/a11y';
import { isFieldRequired } from '../../../utils/workflowValidator';
import { MultiAgentSlotEditor } from '../../MultiAgentSlotEditor';
import type { MultiAgentAgentSpec } from '../../MultiAgentSlotEditor';
import { FormInput, FormTextarea, FormSelect, SectionLabel } from '../FormControls';
import { AdvancedToggle } from '../AdvancedToggle';
import { AgentSOTConfig } from '../AgentSOTConfig';
import type { NodeConfigContext } from '../types';

export const AgentSpawnConfig: React.FC<NodeConfigContext> = ({
  editor, isDark, availableTools,
  showAdvanced, setShowAdvanced,
  showPersona, setShowPersona,
  showToolPolicy, setShowToolPolicy,
  showAgentMemory, setShowAgentMemory,
}) => {
  const { nodeData, updateData, asField, fieldStr, fieldBool, fieldNum, fieldRaw } = editor;
  const toolPolicyMode = fieldStr('toolPolicyMode', 'allow_all');
  const selectedTools: string[] = (fieldRaw('selectedTools') as string[] | undefined) ?? [];

  return (
    <div className="space-y-4">
      <FormSelect
        label="Agent Type"
        value={fieldStr('agentType', 'chat')}
        onChange={(v) => updateData('agentType', v)}
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
            <FormSelect label="Tone" value={fieldStr('tone', 'professional')}
              options={[
                { value: 'professional', label: 'Professional' },
                { value: 'casual', label: 'Casual' },
                { value: 'technical', label: 'Technical' },
              ]}
              onChange={(v) => updateData('tone', v)}
              helpText="Communication style for agent responses." />
            <FormTextarea label="Boundaries" value={fieldStr('boundaries')}
              onChange={(v) => updateData('boundaries', v)} rows={2}
              placeholder="e.g., Do not access production databases..."
              helpText="What the agent should NOT do." />
            <FormTextarea label="Bootstrap Instructions" value={fieldStr('bootstrapInstructions')}
              onChange={(v) => updateData('bootstrapInstructions', v)} rows={3}
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
      <FormInput label="Model Override" value={fieldStr('model')}
        onChange={(v) => updateData('model', v)} placeholder="Leave empty for auto routing"
        helpText="Pin a specific model for this node; leave blank for Smart Router." />
      <FormInput label="Max Turns" value={fieldNum('maxIterations', 10)}
        onChange={(v) => updateData('maxIterations', Number.parseInt(v) || 10)} type="number" min={1} max={50}
        helpText="Maximum reasoning/tool-use turns." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={fieldBool('enableThinking')}
          onChange={(e) => updateData('enableThinking', e.target.checked)}
          className="rounded" id="spawn-enable-thinking" />
        <label htmlFor="spawn-enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Enable extended thinking
        </label>
      </div>
      {fieldBool('enableThinking') && (
        <FormInput label="Thinking Budget (tokens)" value={fieldNum('thinkingBudget', 8192)}
          onChange={(v) => updateData('thinkingBudget', Number.parseInt(v) || 8192)} type="number"
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
              onChange={(v) => updateData('toolPolicyMode', v)} />
            {toolPolicyMode !== 'allow_all' && (
              <div className="glass-surface-subtle max-h-40 overflow-y-auto rounded-lg p-2 space-y-1" style={{ border: '1px solid var(--glass-border)' }}>
                {availableTools.map(tool => (
                  <label key={`${tool.server}-${tool.name}`} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                    <input type="checkbox" className="rounded"
                      checked={selectedTools.includes(tool.name)}
                      onChange={(e) => {
                        const newTools = e.target.checked
                          ? [...selectedTools, tool.name]
                          : selectedTools.filter((t: string) => t !== tool.name);
                        updateData('selectedTools', newTools);
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
      <FormInput label="Cost Budget ($)" value={fieldStr('costBudget')}
        onChange={(v) => updateData('costBudget', Number.parseFloat(v) || undefined)} type="number" min={0}
        placeholder="No limit" helpText="Maximum cost this agent can spend." />
      <FormInput label="Tool Call Limit" value={fieldStr('toolCallLimit')}
        onChange={(v) => updateData('toolCallLimit', Number.parseInt(v) || undefined)} type="number" min={1}
        placeholder="25 (default)" helpText="Maximum tool calls before forcing a final answer." />
      <FormSelect label="Approval Policy" value={fieldStr('approvalPolicy', 'none')}
        options={[
          { value: 'none', label: 'None' },
          { value: 'high_risk', label: 'High-Risk Tools Only' },
          { value: 'all', label: 'All Tool Calls' },
        ]}
        onChange={(v) => updateData('approvalPolicy', v)} />

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
              <input type="checkbox" checked={fieldBool('persistMemory')}
                onChange={(e) => updateData('persistMemory', e.target.checked)}
                className="rounded" id="spawn-persist-memory" />
              <label htmlFor="spawn-persist-memory" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Persist Memory
              </label>
            </div>
            {fieldBool('persistMemory') && (
              <FormSelect label="Memory Scope" value={fieldStr('memoryScope', 'node')}
                options={[
                  { value: 'node', label: 'Node' },
                  { value: 'workflow', label: 'Workflow' },
                  { value: 'global', label: 'Global' },
                ]}
                onChange={(v) => updateData('memoryScope', asField(v, 'memoryScope'))} />
            )}
          </div>
        )}
      </div>

      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
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
            onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))} className="w-full" />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span><span>Creative</span>
          </div>
        </div>
        <FormInput label="Max Tokens" value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', Number.parseInt(v) || 1000)} type="number" isDark={isDark}
          min={1} max={32000} helpText="Maximum tokens the model can generate." />
      </AdvancedToggle>
    </div>
  );
};

export const AgentSingleConfig: React.FC<NodeConfigContext> = ({
  editor, availableTools,
  agentOptions, agentSearchQuery, setAgentSearchQuery,
  agentDropdownOpen, setAgentDropdownOpen, agentDropdownRef,
  showPersona, setShowPersona,
  showToolPolicy, setShowToolPolicy,
  showAgentMemory, setShowAgentMemory,
}) => {
  const { updateData, asField, fieldStr, fieldBool, fieldNum, fieldRaw } = editor;
  const toolPolicyMode = fieldStr('toolPolicyMode', 'allow_all');
  const selectedTools: string[] = (fieldRaw('selectedTools') as string[] | undefined) ?? [];
  const currentAgentId = fieldStr('agentId');
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
          Agent ID {isFieldRequired('agent_single', 'agentId') && <span style={{ color: 'var(--color-error)' }}>*</span>}
        </label>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={agentDropdownOpen}
          className="glass-field"
          onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
          onKeyDown={onKeyActivate(() => setAgentDropdownOpen(!agentDropdownOpen))}
          style={{
            padding: '6px 10px', cursor: 'pointer',
            fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
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
              className="glass-surface glass-surface-strong"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
                maxHeight: 240, overflowY: 'auto',
              }}
            >
              <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
                <input
                  autoFocus
                  className="glass-field"
                  value={agentSearchQuery}
                  onChange={(e) => setAgentSearchQuery(e.target.value)}
                  placeholder="Search agents..."
                  style={{ padding: '4px 8px', fontSize: 12, outline: 'none' }}
                />
              </div>
              {filteredAgents.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>No agents found</div>
              )}
              {filteredAgents.map(agent => (
                <div
                  key={agent.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={agent.id === currentAgentId}
                  onClick={() => {
                    updateData('agentId', agent.id);
                    setAgentDropdownOpen(false);
                    setAgentSearchQuery('');
                  }}
                  onKeyDown={onKeyActivate(() => {
                    updateData('agentId', agent.id);
                    setAgentDropdownOpen(false);
                    setAgentSearchQuery('');
                  })}
                  style={{
                    padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                    background: agent.id === currentAgentId ? 'var(--ctl-surf-hover)' : 'transparent',
                    borderBottom: '1px solid var(--glass-border)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--ctl-surf-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = agent.id === currentAgentId ? 'var(--ctl-surf-hover)' : 'transparent'; }}
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
                  onChange={(v) => updateData('agentId', v)}
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
            <FormSelect label="Role" value={fieldStr('role', 'custom')}
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
              onChange={(v) => updateData('role', v)}
              helpText="The agent's specialization." />
            <FormSelect label="Tone" value={fieldStr('tone', 'professional')}
              options={[
                { value: 'professional', label: 'Professional' },
                { value: 'casual', label: 'Casual' },
                { value: 'technical', label: 'Technical' },
              ]}
              onChange={(v) => updateData('tone', v)}
              helpText="Communication style for agent responses." />
            <FormTextarea label="Boundaries" value={fieldStr('boundaries')}
              onChange={(v) => updateData('boundaries', v)} rows={2}
              placeholder="e.g., Do not access production databases, do not generate executable code..."
              helpText="What the agent should NOT do. Enforced in the system prompt." />
            <FormTextarea label="Bootstrap Instructions" value={fieldStr('bootstrapInstructions')}
              onChange={(v) => updateData('bootstrapInstructions', v)} rows={3}
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
      <FormInput label="Model Override" value={fieldStr('model')}
        onChange={(v) => updateData('model', v)}
        placeholder="Leave empty for auto routing"
        helpText="Pin a specific model for this node; leave blank for Smart Router." />
      <FormInput label="Max Turns" value={fieldNum('maxTurns', 5)}
        onChange={(v) => updateData('maxTurns', Number.parseInt(v) || 5)} type="number" min={1} max={50}
        helpText="Maximum reasoning/tool-use turns before returning." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={fieldBool('enableThinking')}
          onChange={(e) => updateData('enableThinking', e.target.checked)}
          className="rounded" id="agent-enable-thinking" />
        <label htmlFor="agent-enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Enable extended thinking
        </label>
      </div>
      {fieldBool('enableThinking') && (
        <FormInput label="Thinking Budget (tokens)" value={fieldNum('thinkingBudget', 8192)}
          onChange={(v) => updateData('thinkingBudget', Number.parseInt(v) || 8192)} type="number"
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
              onChange={(v) => updateData('toolPolicyMode', v)}
              helpText="Controls which tools the agent can use." />
            {toolPolicyMode !== 'allow_all' && (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {toolPolicyMode === 'allow_selected' ? 'Allowed Tools' : 'Denied Tools'}
                </label>
                <div className="glass-surface-subtle max-h-40 overflow-y-auto rounded-lg p-2 space-y-1" style={{ border: '1px solid var(--glass-border)' }}>
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
                            updateData('selectedTools', newTools);
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
      <FormInput label="Cost Budget ($)" value={fieldStr('costBudget')}
        onChange={(v) => updateData('costBudget', Number.parseFloat(v) || undefined)} type="number" min={0}
        placeholder="No limit"
        helpText="Maximum cost this agent can spend on LLM calls." />
      <FormInput label="Tool Call Limit" value={fieldStr('toolCallLimit')}
        onChange={(v) => updateData('toolCallLimit', Number.parseInt(v) || undefined)} type="number" min={1}
        placeholder="25 (default)"
        helpText="Maximum number of tool calls before forcing a final answer." />

      {/* Approval */}
      <SectionLabel label="Approval" />
      <FormSelect label="Approval Policy" value={fieldStr('approvalPolicy', 'none')}
        options={[
          { value: 'none', label: 'None' },
          { value: 'high_risk', label: 'High-Risk Tools Only' },
          { value: 'all', label: 'All Tool Calls' },
        ]}
        onChange={(v) => updateData('approvalPolicy', v)}
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
              <input type="checkbox" checked={fieldBool('persistMemory')}
                onChange={(e) => updateData('persistMemory', e.target.checked)}
                className="rounded" id="agent-persist-memory" />
              <label htmlFor="agent-persist-memory" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Persist Memory
              </label>
            </div>
            {fieldBool('persistMemory') && (
              <FormSelect label="Memory Scope" value={fieldStr('memoryScope', 'node')}
                options={[
                  { value: 'node', label: 'Node - This node only' },
                  { value: 'workflow', label: 'Workflow - Shared across workflow' },
                  { value: 'global', label: 'Global - Persists across executions' },
                ]}
                onChange={(v) => updateData('memoryScope', asField(v, 'memoryScope'))}
                helpText="How broadly the agent's memory is shared." />
            )}
          </div>
        )}
      </div>

      {/* System Prompt Override */}
      <FormTextarea label="System Prompt Override" value={fieldStr('systemPrompt')}
        onChange={(v) => updateData('systemPrompt', v)}
        placeholder="Override the agent's system prompt (optional)"
        helpText="Custom system prompt. Overrides the role-based default. Use {{input}} for dynamic values." />

      <FormInput label="Timeout (ms)" value={fieldNum('timeout', 60000)}
        onChange={(v) => updateData('timeout', Number.parseInt(v) || 60000)} type="number" min={5000}
        helpText="Maximum execution time in milliseconds. Agent is terminated if exceeded." />
    </div>
  );
};

export const AgentPoolConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldNum, fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <SectionLabel label="Agent Pool Configuration" />
      <FormInput label="Concurrency" value={fieldNum('concurrency', 5)}
        onChange={(v) => updateData('concurrency', Number.parseInt(v) || 5)} type="number" min={1} max={20}
        helpText="Maximum agents running in parallel." />
      <FormSelect label="Aggregation Strategy" value={fieldStr('aggregation', 'merge')}
        options={[
          { value: 'first', label: 'First - Fastest agent wins' },
          { value: 'vote', label: 'Vote - Majority consensus' },
          { value: 'merge', label: 'Merge - Concatenate all outputs' },
          { value: 'supervisor_synthesis', label: 'Supervisor Synthesis - LLM combines results' },
        ]}
        onChange={(v) => updateData('aggregation', v)}
        helpText="How to combine results from all agents." />
      <FormInput label="Timeout Per Agent (s)" value={fieldNum('timeoutPerAgent', 60)}
        onChange={(v) => updateData('timeoutPerAgent', Number.parseInt(v) || 60)} type="number" min={5} max={600}
        helpText="Maximum time each agent can run before being terminated." />
      <div className="glass-surface-subtle text-[12px] p-2 rounded" style={{ color: 'var(--color-text-secondary)' }}>
        Configure individual agents by connecting Agent nodes to this pool's input handles.
      </div>
    </div>
  );
};

export const AgentSupervisorConfig: React.FC<NodeConfigContext> = ({ editor }) => {
  const { fieldStr, fieldNum, fieldBool, fieldRaw, updateData } = editor;
  return (
    <div className="space-y-4">
      <SectionLabel label="Supervisor Configuration" />
      <FormTextarea label="Supervisor Instructions" value={fieldStr('supervisorPrompt')}
        onChange={(v) => updateData('supervisorPrompt', v)} rows={4}
        placeholder="You are a supervisor managing a team of worker agents. Delegate tasks based on each worker's specialization..."
        helpText="Instructions for how the supervisor should plan, delegate, and quality-check worker outputs." />
      <FormInput label="Supervisor Model" value={fieldStr('supervisorModel')}
        onChange={(v) => updateData('supervisorModel', v)}
        placeholder="e.g., claude-sonnet-4-6"
        helpText="Should be a capable model (e.g., Claude Sonnet or GPT-4o) for planning and delegation." />
      <FormInput label="Max Delegation Rounds" value={fieldNum('maxDelegationRounds', 5)}
        onChange={(v) => updateData('maxDelegationRounds', Number.parseInt(v) || 5)} type="number" min={1} max={20}
        helpText="Maximum number of delegation cycles before the supervisor must finalize." />
      <div className="flex items-center gap-3 py-1">
        <input type="checkbox" checked={fieldBool('allowDynamicWorkers')}
          onChange={(e) => updateData('allowDynamicWorkers', e.target.checked)}
          className="rounded" id="allow-dynamic-workers" />
        <label htmlFor="allow-dynamic-workers" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Allow dynamic worker creation
        </label>
      </div>
      <p className="text-xs -mt-2 ml-7" style={{ color: 'var(--color-text-tertiary)' }}>
        When enabled, the supervisor can spawn new worker agents on-the-fly for tasks not covered by connected workers.
      </p>
      <FormTextarea label="Worker Agents (JSON)" value={fieldRaw('workers') ? JSON.stringify(fieldRaw('workers'), null, 2) : ''}
        onChange={(v) => { try { updateData('workers', JSON.parse(v)); } catch { /* wait for valid JSON */ } }}
        rows={5} monospace
        placeholder={'[\n  { "id": "researcher", "role": "research", "model": "auto" },\n  { "id": "writer", "role": "summarization", "model": "auto" }\n]'}
        helpText="JSON array of worker agent definitions. Each needs at least an id and role." />
      <div className="glass-surface-subtle text-[12px] p-2 rounded" style={{ color: 'var(--color-text-secondary)' }}>
        You can also connect worker Agent nodes to this supervisor visually on the canvas.
      </div>
    </div>
  );
};

export const MultiAgentConfig: React.FC<NodeConfigContext> = ({
  editor, isDark, availableModels, agentOptions, showAdvanced, setShowAdvanced,
}) => {
  const { updateData, asField, fieldStr, fieldNum, fieldRaw } = editor;
  const agentsRaw = fieldRaw('agents');
  const agents: MultiAgentAgentSpec[] = Array.isArray(agentsRaw)
    ? (agentsRaw as MultiAgentAgentSpec[])
    : [];
  const pattern: string = fieldStr('pattern', 'parallel');
  const updateAgents = (next: MultiAgentAgentSpec[]) => updateData('agents', next);
  const addAgent = () => updateAgents([...agents, { agentId: '', taskDescription: '' }]);
  const removeAgent = (i: number) => updateAgents(agents.filter((_, idx) => idx !== i));
  const updateAgent = (i: number, patch: Partial<MultiAgentAgentSpec>) =>
    updateAgents(agents.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <div className="space-y-4">
      <div className="p-2.5 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--color-info) 8%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, var(--color-info) 20%, transparent)' }}>
        Multi-agent orchestration. Pick a <strong>pattern</strong> below, then add registered agents from the SOT registry. Each slot accepts an <code>agentId</code>; inline ghost agents are deprecated — register agents in the Admin console first.
      </div>

      <FormSelect
        label="Orchestration Pattern"
        value={pattern}
        onChange={(v) => updateData('pattern', v)}
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
          <div className="text-xs italic mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
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
          style={{ padding: '6px 10px', background: 'color-mix(in srgb, var(--color-info) 12%, transparent)', color: 'var(--color-info)', border: '1px solid color-mix(in srgb, var(--color-info) 30%, transparent)', borderRadius: 4, cursor: 'pointer' }}
        >
          + Add agent
        </button>
      </div>

      <FormInput label="Max Concurrency" value={fieldNum('maxConcurrency', 5)}
        onChange={(v) => updateData('maxConcurrency', Number.parseInt(v) || 5)} type="number" isDark={isDark}
        min={1} max={20} helpText="Cap on simultaneous agents (parallel pattern only)." />

      <FormSelect
        label="Aggregation Strategy"
        value={fieldStr('aggregationStrategy', 'merge')}
        onChange={(v) => updateData('aggregationStrategy', asField(v, 'aggregationStrategy'))}
        options={[
          { value: 'merge', label: 'Merge — combine all outputs' },
          { value: 'first', label: 'First — fastest agent wins' },
          { value: 'vote', label: 'Vote — majority consensus' },
        ]}
        isDark={isDark}
        helpText="How to combine outputs across agents."
      />

      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormInput label="Total Timeout (ms)" value={fieldNum('timeoutMs', 120000)}
          onChange={(v) => updateData('timeoutMs', Number.parseInt(v) || 120000)} type="number" isDark={isDark}
          min={5000} max={600000} helpText="Wall-clock cap across all agents." />
        <FormSelect
          label="Share context across agents"
          value={fieldRaw('sharedContext') === false ? 'false' : 'true'}
          onChange={(v) => updateData('sharedContext', v === 'true')}
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

export const SynthConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { fieldStr, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormSelect
        label="Strategy"
        value={fieldStr('strategy', 'concat')}
        onChange={(v) => updateData('strategy', v)}
        options={[
          { value: 'concat', label: 'Concatenate' },
          { value: 'summarize', label: 'Summarize' },
          { value: 'vote', label: 'Majority Vote' },
        ]}
        isDark={isDark}
        helpText="How to combine outputs from parallel branches"
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <FormTextarea
          label="Synthesis Prompt"
          value={fieldStr('synthPrompt')}
          onChange={(v) => updateData('synthPrompt', v)}
          rows={4}
          placeholder="Combine the following outputs into a single coherent response..."
          isDark={isDark}
          helpText="Used with 'summarize' strategy; prompt sent to LLM"
        />
      </AdvancedToggle>
    </div>
  );
};
