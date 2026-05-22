import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Play, Search, X, Save, ChevronDown, ChevronRight } from '@/shared/icons';
import { Clock, Settings } from '../Shared/AdminIcons';

// =============================================================================
// Types
// =============================================================================

interface AgentSchedule {
  id: string;
  agentId: string;
  agentName: string;
  cronExpression: string;
  cronDescription: string;
  targetWorkflowId?: string;
  targetWorkflowName?: string;
  inputTemplate?: Record<string, any>;
  maxConcurrentRuns: number;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
}

interface AgentOption {
  id: string;
  displayName: string;
}

interface WorkflowOption {
  id: string;
  name: string;
}

interface AgentScheduleViewProps {
  theme: string;
}

// =============================================================================
// Cron helpers
// =============================================================================

interface CronPreset {
  label: string;
  cron: string;
  description: string;
}

const CRON_PRESETS: CronPreset[] = [
  { label: 'Every 5 min',  cron: '*/5 * * * *',  description: 'Runs every 5 minutes' },
  { label: 'Every 15 min', cron: '*/15 * * * *', description: 'Runs every 15 minutes' },
  { label: 'Every hour',   cron: '0 * * * *',    description: 'Runs at the start of every hour' },
  { label: 'Every 6 hours',cron: '0 */6 * * *',  description: 'Runs every 6 hours' },
  { label: 'Daily',        cron: '0 9 * * *',    description: 'Runs daily at 9:00 AM' },
  { label: 'Weekly',       cron: '0 9 * * 1',    description: 'Runs every Monday at 9:00 AM' },
];

function describeCron(expression: string): string {
  const preset = CRON_PRESETS.find(p => p.cron === expression);
  if (preset) return preset.description;

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 'Invalid cron expression';

  const [minute, hour, dom, month, dow] = parts;
  const segments: string[] = [];

  if (minute.startsWith('*/')) segments.push(`every ${minute.slice(2)} minute(s)`);
  else if (minute !== '*' && minute !== '0') segments.push(`at minute ${minute}`);

  if (hour.startsWith('*/')) segments.push(`every ${hour.slice(2)} hour(s)`);
  else if (hour !== '*') segments.push(`at ${hour}:${minute === '*' ? '00' : minute.padStart(2, '0')}`);

  if (dom !== '*') segments.push(`on day ${dom}`);
  if (month !== '*') segments.push(`in month ${month}`);
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNum = parseInt(dow);
    segments.push(`on ${days[dayNum] || dow}`);
  }

  return segments.length > 0 ? segments.join(', ') : 'Runs every minute';
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString();
}

// =============================================================================
// Main Component
// =============================================================================

export const AgentScheduleView: React.FC<AgentScheduleViewProps> = ({ theme }) => {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Create form state
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [formAgent, setFormAgent] = useState('');
  const [formCron, setFormCron] = useState('0 * * * *');
  const [formCustomCron, setFormCustomCron] = useState('');
  const [formUseCustom, setFormUseCustom] = useState(false);
  const [formWorkflow, setFormWorkflow] = useState('');
  const [formInputTemplate, setFormInputTemplate] = useState('{}');
  const [formMaxConcurrent, setFormMaxConcurrent] = useState(1);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/agent-schedules', { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch schedules: ${response.statusText}`);
      const data = await response.json();
      setSchedules(data.schedules || []);
    } catch (err: any) {
      setSchedules([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/agents', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      setAgents((data.agents || []).map((a: any) => ({
        id: a.id,
        displayName: a.display_name || a.name || a.id,
      })));
    } catch { /* non-critical */ }
  }, []);

  const fetchWorkflows = useCallback(async () => {
    try {
      const response = await fetch('/api/workflows', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      setWorkflows((data.workflows || []).map((w: any) => ({
        id: w.id,
        name: w.name || w.id,
      })));
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchSchedules(); fetchAgents(); fetchWorkflows(); }, [fetchSchedules, fetchAgents, fetchWorkflows]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleCreate = async () => {
    if (!formAgent) { setError('Please select an agent'); return; }
    const cronExpr = formUseCustom ? formCustomCron : formCron;
    if (!cronExpr.trim()) { setError('Please enter a cron expression'); return; }

    let inputObj: Record<string, any> = {};
    try {
      inputObj = JSON.parse(formInputTemplate || '{}');
    } catch {
      setError('Invalid JSON in input template');
      return;
    }

    try {
      const response = await fetch('/api/admin/agent-schedules', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: formAgent,
          cronExpression: cronExpr,
          targetWorkflowId: formWorkflow || undefined,
          inputTemplate: inputObj,
          maxConcurrentRuns: formMaxConcurrent,
          enabled: true,
        }),
      });
      if (!response.ok) throw new Error('Failed to create schedule');
      setShowCreate(false);
      resetForm();
      fetchSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggle = async (scheduleId: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/admin/agent-schedules/${scheduleId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('Failed to update schedule');
      setSchedules(prev => prev.map(s => s.id === scheduleId ? { ...s, enabled } : s));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/admin/agent-schedules/${scheduleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete schedule');
      setDeleteConfirm(null);
      fetchSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRunNow = async (scheduleId: string) => {
    try {
      const response = await fetch(`/api/admin/agent-schedules/${scheduleId}/run`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to trigger run');
      fetchSchedules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const resetForm = () => {
    setFormAgent('');
    setFormCron('0 * * * *');
    setFormCustomCron('');
    setFormUseCustom(false);
    setFormWorkflow('');
    setFormInputTemplate('{}');
    setFormMaxConcurrent(1);
  };

  // ---------------------------------------------------------------------------
  // Filtered
  // ---------------------------------------------------------------------------

  const filteredSchedules = schedules.filter(s =>
    s.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.cronDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.targetWorkflowName || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg-primary, var(--color-bg))',
    border: '1px solid var(--color-border, var(--color-border-default))',
    color: 'var(--color-text-primary)',
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading && schedules.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-secondary)' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mr-3" />
        Loading schedules...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>Agent Schedules</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {schedules.length} schedule{schedules.length !== 1 ? 's' : ''} &middot; {schedules.filter(s => s.enabled).length} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchSchedules}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border, var(--color-border-default))' }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-white transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--color-accent, var(--color-accent-primary))' }}
          >
            <Plus size={14} /> New Schedule
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
      <div className="px-4 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search schedules..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-sm outline-none transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
      </div>

      {/* Schedule List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredSchedules.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {searchQuery ? 'No schedules match your search.' : 'No agent schedules configured yet.'}
          </div>
        ) : (
          <div className="space-y-2 mt-2">
            {filteredSchedules.map(schedule => (
              <div
                key={schedule.id}
                className="rounded-lg overflow-hidden transition-all"
                style={{
                  backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
                  border: schedule.enabled
                    ? '1px solid var(--color-border, var(--color-border-default))'
                    : '1px solid color-mix(in srgb, var(--color-text-tertiary) 20%, transparent)',
                  opacity: schedule.enabled ? 1 : 0.6,
                }}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status indicator */}
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: schedule.enabled ? 'var(--color-success)' : 'color-mix(in srgb, var(--color-text-tertiary) 40%, transparent)' }}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{schedule.agentName}</span>
                      <span className="px-1.5 py-0.5 text-xs rounded-full font-mono" style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-secondary) 12%, transparent)', color: 'var(--color-secondary)',
                      }}>
                        {schedule.cronExpression}
                      </span>
                      {schedule.targetWorkflowName && (
                        <span className="px-1.5 py-0.5 text-xs rounded-full" style={{
                          backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)',
                        }}>
                          {schedule.targetWorkflowName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      <span>{schedule.cronDescription || describeCron(schedule.cronExpression)}</span>
                      <span>Runs: {schedule.runCount}</span>
                      <span>Last: {formatDate(schedule.lastRun)}</span>
                      <span>Next: {formatDate(schedule.nextRun)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleRunNow(schedule.id)}
                      className="p-1 rounded hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--color-success)' }}
                      title="Run now"
                    ><Play size={14} /></button>
                    <button
                      onClick={() => handleToggle(schedule.id, !schedule.enabled)}
                      className="px-2 py-0.5 text-xs rounded-full transition-colors"
                      style={schedule.enabled
                        ? { backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }
                        : { backgroundColor: 'color-mix(in srgb, var(--color-text-tertiary) 15%, transparent)', color: 'var(--color-text-tertiary)' }
                      }
                    >
                      {schedule.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(schedule.id)}
                      className="p-1 rounded hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--color-error)' }}
                      title="Delete"
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Schedule Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div
            className="rounded-xl w-[600px] max-h-[85vh] overflow-y-auto shadow-2xl"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Create Agent Schedule</h3>
              <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: 'var(--color-text-secondary)' }}><X size={16} /></button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* Agent Selection */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Agent</h4>
                <select
                  value={formAgent}
                  onChange={e => setFormAgent(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="">Select an agent...</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.displayName}</option>
                  ))}
                </select>
              </div>

              {/* Cron Builder */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Schedule</h4>

                {/* Presets */}
                <div className="grid grid-cols-3 gap-2">
                  {CRON_PRESETS.map(preset => {
                    const isSelected = !formUseCustom && formCron === preset.cron;
                    return (
                      <button
                        key={preset.cron}
                        onClick={() => { setFormCron(preset.cron); setFormUseCustom(false); }}
                        className="px-3 py-2 rounded-lg text-xs text-left transition-all border"
                        style={isSelected ? {
                          backgroundColor: 'color-mix(in srgb, var(--color-secondary) 15%, transparent)',
                          borderColor: 'var(--color-secondary)',
                          color: 'var(--color-secondary)',
                        } : {
                          backgroundColor: 'transparent',
                          borderColor: 'var(--color-border, var(--color-border-default))',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <div className="font-medium">{preset.label}</div>
                        <div className="text-xs mt-0.5 opacity-70">{preset.cron}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Custom cron */}
                <div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={formUseCustom}
                      onChange={e => setFormUseCustom(e.target.checked)}
                      className="rounded"
                    />
                    Custom cron expression
                  </label>
                  {formUseCustom && (
                    <input
                      value={formCustomCron}
                      onChange={e => setFormCustomCron(e.target.value)}
                      placeholder="*/10 * * * *"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
                      style={inputStyle}
                    />
                  )}
                </div>

                {/* Human-readable description */}
                <div className="p-2 rounded-lg text-xs" style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-secondary) 5%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-secondary) 15%, transparent)',
                  color: 'var(--color-secondary)',
                }}>
                  {describeCron(formUseCustom ? formCustomCron : formCron)}
                </div>
              </div>

              {/* Target Workflow */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>
                  Target Workflow <span className="normal-case font-normal" style={{ color: 'var(--color-text-tertiary)' }}>(optional)</span>
                </h4>
                <select
                  value={formWorkflow}
                  onChange={e => setFormWorkflow(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={inputStyle}
                >
                  <option value="">No workflow (direct agent run)</option>
                  {workflows.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              {/* Input Template */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>
                  Input Template <span className="normal-case font-normal" style={{ color: 'var(--color-text-tertiary)' }}>(JSON)</span>
                </h4>
                <textarea
                  value={formInputTemplate}
                  onChange={e => setFormInputTemplate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm h-24 resize-none outline-none font-mono text-xs"
                  style={inputStyle}
                  placeholder='{"key": "value"}'
                />
              </div>

              {/* Max concurrent */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent, var(--color-accent-primary))' }}>Concurrency</h4>
                <div className="flex items-center gap-3">
                  <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Max concurrent runs:</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={formMaxConcurrent}
                    onChange={e => setFormMaxConcurrent(parseInt(e.target.value) || 1)}
                    className="w-20 px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--color-border, var(--color-border-default))' }}>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border, var(--color-border-default))' }}
              >Cancel</button>
              <button
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--color-accent, var(--color-accent-primary))' }}
              >
                <Save size={14} /> Create Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div
            className="rounded-xl w-[400px] shadow-2xl"
            style={{
              backgroundColor: 'var(--color-bg-surface, var(--color-surface))',
              border: '1px solid var(--color-border, var(--color-border-default))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--color-border, var(--color-border-default))' }}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Delete Schedule</h3>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Are you sure you want to delete this schedule? This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--color-border, var(--color-border-default))' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border, var(--color-border-default))' }}
              >Cancel</button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-lg text-white transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--color-error)' }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
