/**
 * AdminWorkflowSettingsView - Organization-wide workflow defaults and restrictions.
 * Phase 13A: Workflow Governance panel for the admin console.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

// ── Types ───────────────────────────────────────────────────────────

type TabId = 'limits' | 'cost' | 'model' | 'errors' | 'memory';

interface WorkflowSettings {
  // Execution Limits
  defaultNodeTimeout: number;
  maxNodeTimeout: number;
  maxExecutionTime: number;
  maxNodesPerWorkflow: number;
  maxConcurrentExecutions: number;
  maxConcurrentPerUser: number;
  maxExecutionsPerHourPerUser: number;
  // Cost Governance
  defaultPerExecutionBudget: number;
  maxPerExecutionBudget: number;
  defaultDailyBudgetPerUser: number;
  defaultMonthlyBudgetPerUser: number;
  onBudgetExceeded: 'pause' | 'downgrade_model' | 'abort';
  // Model & Agent Restrictions
  // 2026-04-19 — defaultIntelligenceLevel / maxIntelligenceLevel removed
  // (task #144, slider rip). Per-user × per-model budgets live in
  // UserModelBudgetService (User Permissions view).
  maxAgentTurns: number;
  maxToolCallsPerAgent: number;
  agentCostBudgetCap: number;
  requireApprovalForHighRiskTools: boolean;
  highRiskToolsList: string;
  // Node & Error Handling
  disabledNodeTypes: string[];
  defaultRetryCount: number;
  defaultRetryDelay: number;
  defaultBackoffStrategy: 'fixed' | 'exponential';
  defaultOnError: 'stop' | 'continue' | 'retry';
  // Memory & Context
  crossModeMemoryEnabled: boolean;
  memoryRetentionDays: number;
  maxMemoryEntriesPerUser: number;
}

const DEFAULT_SETTINGS: WorkflowSettings = {
  defaultNodeTimeout: 30,
  maxNodeTimeout: 300,
  maxExecutionTime: 600,
  maxNodesPerWorkflow: 50,
  maxConcurrentExecutions: 20,
  maxConcurrentPerUser: 5,
  maxExecutionsPerHourPerUser: 100,
  defaultPerExecutionBudget: 1.0,
  maxPerExecutionBudget: 10.0,
  defaultDailyBudgetPerUser: 25.0,
  defaultMonthlyBudgetPerUser: 500.0,
  onBudgetExceeded: 'pause',
  maxAgentTurns: 15,
  maxToolCallsPerAgent: 25,
  agentCostBudgetCap: 5.0,
  requireApprovalForHighRiskTools: true,
  highRiskToolsList: 'admin_postgres_raw_query, azure_create_resource_group, k8s_delete',
  disabledNodeTypes: [],
  defaultRetryCount: 2,
  defaultRetryDelay: 1000,
  defaultBackoffStrategy: 'exponential',
  defaultOnError: 'stop',
  crossModeMemoryEnabled: true,
  memoryRetentionDays: 90,
  maxMemoryEntriesPerUser: 1000,
};

const ALL_NODE_TYPES = [
  'trigger', 'llm_completion', 'a2a', 'agent_spawn', 'openagentic_llm',
  'multi_agent', 'mcp_tool', 'code', 'openagentic', 'http_request',
  'condition', 'loop', 'wait', 'transform', 'merge',
  'approval', 'human_approval', 'synth',
  'agent_single', 'agent_pool', 'agent_supervisor',
  'slack_message', 'teams_message', 'outlook_email', 'send_email',
  'pagerduty_incident', 'servicenow_ticket', 'jira_issue', 'discord_message',
  'error_handler', 'user_context', 'text',
];

const TABS: { id: TabId; label: string }[] = [
  { id: 'limits', label: 'Execution Limits' },
  { id: 'cost', label: 'Cost Governance' },
  { id: 'model', label: 'Model & Agent' },
  { id: 'errors', label: 'Node & Error Handling' },
  { id: 'memory', label: 'Memory & Context' },
];

// ── Component ───────────────────────────────────────────────────────

export const AdminWorkflowSettingsView: React.FC = () => {
  const [settings, setSettings] = useState<WorkflowSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabId>('limits');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/api/admin/workflow-settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULT_SETTINGS, ...data });
      }
    } catch (err) {
      console.error('Failed to fetch workflow settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await apiRequest('/api/admin/workflow-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setToast({ message: 'Settings saved successfully', type: 'success' });
      } else {
        const err = await res.json().catch(() => ({}));
        setToast({ message: err.message || 'Failed to save settings', type: 'error' });
      }
    } catch (err) {
      setToast({ message: 'Network error saving settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof WorkflowSettings>(key: K, value: WorkflowSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const toggleNodeType = (nodeType: string) => {
    setSettings(prev => {
      const disabled = prev.disabledNodeTypes.includes(nodeType)
        ? prev.disabledNodeTypes.filter(n => n !== nodeType)
        : [...prev.disabledNodeTypes, nodeType];
      return { ...prev, disabledNodeTypes: disabled };
    });
  };

  // ── Render helpers ──────────────────────────────────────────────

  const fieldRow = (label: string, description: string, input: React.ReactNode) => (
    <div
      className="flex items-center justify-between py-3 px-4 rounded-lg mb-2"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex-1 mr-4">
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{description}</div>
      </div>
      <div className="shrink-0">{input}</div>
    </div>
  );

  const numberInput = (key: keyof WorkflowSettings, opts?: { min?: number; max?: number; step?: number; prefix?: string }) => (
    <div className="flex items-center gap-1">
      {opts?.prefix && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{opts.prefix}</span>}
      <input
        type="number"
        value={settings[key] as number}
        onChange={e => update(key, Number(e.target.value))}
        min={opts?.min ?? 0}
        max={opts?.max}
        step={opts?.step ?? 1}
        className="w-28 px-2 py-1 rounded text-sm text-right"
        style={{
          backgroundColor: 'var(--color-bg-secondary, var(--color-background))',
          border: '1px solid var(--color-border)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );

  const selectInput = (key: keyof WorkflowSettings, options: { value: string; label: string }[]) => (
    <select
      value={settings[key] as string}
      onChange={e => update(key, e.target.value as any)}
      className="px-2 py-1 rounded text-sm"
      style={{
        backgroundColor: 'var(--color-bg-secondary, var(--color-background))',
        border: '1px solid var(--color-border)',
        color: 'var(--text-primary)',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const toggleInput = (key: keyof WorkflowSettings) => (
    <button
      onClick={() => update(key, !settings[key] as any)}
      className="relative w-10 h-5 rounded-full transition-colors"
      style={{
        backgroundColor: settings[key] ? 'var(--color-accent, var(--color-accent-primary))' : 'var(--color-border)',
      }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
        style={{
          backgroundColor: 'var(--ap-fg-0)',
          left: settings[key] ? '22px' : '2px',
        }}
      />
    </button>
  );

  // 2026-04-19 — sliderInput helper deleted (task #144, slider rip); no
  // longer needed now that Intelligence Level rows are gone.

  // ── Tab content renderers ─────────────────────────────────────

  const renderLimits = () => (
    <div>
      {fieldRow('Default Node Timeout', 'Default timeout for each node in seconds', numberInput('defaultNodeTimeout', { min: 1 }))}
      {fieldRow('Max Node Timeout', 'Maximum allowed timeout for any node (cap)', numberInput('maxNodeTimeout', { min: 1 }))}
      {fieldRow('Max Execution Time', 'Maximum total workflow execution time in seconds', numberInput('maxExecutionTime', { min: 1 }))}
      {fieldRow('Max Nodes Per Workflow', 'Maximum number of nodes allowed in a single workflow', numberInput('maxNodesPerWorkflow', { min: 1 }))}
      {fieldRow('Max Concurrent Executions', 'Global limit on simultaneously running workflows', numberInput('maxConcurrentExecutions', { min: 1 }))}
      {fieldRow('Max Concurrent Per User', 'Per-user limit on simultaneously running workflows', numberInput('maxConcurrentPerUser', { min: 1 }))}
      {fieldRow('Max Executions Per Hour Per User', 'Rate limit on workflow executions per user', numberInput('maxExecutionsPerHourPerUser', { min: 1 }))}
    </div>
  );

  const renderCost = () => (
    <div>
      {fieldRow('Default Per-Execution Budget', 'Default cost cap per workflow execution', numberInput('defaultPerExecutionBudget', { min: 0, step: 0.5, prefix: '$' }))}
      {fieldRow('Max Per-Execution Budget', 'Maximum allowed per-execution budget (cap)', numberInput('maxPerExecutionBudget', { min: 0, step: 0.5, prefix: '$' }))}
      {fieldRow('Default Daily Budget Per User', 'Default daily spending limit per user', numberInput('defaultDailyBudgetPerUser', { min: 0, step: 1, prefix: '$' }))}
      {fieldRow('Default Monthly Budget Per User', 'Default monthly spending limit per user', numberInput('defaultMonthlyBudgetPerUser', { min: 0, step: 10, prefix: '$' }))}
      {fieldRow('On Budget Exceeded', 'Action to take when a budget limit is reached', selectInput('onBudgetExceeded', [
        { value: 'pause', label: 'Pause' },
        { value: 'downgrade_model', label: 'Downgrade Model' },
        { value: 'abort', label: 'Abort' },
      ]))}
    </div>
  );

  const renderModel = () => (
    <div>
      {/* 2026-04-19 — Intelligence Level rows removed (task #144, slider
          rip). Per-user × per-model budgets live in UserModelBudgetService. */}
      {fieldRow('Max Agent Turns', 'Maximum number of turns an agent can take per invocation', numberInput('maxAgentTurns', { min: 1 }))}
      {fieldRow('Max Tool Calls Per Agent', 'Maximum number of tool calls allowed per agent', numberInput('maxToolCallsPerAgent', { min: 1 }))}
      {fieldRow('Agent Cost Budget Cap', 'Maximum cost allowed per individual agent run', numberInput('agentCostBudgetCap', { min: 0, step: 0.5, prefix: '$' }))}
      {fieldRow('Require Approval for High-Risk Tools', 'Require human approval before executing high-risk tools', toggleInput('requireApprovalForHighRiskTools'))}
      {fieldRow('High-Risk Tools List', 'Comma-separated list of tool names requiring approval', (
        <textarea
          value={settings.highRiskToolsList}
          onChange={e => update('highRiskToolsList', e.target.value)}
          rows={2}
          className="w-64 px-2 py-1 rounded text-xs"
          style={{
            backgroundColor: 'var(--color-bg-secondary, var(--color-background))',
            border: '1px solid var(--color-border)',
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
        />
      ))}
    </div>
  );

  const renderErrors = () => (
    <div>
      <div
        className="rounded-lg p-4 mb-4"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Disabled Node Types</div>
        <div className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Checked node types will be blocked from use in all workflows.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {ALL_NODE_TYPES.map(nt => (
            <label
              key={nt}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer hover:opacity-80"
              style={{ color: 'var(--text-secondary)' }}
            >
              <input
                type="checkbox"
                checked={settings.disabledNodeTypes.includes(nt)}
                onChange={() => toggleNodeType(nt)}
                className="rounded"
              />
              {nt.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
      </div>
      {fieldRow('Default Retry Count', 'Number of retries before marking a node as failed', numberInput('defaultRetryCount', { min: 0 }))}
      {fieldRow('Default Retry Delay (ms)', 'Delay between retries in milliseconds', numberInput('defaultRetryDelay', { min: 0, step: 100 }))}
      {fieldRow('Default Backoff Strategy', 'Backoff strategy for retries', selectInput('defaultBackoffStrategy', [
        { value: 'fixed', label: 'Fixed' },
        { value: 'exponential', label: 'Exponential' },
      ]))}
      {fieldRow('Default On Error', 'Default action when a node encounters an error', selectInput('defaultOnError', [
        { value: 'stop', label: 'Stop' },
        { value: 'continue', label: 'Continue' },
        { value: 'retry', label: 'Retry' },
      ]))}
    </div>
  );

  const renderMemory = () => (
    <div>
      {fieldRow('Cross-Mode Memory Enabled', 'Allow workflows to read/write shared memory across chat sessions', toggleInput('crossModeMemoryEnabled'))}
      {fieldRow('Memory Retention (days)', 'Number of days to retain workflow memory entries', numberInput('memoryRetentionDays', { min: 1 }))}
      {fieldRow('Max Memory Entries Per User', 'Maximum number of memory entries stored per user', numberInput('maxMemoryEntriesPerUser', { min: 1 }))}
    </div>
  );

  // ── Main render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader
          crumbs={['Admin', 'OpenAgentic Flows', 'Governance']}
          title="Workflow Governance"
          explainer="Organization-wide workflow defaults and restrictions."
        />
        <div className="p-6 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
          <div className="animate-pulse text-sm">Loading workflow settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={['Admin', 'OpenAgentic Flows', 'Governance']}
        title="Workflow Governance"
        explainer="Organization-wide workflow defaults and restrictions — limits, cost guards, model pins, error policy, and memory."
        actions={[
          { label: saving ? 'Saving…' : 'Save Settings', primary: true, onClick: () => { void handleSave(); }, disabled: saving },
        ]}
      />

      <div className="p-4 pt-0 space-y-4">

      {/* Toast */}
      {toast && (
        <div
          className="px-4 py-2 rounded-lg text-xs"
          style={{
            backgroundColor: toast.type === 'success' ? 'color-mix(in srgb, var(--color-ok) 10%, transparent)' : 'color-mix(in srgb, var(--color-err) 10%, transparent)',
            border: `1px solid ${toast.type === 'success' ? 'color-mix(in srgb, var(--color-ok) 30%, transparent)' : 'color-mix(in srgb, var(--color-err) 30%, transparent)'}`,
            color: toast.type === 'success' ? 'var(--color-ok)' : 'var(--color-err)',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex rounded-lg p-0.5" style={{ backgroundColor: 'var(--color-bg-surface, var(--color-surface))' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 py-1.5 text-xs rounded-md transition-colors"
            style={activeTab === tab.id
              ? { backgroundColor: 'var(--color-accent, var(--color-accent-primary))', color: 'var(--ap-fg-0)' }
              : { color: 'var(--color-text-secondary)' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'limits' && renderLimits()}
        {activeTab === 'cost' && renderCost()}
        {activeTab === 'model' && renderModel()}
        {activeTab === 'errors' && renderErrors()}
        {activeTab === 'memory' && renderMemory()}
      </div>
      </div>
    </div>
  );
};
