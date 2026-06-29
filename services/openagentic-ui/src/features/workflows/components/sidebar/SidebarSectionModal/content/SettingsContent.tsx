/**
 * SettingsContent — per-workflow configuration (execution defaults, cost
 * controls, retry policy, environment variables, tags, visibility).
 */

import React, { useState, useEffect } from 'react';
import { Zap, ShieldCheck, RotateCw, Terminal, Hash, Eye, Trash2, Plus } from '@/shared/icons';
import { inputClass, inputStyle, type WorkflowSettings } from '../sectionShared';

export const SettingsContent: React.FC<{
  workflowSettings?: WorkflowSettings;
  onSettingsChange?: (settings: WorkflowSettings) => void;
}> = ({ workflowSettings, onSettingsChange }) => {
  const [settings, setSettings] = useState<WorkflowSettings>(workflowSettings || {});
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    settings.environmentVariables
      ? Object.entries(settings.environmentVariables).map(([key, value]) => ({ key, value: String(value) }))
      : [{ key: '', value: '' }]
  );

  useEffect(() => {
    if (workflowSettings) {
      setSettings(workflowSettings);
      const vars = workflowSettings.environmentVariables;
      if (vars && typeof vars === 'object') {
        setEnvVars(Object.entries(vars).map(([key, value]) => ({ key, value: String(value) })));
      }
    }
  }, [workflowSettings]);

  const updateSetting = (path: string, value: unknown) => {
    const newSettings = { ...settings };
    const keys = path.split('.');
    let current: Record<string, unknown> = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== 'object') current[keys[i]] = {};
      current = current[keys[i]] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  const updateEnvVars = (newVars: Array<{ key: string; value: string }>) => {
    setEnvVars(newVars);
    const envObj: Record<string, string> = {};
    newVars.forEach(v => { if (v.key.trim()) envObj[v.key.trim()] = v.value; });
    updateSetting('environmentVariables', envObj);
  };

  const sectionHeaderStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };
  const fieldLabelStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };

  return (
    <div className="space-y-8">
      {/* Execution Defaults */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Zap className="w-4 h-4" /> Execution Defaults
        </h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="ssm-exec-default-model" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Model</label>
            <input id="ssm-exec-default-model" type="text" value={settings.execution?.defaultModel || ''} onChange={e => updateSetting('execution.defaultModel', e.target.value)}
              placeholder="auto (platform routing)" className={inputClass} style={inputStyle} />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Leave empty to use platform-level intelligent routing.</p>
          </div>
          {/* 2026-04-19 — Intelligence Level row removed (task #144, slider
              rip). SmartModelRouter picks the model; per-user × per-model
              budget caps live in UserModelBudgetService. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ssm-exec-default-timeout" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Timeout (s)</label>
              <input id="ssm-exec-default-timeout" type="number" value={settings.execution?.defaultTimeout || 60} onChange={e => updateSetting('execution.defaultTimeout', Number.parseInt(e.target.value) || 60)}
                min={1} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ssm-exec-max-time" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Max Execution Time (s)</label>
              <input id="ssm-exec-max-time" type="number" value={settings.execution?.maxExecutionTime || 3600} onChange={e => updateSetting('execution.maxExecutionTime', Number.parseInt(e.target.value) || 3600)}
                min={1} className={inputClass} style={inputStyle} />
            </div>
          </div>
        </div>
      </div>

      {/* Cost Controls */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <ShieldCheck className="w-4 h-4" /> Cost Controls
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="ssm-cost-per-exec" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Per-Execution Budget ($)</label>
              <input id="ssm-cost-per-exec" type="number" value={settings.costs?.perExecution || ''} onChange={e => updateSetting('costs.perExecution', Number.parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ssm-cost-daily" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Daily Budget ($)</label>
              <input id="ssm-cost-daily" type="number" value={settings.costs?.daily || ''} onChange={e => updateSetting('costs.daily', Number.parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ssm-cost-monthly" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Monthly Budget ($)</label>
              <input id="ssm-cost-monthly" type="number" value={settings.costs?.monthly || ''} onChange={e => updateSetting('costs.monthly', Number.parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div>
            <label htmlFor="ssm-cost-on-exceeded" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>On Budget Exceeded</label>
            <select id="ssm-cost-on-exceeded" value={settings.costs?.onExceeded || 'pause'} onChange={e => updateSetting('costs.onExceeded', e.target.value)} className={inputClass} style={inputStyle}>
              <option value="pause">Pause Execution</option>
              <option value="downgrade">Downgrade Model Tier</option>
              <option value="abort">Abort Workflow</option>
            </select>
          </div>
        </div>
      </div>

      {/* Retry Policy */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <RotateCw className="w-4 h-4" /> Default Retry Policy
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ssm-retry-count" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Retry Count</label>
              <input id="ssm-retry-count" type="number" value={settings.retry?.count || 3} onChange={e => updateSetting('retry.count', Number.parseInt(e.target.value) || 3)}
                min={0} max={10} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ssm-retry-delay" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Delay (ms)</label>
              <input id="ssm-retry-delay" type="number" value={settings.retry?.delayMs || 1000} onChange={e => updateSetting('retry.delayMs', Number.parseInt(e.target.value) || 1000)}
                min={100} className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div>
            <label htmlFor="ssm-retry-backoff" className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Backoff Strategy</label>
            <select id="ssm-retry-backoff" value={settings.retry?.backoff || 'fixed'} onChange={e => updateSetting('retry.backoff', e.target.value)} className={inputClass} style={inputStyle}>
              <option value="fixed">Fixed</option>
              <option value="exponential">Exponential</option>
            </select>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Terminal className="w-4 h-4" /> Environment Variables
        </h3>
        <div className="space-y-2">
          {envVars.map((v, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input type="text" value={v.key} onChange={e => { const nv = [...envVars]; nv[idx] = { ...nv[idx], key: e.target.value }; updateEnvVars(nv); }}
                placeholder="KEY" className={`${inputClass} flex-1 font-mono`} style={inputStyle} />
              <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>=</span>
              <input type="text" value={v.value} onChange={e => { const nv = [...envVars]; nv[idx] = { ...nv[idx], value: e.target.value }; updateEnvVars(nv); }}
                placeholder="value" className={`${inputClass} flex-1 font-mono`} style={inputStyle} />
              <button onClick={() => { const nv = envVars.filter((_, i) => i !== idx); updateEnvVars(nv.length ? nv : [{ key: '', value: '' }]); }}
                className="p-1.5 rounded-lg transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]" style={{ color: 'var(--color-error)' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => { const nv = [...envVars, { key: '', value: '' }]; setEnvVars(nv); }}
            className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80 mt-2" style={{ color: 'var(--color-accent)' }}>
            <Plus className="w-3.5 h-3.5" /> Add Variable
          </button>
        </div>
      </div>

      {/* Tags */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Hash className="w-4 h-4" /> Tags
        </h3>
        <input type="text" value={settings.tags || ''} onChange={e => updateSetting('tags', e.target.value)}
          placeholder="e.g., production, finance, nightly" className={inputClass} style={inputStyle} />
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma-separated tags for categorization and filtering.</p>
      </div>

      {/* Visibility */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Eye className="w-4 h-4" /> Visibility
        </h3>
        <select value={settings.visibility || 'private'} onChange={e => updateSetting('visibility', e.target.value)} className={inputClass} style={inputStyle}>
          <option value="private">Private - Only you</option>
          <option value="team">Team - Your team members</option>
          <option value="public">Public - All platform users</option>
        </select>
      </div>
    </div>
  );
};
