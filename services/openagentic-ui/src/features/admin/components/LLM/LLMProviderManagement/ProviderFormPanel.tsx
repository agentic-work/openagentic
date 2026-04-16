/**
 * Provider Form Panel — Slide-in form for creating/editing LLM providers.
 */
import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Play, Save, Key } from '@/shared/icons';
import { CheckCircle, XCircle, RefreshCw } from '../../Shared/AdminIcons';
import {
  type DbProvider, type ProviderType, type ProviderDefaultConfig,
  PROVIDER_META, inputCls, inputStyle, btnPrimary, btnSecondary,
} from './types';
import { apiRequest } from '@/utils/api';

// ═══════════════════════════════════════════════════════════════════════════════
// FORM FIELD
// ═══════════════════════════════════════════════════════════════════════════════

const FormField: React.FC<{ label: string; required?: boolean; error?: string; help?: string; children: React.ReactNode }> = ({ label, required, error, help, children }) => (
  <div>
    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
      {label}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
    {children}
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    {help && !error && <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{help}</p>}
  </div>
);

// Re-export FormField for use in CredentialRotationModal
export { FormField };

// ═══════════════════════════════════════════════════════════════════════════════
// FORM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface ProviderFormData {
  name: string; displayName: string; providerType: ProviderType; enabled: boolean;
  priority: number; description: string; authConfig: Record<string, string>;
  /** (#70) SDK-exposed provider settings — populated from PROVIDER_META[type].providerConfigFields */
  providerSettings: Record<string, any>;
}

export function initFormData(provider?: DbProvider | null, _providerDefaults?: Record<string, ProviderDefaultConfig>): ProviderFormData {
  const ac = provider?.auth_config || {};
  const pc = provider?.provider_config || {};
  const pt = (provider?.provider_type || 'ollama') as ProviderType;
  // (#70) Hydrate provider settings from existing provider_config + apply
  // any defaults from PROVIDER_META.providerConfigFields for missing keys.
  const meta = PROVIDER_META[pt];
  const providerSettings: Record<string, any> = {};
  if (meta?.providerConfigFields) {
    for (const f of meta.providerConfigFields) {
      providerSettings[f.key] = pc[f.key] !== undefined ? pc[f.key] : f.default;
    }
  }
  return {
    name: provider?.name || '', displayName: provider?.display_name || '',
    providerType: pt, enabled: provider?.enabled ?? true, priority: provider?.priority || 1,
    description: provider?.description || '', authConfig: { ...ac },
    providerSettings,
  };
}

export function buildPayload(fd: ProviderFormData, _isEdit: boolean, _defaults?: ProviderDefaultConfig) {
  const meta = PROVIDER_META[fd.providerType];
  const authConfig: Record<string, any> = {};
  for (const field of meta.authFields) { const v = fd.authConfig[field.key]; if (v) authConfig[field.key] = v; }

  if (fd.providerType === 'aws-bedrock') {
    authConfig.type = 'iam-keys';
    if (authConfig.awsAccessKeyId) authConfig.accessKeyId = authConfig.awsAccessKeyId;
    if (authConfig.awsSecretAccessKey) authConfig.secretAccessKey = authConfig.awsSecretAccessKey;
  } else if (fd.providerType === 'azure-openai' || fd.providerType === 'azure-ai-foundry') {
    authConfig.type = (authConfig.clientSecret || authConfig.clientId) ? 'entra-id' : 'api-key';
  } else if (fd.providerType === 'vertex-ai') {
    authConfig.type = authConfig.serviceAccountCredentials ? 'service-account' : 'api-key';
    if (authConfig.serviceAccountCredentials) authConfig.credentials = authConfig.serviceAccountCredentials;
  } else if (fd.providerType === 'ollama') {
    authConfig.type = 'none';
    if (authConfig.endpoint) authConfig.baseUrl = authConfig.endpoint;
  } else {
    authConfig.type = 'api-key';
  }

  const providerConfig: Record<string, any> = {};
  if (fd.providerType === 'aws-bedrock' && authConfig.region) {
    providerConfig.region = authConfig.region;
  }

  // For AIF + Azure OpenAI: move non-credential fields to providerConfig
  // The backend expects endpoint/deploymentName/apiVersion in provider_config, not auth_config
  if (fd.providerType === 'azure-ai-foundry' || fd.providerType === 'azure-openai') {
    if (authConfig.endpoint) { providerConfig.endpoint = authConfig.endpoint; delete authConfig.endpoint; }
    if (authConfig.deploymentName) { providerConfig.deploymentName = authConfig.deploymentName; delete authConfig.deploymentName; }
    if (authConfig.apiVersion) { providerConfig.apiVersion = authConfig.apiVersion; delete authConfig.apiVersion; }
  }

  // For Vertex AI: move non-credential fields to providerConfig
  if (fd.providerType === 'vertex-ai') {
    if (authConfig.projectId) { providerConfig.projectId = authConfig.projectId; delete authConfig.projectId; }
    if (authConfig.region) { providerConfig.region = authConfig.region; delete authConfig.region; }
  }

  // (#70) Merge provider-specific SDK settings into providerConfig.
  // These are the values from PROVIDER_META[type].providerConfigFields,
  // which the form lets the admin edit. Empty/undefined values are dropped
  // so we don't override server-side defaults with nulls.
  for (const [k, v] of Object.entries(fd.providerSettings || {})) {
    if (v !== undefined && v !== null && v !== '') {
      providerConfig[k] = v;
    }
  }

  return {
    name: fd.name, displayName: fd.displayName, providerType: fd.providerType,
    enabled: fd.enabled, priority: fd.priority, description: fd.description,
    authConfig, providerConfig,
    capabilities: { chat: true, tools: true, streaming: true },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER FORM PANEL
// ═══════════════════════════════════════════════════════════════════════════════

export const ProviderFormPanel: React.FC<{
  provider: DbProvider | null;
  onSave: (payload: any, isEdit: boolean) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  providerDefaults: Record<string, ProviderDefaultConfig>;
}> = ({ provider, onSave, onCancel, saving, providerDefaults }) => {
  const [fd, setFd] = useState<ProviderFormData>(() => initFormData(provider, providerDefaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isEdit = !!provider;
  const meta = PROVIDER_META[fd.providerType];

  useEffect(() => { setFd(initFormData(provider, providerDefaults)); setErrors({}); setShowPasswords(new Set()); setTestResult(null); }, [provider?.id]);

  const updateAuth = (key: string, val: string) => {
    setFd(prev => ({ ...prev, authConfig: { ...prev.authConfig, [key]: val } }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!fd.name.trim()) errs.name = 'Required';
    if (!fd.displayName.trim()) errs.displayName = 'Required';
    for (const field of meta.authFields) {
      if (field.required && !fd.authConfig[field.key]?.trim()) {
        if (isEdit && fd.authConfig[`has_${field.key}`]) continue;
        errs[field.key] = 'Required';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const providerName = fd.name || 'unknown';
      const res = await apiRequest(`/admin/llm-providers/${encodeURIComponent(providerName)}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testType: 'basic' }),
      });
      if (res.ok) {
        const data = await res.json();
        const basic = data.tests?.basic;
        const ok = basic?.success || data.summary?.successfulTests > 0;
        setTestResult({ ok, message: ok ? `Connected (${basic?.latency || '?'}ms)` : (basic?.error || data.tests?.initialization?.error || 'Test failed') });
      } else {
        const errData = await res.json().catch(() => ({}));
        setTestResult({ ok: false, message: errData.message || `HTTP ${res.status}` });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Connection test failed' });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSave(buildPayload(fd, isEdit), isEdit);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Provider Type Selector */}
      <div className="grid grid-cols-3 gap-2">
        {(Object.entries(PROVIDER_META) as [ProviderType, typeof PROVIDER_META[ProviderType]][]).map(([type, m]) => (
          <button key={type} type="button" disabled={isEdit}
            onClick={() => setFd(prev => ({ ...prev, providerType: type, authConfig: {}, name: '', displayName: '' }))}
            className={`p-2.5 rounded-lg border text-left transition-all ${fd.providerType === type ? `${m.borderColor} ${m.bgColor}` : 'border-transparent'} ${isEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            style={{ backgroundColor: fd.providerType === type ? undefined : 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2">
              <span className="flex items-center">{m.icon}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{m.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Provider Name" required error={errors.name}>
          <input type="text" value={fd.name} onChange={e => setFd(prev => ({ ...prev, name: e.target.value }))} placeholder="my-provider" disabled={isEdit} className={`${inputCls} ${isEdit ? 'opacity-60' : ''}`} style={inputStyle} />
        </FormField>
        <FormField label="Display Name" required error={errors.displayName}>
          <input type="text" value={fd.displayName} onChange={e => setFd(prev => ({ ...prev, displayName: e.target.value }))} placeholder="Production Ollama" className={inputCls} style={inputStyle} />
        </FormField>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Priority" help="Lower = higher priority">
          <input type="number" min={1} max={100} value={fd.priority} onChange={e => setFd(prev => ({ ...prev, priority: parseInt(e.target.value) || 1 }))} className={inputCls} style={inputStyle} />
        </FormField>
        <FormField label="Status">
          <button type="button" onClick={() => setFd(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${fd.enabled ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border-red-500/30 text-red-400'}`}>
            {fd.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </FormField>
        <FormField label="Description">
          <input type="text" value={fd.description} onChange={e => setFd(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional" className={inputCls} style={inputStyle} />
        </FormField>
      </div>

      {/* Authentication */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Key size={12} /> Authentication
        </h4>
        {meta.authFields.map(field => (
          <FormField key={field.key} label={field.label} required={field.required} error={errors[field.key]}>
            {field.type === 'textarea' ? (
              <textarea value={fd.authConfig[field.key] || ''} onChange={e => updateAuth(field.key, e.target.value)} placeholder={field.placeholder} rows={3} className={inputCls} style={inputStyle} />
            ) : field.type === 'password' ? (
              <div className="relative">
                <input type={showPasswords.has(field.key) ? 'text' : 'password'} value={fd.authConfig[field.key] || ''}
                  onChange={e => updateAuth(field.key, e.target.value)}
                  placeholder={fd.authConfig[`has_${field.key}`] ? '(set — leave blank to keep)' : field.placeholder || ''}
                  className={`${inputCls} pr-10`} style={inputStyle} />
                <button type="button" onClick={() => setShowPasswords(prev => { const n = new Set(prev); n.has(field.key) ? n.delete(field.key) : n.add(field.key); return n; })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                  {showPasswords.has(field.key) ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            ) : (
              <input type="text" value={fd.authConfig[field.key] || ''} onChange={e => updateAuth(field.key, e.target.value)} placeholder={field.placeholder} className={inputCls} style={inputStyle} />
            )}
          </FormField>
        ))}
      </div>

      {/* (#70) Provider Settings — SDK-exposed configuration knobs */}
      {meta.providerConfigFields && meta.providerConfigFields.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--color-border)' }}>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Provider Settings</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>SDK-exposed configuration for {meta.label}</p>
            </div>
          </div>
          {meta.providerConfigFields.map(f => {
            const val = fd.providerSettings?.[f.key];
            const update = (newVal: any) => setFd(prev => ({
              ...prev,
              providerSettings: { ...(prev.providerSettings || {}), [f.key]: newVal },
            }));
            return (
              <FormField key={f.key} label={f.label} help={f.help}>
                {f.type === 'toggle' ? (
                  <button
                    type="button"
                    onClick={() => update(!val)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-all"
                    style={{
                      background: val ? 'rgba(0,210,106,0.15)' : 'transparent',
                      borderColor: val ? 'rgba(0,210,106,0.4)' : 'var(--color-border)',
                      color: val ? '#00D26A' : 'var(--text-muted)',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: val ? '#00D26A' : 'var(--text-muted)' }} />
                    {val ? 'Enabled' : 'Disabled'}
                  </button>
                ) : f.type === 'select' && f.options ? (
                  <select
                    value={val ?? f.default ?? ''}
                    onChange={e => update(e.target.value)}
                    className={inputCls}
                    style={inputStyle}
                  >
                    {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'number' ? (
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={val ?? ''}
                    onChange={e => update(e.target.value === '' ? undefined : Number(e.target.value))}
                    placeholder={f.placeholder}
                    className={inputCls}
                    style={inputStyle}
                  />
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={val ?? ''}
                    onChange={e => update(e.target.value)}
                    placeholder={f.placeholder}
                    rows={3}
                    className={inputCls}
                    style={inputStyle}
                  />
                ) : f.type === 'password' ? (
                  <input
                    type="password"
                    value={val ?? ''}
                    onChange={e => update(e.target.value)}
                    placeholder={f.placeholder}
                    className={inputCls}
                    style={inputStyle}
                  />
                ) : (
                  <input
                    type="text"
                    value={val ?? ''}
                    onChange={e => update(e.target.value)}
                    placeholder={f.placeholder}
                    className={inputCls}
                    style={inputStyle}
                  />
                )}
              </FormField>
            );
          })}
        </div>
      )}

      {/* Test Connection + Submit */}
      {testResult && (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: testResult.ok ? '#00D26A40' : '#ef444440', backgroundColor: testResult.ok ? 'rgba(0,210,106,0.08)' : 'rgba(239,68,68,0.08)', color: testResult.ok ? '#00D26A' : '#ef4444' }}>
          {testResult.ok ? <CheckCircle size={14} className="inline mr-2" /> : <XCircle size={14} className="inline mr-2" />}
          {testResult.message}
        </div>
      )}
      <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button type="button" onClick={handleTestConnection} disabled={testingConn} className={btnSecondary} style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>
          {testingConn ? <><RefreshCw size={14} className="inline animate-spin mr-1" /> Testing...</> : <><Play size={14} className="inline mr-1" /> Test Connection</>}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={btnSecondary} style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>Cancel</button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? <><RefreshCw size={14} className="inline animate-spin mr-1" /> Saving...</> : <><Save size={14} className="inline mr-1" /> {isEdit ? 'Update' : 'Create'}</>}
          </button>
        </div>
      </div>
    </form>
  );
};
