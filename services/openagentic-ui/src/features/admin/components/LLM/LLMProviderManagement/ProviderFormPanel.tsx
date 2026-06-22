/**
 * Provider Form Panel — Slide-in form for creating/editing LLM providers.
 */
import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Play, Save, Key } from '@/shared/icons';
import { CheckCircle, XCircle, RefreshCw } from '../../Shared/AdminIcons';
import {
  type DbProvider, type ProviderType, type ProviderDefaultConfig, type AuthMode,
  PROVIDER_META, inputCls, inputStyle, btnPrimary, btnSecondary,
} from './types';
import {
  DISCRIMINATORS,
  buildAutoDisplayName,
  validateDiscriminator,
  isGenericName,
} from '@/shared/llm-providers/ProviderDiscriminatorSchema';

/**
 * Pick the active auth-field set for a provider type at a given auth
 * mode. Falls back to the legacy single-mode `authFields` when
 * `authModes` isn't defined for the provider (covers non-azure
 * providers where mode toggling doesn't apply).
 */
function getActiveAuthFields(providerType: ProviderType, authMode: AuthMode) {
  const meta = PROVIDER_META[providerType];
  return meta.authModes?.[authMode] ?? meta.authFields;
}
import { apiRequest } from '@/utils/api';

// ═══════════════════════════════════════════════════════════════════════════════
// FORM FIELD
// ═══════════════════════════════════════════════════════════════════════════════

const FormField: React.FC<{ label: string; required?: boolean; error?: string; help?: string; children: React.ReactNode }> = ({ label, required, error, help, children }) => (
  <div>
    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
      {label}{required && <span className="text-err ml-0.5">*</span>}
    </label>
    {children}
    {error && <p className="mt-1 text-xs text-err">{error}</p>}
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
  /**
   * For providers that expose `authModes` (azure-* today), this carries
   * the active mode. Drives both rendered fields and final
   * `auth_config.type` in the payload. Default: `'api-key'` when the
   * provider type has authModes; ignored otherwise.
   */
  authMode: AuthMode;
  /**
   * discriminator origin — env + per-type identifiers (account/
   * project/tenant + region/hostname). Drives the live display-name
   * preview and is enforced server-side in POST/PUT. Schema lives in
   * shared/llm-providers/ProviderDiscriminatorSchema.
   */
  origin: Record<string, string>;
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
  // Detect existing auth mode from the saved row's auth_config.type. New
  // rows default to api-key; existing entra-id rows snap to entra-id.
  const detectedAuthMode: AuthMode =
    (ac as any).type === 'entra-id' ? 'entra-id' : 'api-key';
  // Hydrate origin from existing provider_config.origin (discriminator
  // metadata). Existing rows without origin are
  // grandfathered server-side, so empty {} is fine on edit.
  const origin: Record<string, string> = { ...((pc as any)?.origin || {}) };
  return {
    name: provider?.name || '', displayName: provider?.display_name || '',
    providerType: pt, enabled: provider?.enabled ?? true, priority: provider?.priority || 1,
    description: provider?.description || '', authConfig: { ...ac },
    providerSettings,
    authMode: detectedAuthMode,
    origin,
  };
}

export function buildPayload(fd: ProviderFormData, _isEdit: boolean, _defaults?: ProviderDefaultConfig) {
  const meta = PROVIDER_META[fd.providerType];
  // When the provider exposes authModes, project ONLY the active mode's
  // fields into the payload — this strips stale values left over from
  // toggling between modes mid-form (e.g. an apiKey typed before the
  // user flipped to entra-id must NOT travel to the server).
  const activeFields = meta.authModes?.[fd.authMode] ?? meta.authFields;
  const authConfig: Record<string, any> = {};
  for (const field of activeFields) { const v = fd.authConfig[field.key]; if (v) authConfig[field.key] = v; }

  if (fd.providerType === 'aws-bedrock') {
    authConfig.type = 'iam-keys';
    if (authConfig.awsAccessKeyId) authConfig.accessKeyId = authConfig.awsAccessKeyId;
    if (authConfig.awsSecretAccessKey) authConfig.secretAccessKey = authConfig.awsSecretAccessKey;
  } else if (fd.providerType === 'azure-openai' || fd.providerType === 'azure-ai-foundry') {
    // Mode-driven: trust fd.authMode rather than guessing from
    // field-presence (which broke when admins toggled mid-form). Mode
    // is set by the radio toggle and persists per-edit.
    authConfig.type = fd.authMode === 'entra-id' ? 'entra-id' : 'api-key';
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

  // discriminator origin — env + per-type identifiers. Server-side
  // POST/PUT enforces this (gated by PROVIDER_DISCRIMINATOR_ENFORCED env);
  // we always send what the admin filled in. Empty values are stripped so
  // the server gets a clean `{env, account, region}` shape.
  const cleanOrigin: Record<string, string> = {};
  for (const [k, v] of Object.entries(fd.origin || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      cleanOrigin[k] = String(v).trim();
    }
  }
  if (Object.keys(cleanOrigin).length > 0) {
    providerConfig.origin = cleanOrigin;
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

  const activeAuthFields = getActiveAuthFields(fd.providerType, fd.authMode);

  const discriminatorSchema = DISCRIMINATORS[fd.providerType];
  const derivedDisplayName = buildAutoDisplayName(fd.providerType, fd.origin);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!fd.name.trim()) errs.name = 'Required';
    if (!fd.displayName.trim()) errs.displayName = 'Required';
    for (const field of activeAuthFields) {
      if (field.required && !fd.authConfig[field.key]?.trim()) {
        if (isEdit && fd.authConfig[`has_${field.key}`]) continue;
        errs[field.key] = 'Required';
      }
    }
    // Discriminator gate (mirrors API enforcement). Only fires on new
    // providers; edits skip if the row was created pre-flag (the
    // server-side gate handles grandfathering).
    if (!isEdit) {
      if (fd.displayName.trim() && isGenericName(fd.displayName)) {
        errs.displayName = 'Provider name is too generic. Add an environment + identifier (e.g. "bedrock-prod-1234-us-east-1").';
      }
      if (fd.name.trim() && isGenericName(fd.name)) {
        errs.name = 'Provider name is too generic.';
      }
      const validation = validateDiscriminator(fd.providerType, fd.origin);
      if (validation.ok === false) {
        for (const k of validation.missing) {
          errs[`origin_${k}`] = `Required origin field: ${k}`;
        }
        errs.origin = `Missing required origin fields: ${validation.missing.join(', ')}`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      // #287: in CREATE mode, test inline form data via /test-config (no DB
      // row required). In EDIT mode, test the saved row via /:name/test
      // (still works for already-persisted rows + lets server use stored,
      // never-round-tripped credentials).
      let res: Response;
      if (isEdit) {
        const providerName = fd.name || 'unknown';
        res = await apiRequest(`/admin/llm-providers/${encodeURIComponent(providerName)}/test`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testType: 'basic' }),
        });
      } else {
        const payload = buildPayload(fd, false);
        res = await apiRequest(`/admin/llm-providers/test-config`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerType: payload.providerType,
            name: payload.name,
            authConfig: payload.authConfig,
            providerConfig: payload.providerConfig,
            testType: 'basic',
          }),
        });
      }
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
          <input type="number" min={1} max={100} value={fd.priority} onChange={e => setFd(prev => ({ ...prev, priority: Number.parseInt(e.target.value) || 1 }))} className={inputCls} style={inputStyle} />
        </FormField>
        <FormField label="Status">
          <button type="button" onClick={() => setFd(prev => ({ ...prev, enabled: !prev.enabled }))}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${fd.enabled ? 'bg-[color-mix(in_srgb,var(--color-ok)_15%,transparent)] border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)] text-ok' : 'bg-[color-mix(in_srgb,var(--color-err)_15%,transparent)] border-[color-mix(in_srgb,var(--color-err)_30%,transparent)] text-err'}`}>
            {fd.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </FormField>
        <FormField label="Description">
          <input type="text" value={fd.description} onChange={e => setFd(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional" className={inputCls} style={inputStyle} />
        </FormField>
      </div>

      {/* Discriminator origin (discriminator per-type identifiers) */}
      {discriminatorSchema && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Origin
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {discriminatorSchema.required.map(key => (
              <FormField
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1)}
                required
                error={errors[`origin_${key}`]}
              >
                <input
                  type="text"
                  data-testid={`origin-${key}`}
                  aria-label={key.charAt(0).toUpperCase() + key.slice(1)}
                  value={fd.origin[key] || ''}
                  onChange={e => setFd(prev => ({ ...prev, origin: { ...prev.origin, [key]: e.target.value } }))}
                  placeholder={key === 'env' ? 'prod | staging | dev' : ''}
                  className={inputCls}
                  style={inputStyle}
                />
              </FormField>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Suggested display name:{' '}
            <span data-testid="display-name-preview" className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {derivedDisplayName}
            </span>
          </p>
          {errors.origin && <p className="text-xs text-err">{errors.origin}</p>}
        </div>
      )}

      {/* Authentication */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Key size={12} /> Authentication
        </h4>

        {/* Auth-mode toggle — only visible for providers that support both
            api-key and entra-id flows (azure-* today). Switching modes
            preserves typed-in fields and lets buildPayload strip stale
            values from the inactive mode. */}
        {meta.authModes && meta.authModes['api-key'] && meta.authModes['entra-id'] && (
          <div
            role="radiogroup"
            aria-label="Authentication mode"
            className="flex items-center gap-1 rounded-lg p-1 border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}
          >
            {(['api-key', 'entra-id'] as AuthMode[]).map((mode) => {
              const active = fd.authMode === mode;
              const label = mode === 'api-key' ? 'API Key' : 'Entra ID';
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFd(prev => ({ ...prev, authMode: mode }))}
                  className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                  style={{
                    backgroundColor: active ? 'var(--color-surface)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: active ? '1px solid var(--color-border)' : '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {activeAuthFields.map(field => (
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
                      background: val ? 'color-mix(in srgb, var(--color-ok) 15%, transparent)' : 'transparent',
                      borderColor: val ? 'color-mix(in srgb, var(--color-ok) 40%, transparent)' : 'var(--color-border)',
                      color: val ? 'var(--ap-ok)' : 'var(--text-muted)',
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: val ? 'var(--ap-ok)' : 'var(--text-muted)' }} />
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
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: testResult.ok ? 'var(--ap-ok-soft)' : 'var(--ap-err-soft)', backgroundColor: testResult.ok ? 'color-mix(in srgb, var(--color-ok) 8%, transparent)' : 'color-mix(in srgb, var(--color-err) 8%, transparent)', color: testResult.ok ? 'var(--ap-ok)' : 'var(--ap-err)' }}>
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
