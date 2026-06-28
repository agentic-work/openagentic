/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Models domain — REAL CRUD dialogs, a model sandbox/playground, and a
 * provider audit/chain-of-custody feed, wired into the v4 admin console's
 * Models pages (pages/models.tsx — providers + model-management leaves).
 *
 * Everything here is token-only (var(--*) — zero hex/rgb/named colors,
 * CLAUDE.md Rule 8b) and renders a live value from a hook/endpoint or an
 * honest "—"; no value is fabricated. All payloads are stringified before
 * render so a raw object never reaches the DOM (no React #31).
 *
 * Components:
 *   ModalShell        — token-only fixed-overlay modal (mirrors AdminConsoleHost
 *                       OverlaySheet, centered card form).
 *   ProviderModal     — create + edit provider. The provider-type selector
 *                       swaps the per-type auth (incl. azure dual-mode) +
 *                       providerConfig field groups from PROVIDER_META. Test
 *                       connection (saved → /:name/test, unsaved → /test-config),
 *                       optimistic-concurrency PUT (409 → conflict banner),
 *                       soft-delete with force confirm.
 *   ModelModal        — create/edit a model registry row. PATCH /registry/:id
 *                       for an existing row's role/priority/enabled/temp/
 *                       max_tokens/FCA; PUT /:providerId/models/:modelId to
 *                       create/configure a model on a provider (displayName,
 *                       capabilities, config). DELETE registry/:id.
 *   ModelSandbox      — provider+model picker, system+user prompt, key knobs
 *                       (temperature/maxTokens/topP/stream), Run → POST
 *                       /playground (testType chat) → response + usage + latency
 *                       + estimated cost. Honest error band on failure.
 *   ProviderAuditFeed — GET /audit-logs?resourceType=LLMProvider → who/action/
 *                       resource/when/result table. Honest-empty when none.
 *
 * Endpoint contract (all live; see services/openagentic-api/src/routes/admin/
 * llm-providers.ts + routes/admin-audit-logs.ts):
 *   GET    /api/admin/llm-providers
 *   POST   /api/admin/llm-providers
 *   PUT    /api/admin/llm-providers/:id            ({version} for OCC; 409)
 *   DELETE /api/admin/llm-providers/:id?force=true
 *   POST   /api/admin/llm-providers/:name/test
 *   POST   /api/admin/llm-providers/test-config
 *   GET    /api/admin/llm-providers/registry?enabledOnly=false
 *   PATCH  /api/admin/llm-providers/registry/:id
 *   DELETE /api/admin/llm-providers/registry/:id
 *   PUT    /api/admin/llm-providers/:providerId/models/:modelId
 *   DELETE /api/admin/llm-providers/:providerId/models/:modelId?force=true
 *   GET    /api/admin/llm-providers/:nameOrId/discover-models
 *   POST   /api/admin/llm-providers/playground
 *   GET    /api/admin/audit-logs?resourceType=LLMProvider&limit=50
 */
import * as React from 'react'
import { apiRequest } from '@/utils/api'
import { Banner, Btn, Pill, StatusDot, Tag } from '../primitives'
import {
  PROVIDER_META,
  type AuthMode,
  type ProviderType,
} from '../../components/LLM/LLMProviderManagement/types'
import { deriveOrigin } from '../../pages-v3/llm-providers/deriveOrigin'
import {
  useAdminInvalidate,
  useAdminQuery,
} from '../../hooks/useAdminQuery'
import {
  useLlmProviders,
  useLlmRegistry,
  type LlmProviderRow,
  type LlmRegistryRow,
} from '../../hooks/useDashboardMetrics'

/* ════════════════════════════════════════════════════════════════════════
 * Tiny token-only toast (success/error) used by every dialog. The console
 * has no global toast bus, so dialogs surface their own inline status; a
 * caller may also pass a `notify` callback for a host-level banner.
 * ════════════════════════════════════════════════════════════════════════ */
export type NotifyFn = (tone: 'ok' | 'err' | 'info', msg: string) => void

/* ──────────────── shared token-only input styles ──────────────── */
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 30,
  padding: '0 9px',
  fontFamily: 'var(--font-v3-mono, ui-monospace, monospace)',
  fontSize: 12,
  background: 'var(--bg-0)',
  border: '1px solid var(--line-1)',
  borderRadius: 6,
  color: 'var(--fg-0)',
  outline: 'none',
}
const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 70,
  padding: 8,
  resize: 'vertical',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-1)',
  marginBottom: 4,
}
const descStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-2)',
  marginTop: 3,
  lineHeight: 1.4,
}
const sectionHeadStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--fg-2)',
  margin: '16px 0 8px',
  paddingBottom: 6,
  borderBottom: '1px solid var(--line-1)',
}

/** stringify any payload so a raw object never renders (no React #31). */
function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** A labelled form field row. */
function Field({
  label,
  desc,
  required,
  children,
}: {
  label: string
  desc?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: 'var(--err)' }}> *</span>}
      </label>
      {children}
      {desc && <div style={descStyle}>{desc}</div>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * ModalShell — token-only centered modal card (fixed overlay).
 * ════════════════════════════════════════════════════════════════════════ */
export function ModalShell({
  title,
  sub,
  onClose,
  width = 560,
  footer,
  children,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  onClose: () => void
  width?: number
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  // ESC closes.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--bg-0) 64%, transparent)',
          backdropFilter: 'blur(3px)',
          zIndex: 70,
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width,
          maxWidth: '94vw',
          maxHeight: '90vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 12,
          zIndex: 71,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 28px 80px -22px color-mix(in srgb, var(--bg-0) 82%, transparent)',
        }}
      >
        <div
          style={{
            padding: '15px 18px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg-0)' }}>{title}</div>
            {sub != null && <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{sub}</div>}
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose} aria-label="close">
            ✕
          </Btn>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--line-1)',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * ProviderModal — create + edit a provider with the FULL per-type field set.
 * ════════════════════════════════════════════════════════════════════════ */
const PROVIDER_TYPES: ProviderType[] = [
  'azure-openai',
  'azure-ai-foundry',
  'vertex-ai',
  'aws-bedrock',
  'ollama',
  'anthropic',
  'openai',
]

const CAP_KEYS = ['chat', 'tools', 'vision', 'streaming', 'embeddings'] as const
type CapKey = (typeof CAP_KEYS)[number]

/* The FULL capability flag set the registry's capabilities JSON supports
 * (schema.prisma comment: chat/tools/streaming/vision/thinking/embeddings/
 * imageGeneration/nativeToolCalling). The provider modal uses the shorter
 * CAP_KEYS set; the model modal exposes the complete set below. */
const MODEL_CAP_KEYS = [
  'chat',
  'tools',
  'streaming',
  'vision',
  'thinking',
  'embeddings',
  'imageGeneration',
  'nativeToolCalling',
] as const
type ModelCapKey = (typeof MODEL_CAP_KEYS)[number]

/** pricing_source app-side enum (schema.prisma). */
const PRICING_SOURCES = [
  'bedrock-pricing-sdk',
  'google-billing-sdk',
  'azure-retail-prices',
  'zero-cost-local',
  'manual',
] as const

/** RegistryRowState values an admin write may transition a row to. */
const REGISTRY_STATES = ['proposed', 'approved', 'active', 'deprecated', 'disposed'] as const

interface ProviderFormState {
  name: string
  displayName: string
  providerType: ProviderType
  priority: number
  enabled: boolean
  description: string
  authMode: AuthMode
  authValues: Record<string, string>
  providerConfig: Record<string, unknown>
  capabilities: Record<CapKey, boolean>
}

const blankProvider = (): ProviderFormState => ({
  name: '',
  displayName: '',
  providerType: 'openai',
  priority: 50,
  enabled: true,
  description: '',
  authMode: 'api-key',
  authValues: {},
  providerConfig: {},
  capabilities: { chat: true, tools: true, vision: false, streaming: true, embeddings: false },
})

function providerFromRow(row: LlmProviderRow): ProviderFormState {
  const raw = row as unknown as Record<string, unknown>
  const ac = (raw.auth_config ?? raw.authConfig ?? {}) as Record<string, string>
  const pc = (raw.provider_config ?? raw.config ?? {}) as Record<string, unknown>
  const caps = (raw.capabilities ?? {}) as Record<string, boolean>
  return {
    name: row.name,
    displayName: row.displayName ?? row.name,
    providerType: (row.type as ProviderType) ?? 'openai',
    priority: row.priority ?? 50,
    enabled: row.enabled !== false,
    description: typeof raw.description === 'string' ? raw.description : '',
    authMode: (ac.tenantId ? 'entra-id' : 'api-key') as AuthMode,
    authValues: { ...ac },
    providerConfig: { ...pc },
    capabilities: {
      chat: caps.chat ?? true,
      tools: caps.tools ?? false,
      vision: caps.vision ?? false,
      streaming: caps.streaming ?? true,
      embeddings: caps.embeddings ?? false,
    },
  }
}

interface TestResult {
  ok: boolean
  latency?: number
  message: string
  raw?: unknown
}

export function ProviderModal({
  editing,
  onClose,
  notify,
}: {
  /** null → create; a row → edit. */
  editing: LlmProviderRow | null
  onClose: () => void
  notify?: NotifyFn
}) {
  const invalidate = useAdminInvalidate()
  const isEdit = editing != null
  const [form, setForm] = React.useState<ProviderFormState>(() =>
    editing ? providerFromRow(editing) : blankProvider(),
  )
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [conflict, setConflict] = React.useState<string[] | null>(null)
  const [test, setTest] = React.useState<TestResult | null>(null)

  const meta = PROVIDER_META[form.providerType]
  const authFields = meta?.authModes?.[form.authMode] ?? meta?.authFields ?? []
  const providerConfigFields = meta?.providerConfigFields ?? []

  const setAuthVal = (key: string, value: string) =>
    setForm((s) => ({ ...s, authValues: { ...s.authValues, [key]: value } }))
  const setConfigVal = (key: string, value: unknown) =>
    setForm((s) => ({ ...s, providerConfig: { ...s.providerConfig, [key]: value } }))

  const validate = (): string | null => {
    if (!form.name.trim()) return 'name is required (lowercase, kebab-case)'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.name.trim()))
      return 'name must be lowercase letters / digits / dashes only'
    if (!form.displayName.trim()) return 'display name is required'
    for (const f of authFields) {
      if (f.required && !form.authValues[f.key]) return `${f.label} is required`
    }
    return null
  }

  /** Build the providerConfig with the FedRAMP origin discriminator derived. */
  const buildProviderConfig = (): Record<string, unknown> => {
    const providerConfig: Record<string, unknown> = { ...form.providerConfig }
    providerConfig.origin = deriveOrigin({
      providerType: form.providerType,
      auth: form.authValues,
      existingOrigin: providerConfig.origin as Record<string, string | undefined> | undefined,
      hostStr: String(
        (providerConfig.host as string) ??
          (providerConfig.baseUrl as string) ??
          (providerConfig.endpoint as string) ??
          form.authValues.endpoint ??
          '',
      ),
      providerName: form.name,
    })
    return providerConfig
  }

  const handleTest = async () => {
    setTesting(true)
    setTest(null)
    setErr(null)
    try {
      const t0 = Date.now()
      let res: Response
      if (isEdit) {
        // Saved provider → re-probe by name.
        res = await apiRequest(
          `/api/admin/llm-providers/${encodeURIComponent(editing!.name)}/test`,
          { method: 'POST', body: JSON.stringify({}) },
        )
      } else {
        // Unsaved form data → test-config (never touches the DB).
        res = await apiRequest('/api/admin/llm-providers/test-config', {
          method: 'POST',
          body: JSON.stringify({
            providerType: form.providerType,
            name: form.name.trim() || 'unsaved',
            authConfig: form.authValues,
            providerConfig: buildProviderConfig(),
            prompt: 'Say "Hello, World!" and nothing else.',
          }),
        })
      }
      const body = await res.json().catch(() => ({}))
      const latency = Date.now() - t0
      const ok =
        res.ok &&
        (body.success !== false) &&
        (body.healthy !== false) &&
        !body.error
      setTest({
        ok,
        latency,
        message: ok
          ? `reachable — ${body.response ? String(body.response).slice(0, 120) : 'health probe passed'}`
          : `${body.error ?? body.message ?? `HTTP ${res.status}`}`,
        raw: body,
      })
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'network error' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const v = validate()
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    setConflict(null)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        providerType: form.providerType,
        priority: form.priority,
        enabled: form.enabled,
        description: form.description.trim() || undefined,
        authConfig: form.authValues,
        providerConfig: buildProviderConfig(),
        capabilities: form.capabilities,
      }
      const url = isEdit
        ? `/api/admin/llm-providers/${editing!.id}`
        : '/api/admin/llm-providers'
      if (isEdit) {
        payload.version = (editing as unknown as { version?: number }).version ?? 1
      }
      const res = await apiRequest(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      if (res.status === 409) {
        const d = (await res.json().catch(() => ({}))) as {
          conflictingFields?: string[]
        }
        setConflict(Array.isArray(d.conflictingFields) ? d.conflictingFields : [])
        setErr(
          'another admin saved this provider before your changes landed — close and reopen to reload the current row, then re-apply your edits.',
        )
        notify?.('err', 'concurrent edit — reload before retrying')
        return
      }
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        let parsed: { message?: string; error?: string } | undefined
        try {
          parsed = JSON.parse(t)
        } catch {
          /* not JSON */
        }
        setErr((parsed?.message || parsed?.error || t || `HTTP ${res.status}`).slice(0, 260))
        return
      }
      notify?.('ok', `provider "${form.displayName.trim()}" ${isEdit ? 'updated' : 'created'}`)
      invalidate(['llm-providers'])
      invalidate(['provider-health'])
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-registry', 'enabled'])
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setErr(null)
    try {
      const res = await apiRequest(
        `/api/admin/llm-providers/${editing!.id}?force=true`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        const t = await res.text().catch(() => res.statusText)
        setErr(`delete failed: ${t.slice(0, 220)}`)
        return
      }
      notify?.('ok', `provider "${editing!.displayName ?? editing!.name}" removed`)
      invalidate(['llm-providers'])
      invalidate(['provider-health'])
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setDeleting(false)
    }
  }

  const busy = saving || testing || deleting

  return (
    <ModalShell
      title={isEdit ? `Edit provider · ${editing!.displayName ?? editing!.name}` : 'Add provider'}
      sub={
        isEdit
          ? `${editing!.type} · id ${editing!.id.slice(0, 8)} · optimistic-concurrency on save`
          : 'POST /api/admin/llm-providers — full per-type auth + SDK config'
      }
      width={620}
      onClose={onClose}
      footer={
        <>
          {isEdit &&
            (confirmDelete ? (
              <>
                <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--err)' }}>
                  delete this provider? (soft-delete, force)
                </span>
                <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  keep
                </Btn>
                <Btn variant="danger" size="sm" disabled={busy} onClick={handleDelete}>
                  {deleting ? 'deleting…' : 'confirm delete'}
                </Btn>
              </>
            ) : (
              <Btn
                variant="danger"
                size="sm"
                disabled={busy}
                style={{ marginRight: 'auto' }}
                onClick={() => setConfirmDelete(true)}
              >
                delete
              </Btn>
            ))}
          <Btn variant="ghost" disabled={busy} onClick={handleTest}>
            {testing ? 'testing…' : 'test connection'}
          </Btn>
          <Btn variant="ghost" disabled={busy} onClick={onClose}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={busy} onClick={handleSave}>
            {saving ? 'saving…' : isEdit ? 'save changes' : 'create provider'}
          </Btn>
        </>
      }
    >
      {err && (
        <Banner tone="err">
          {err}
          {conflict && conflict.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11 }}>
              conflicting fields: {conflict.join(', ')}
            </div>
          )}
        </Banner>
      )}
      {test && (
        <Banner tone={test.ok ? 'ok' : 'err'}>
          <b>{test.ok ? 'connection ok' : 'connection failed'}</b>
          {test.latency != null ? ` · ${test.latency}ms` : ''} — {test.message}
        </Banner>
      )}

      {/* ── Identity ── */}
      <div style={sectionHeadStyle}>Identity</div>
      <Field label="Name" desc="lowercase id used in URLs and audit logs · cannot change after create" required>
        <input
          type="text"
          value={form.name}
          disabled={isEdit}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
          placeholder="e.g. azure-prod-eastus"
        />
      </Field>
      <Field label="Display name" desc="shown in operator UI" required>
        <input
          type="text"
          value={form.displayName}
          onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
          style={inputStyle}
          placeholder="e.g. Azure OpenAI (East US)"
        />
      </Field>
      <Field label="Provider type" desc="determines the auth + SDK config schema · cannot change after create">
        <select
          value={form.providerType}
          disabled={isEdit}
          onChange={(e) =>
            setForm((s) => ({
              ...s,
              providerType: e.target.value as ProviderType,
              authMode: 'api-key',
              authValues: {},
              providerConfig: {},
            }))
          }
          style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
        >
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROVIDER_META[t]?.label ?? t}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Priority" desc="lower = preferred (0–100)">
          <input
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) }))}
            style={inputStyle}
          />
        </Field>
        <Field label="Enabled" desc="chat routes to it when on">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
            />
            <Pill tone={form.enabled ? 'ok' : 'muted'} dot>
              {form.enabled ? 'on' : 'off'}
            </Pill>
          </label>
        </Field>
      </div>
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          style={textareaStyle}
          placeholder="optional notes"
        />
      </Field>

      {/* ── Capabilities ── */}
      <div style={sectionHeadStyle}>Capabilities</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        {CAP_KEYS.map((c) => (
          <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={form.capabilities[c]}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  capabilities: { ...s.capabilities, [c]: e.target.checked },
                }))
              }
            />
            <span style={{ color: 'var(--fg-1)' }}>{c}</span>
          </label>
        ))}
      </div>

      {/* ── Authentication (per-type; azure dual-mode) ── */}
      <div style={sectionHeadStyle}>
        Authentication
        {meta?.authModes ? ' · ' + form.authMode : ''}
      </div>
      {meta?.authModes && (
        <Field label="Auth mode" desc="API Key uses a static key · Entra-ID uses an AAD app-registration (tenant/client/secret)">
          <select
            value={form.authMode}
            onChange={(e) =>
              setForm((s) => ({ ...s, authMode: e.target.value as AuthMode, authValues: {} }))
            }
            style={inputStyle}
          >
            {Object.keys(meta.authModes).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      )}
      {authFields.map((f) => (
        <Field key={f.key} label={f.label} desc={`auth_config.${f.key}`} required={f.required}>
          {f.type === 'textarea' ? (
            <textarea
              value={form.authValues[f.key] ?? ''}
              onChange={(e) => setAuthVal(f.key, e.target.value)}
              style={textareaStyle}
              placeholder={f.placeholder}
            />
          ) : (
            <input
              type={f.type === 'password' ? 'password' : 'text'}
              value={form.authValues[f.key] ?? ''}
              onChange={(e) => setAuthVal(f.key, e.target.value)}
              style={inputStyle}
              placeholder={f.placeholder}
              autoComplete="off"
            />
          )}
        </Field>
      ))}

      {/* ── Provider settings (SDK-exposed knobs) ── */}
      {providerConfigFields.length > 0 && (
        <>
          <div style={sectionHeadStyle}>Provider settings</div>
          {providerConfigFields.map((f) => {
            const cur = form.providerConfig[f.key]
            return (
              <Field key={f.key} label={f.label} desc={f.help ?? `provider_config.${f.key}`}>
                {f.type === 'toggle' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 28 }}>
                    <input
                      type="checkbox"
                      checked={cur != null ? !!cur : !!f.default}
                      onChange={(e) => setConfigVal(f.key, e.target.checked)}
                    />
                    <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                      {(cur != null ? !!cur : !!f.default) ? 'enabled' : 'disabled'}
                    </span>
                  </label>
                ) : f.type === 'select' && f.options ? (
                  <select
                    value={String(cur ?? f.default ?? '')}
                    onChange={(e) => setConfigVal(f.key, e.target.value)}
                    style={inputStyle}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'number' ? (
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={Number(cur ?? f.default ?? 0)}
                    onChange={(e) => setConfigVal(f.key, Number(e.target.value))}
                    style={inputStyle}
                  />
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={String(cur ?? f.default ?? '')}
                    onChange={(e) => setConfigVal(f.key, e.target.value)}
                    style={textareaStyle}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <input
                    type={f.type === 'password' ? 'password' : 'text'}
                    value={String(cur ?? f.default ?? '')}
                    onChange={(e) => setConfigVal(f.key, e.target.value)}
                    style={inputStyle}
                    placeholder={f.placeholder}
                  />
                )}
              </Field>
            )
          })}
        </>
      )}
    </ModalShell>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * ModelModal — create / edit a model registry row.
 *   edit  → PATCH /registry/:id  (role/priority/enabled/temperature/
 *           max_tokens/functionCallingAccuracy) + PUT /:providerId/models/
 *           :modelId for displayName/capabilities/config when present.
 *   create→ PUT /:providerId/models/:modelId (upsert the model on a provider).
 *   delete→ DELETE /registry/:id.
 * ════════════════════════════════════════════════════════════════════════ */
const MODEL_ROLES = [
  'chat',
  'code',
  'embedding',
  'embeddings',
  'reasoning',
  'tool_execution',
  'synthesis',
  'vision',
  'imageGen',
  'compaction',
  'fallback',
]

/**
 * The full settable ModelRoleAssignment field set. Numeric/decimal fields are
 * held as strings so "" means "clear / inherit default" and is parsed on save;
 * the API coerces + validates each one.
 */
interface ModelFormState {
  // ── Assignment ──
  role: string
  provider: string
  model: string
  priority: number
  enabled: boolean
  sliderMin: string // slider_min_position (0..100)
  sliderMax: string // slider_max_position (0..100)
  // ── Inference ──
  temperature: string
  maxTokens: string // max_tokens (output cap)
  thinkingBudget: string // thinking_budget (tokens)
  fca: string // function_calling_accuracy 0..1
  // ── Pricing (USD; registry stores per-1M, dialog passes the value through) ──
  costRequest: string // cost_per_request
  costInput: string // cost_per_input_token_usd
  costOutput: string // cost_per_output_token_usd
  costCacheRead: string // cost_per_cache_read_usd
  costCacheWrite: string // cost_per_cache_write_usd
  costThinking: string // cost_per_thinking_token_usd
  costEmbedding: string // cost_per_embedding_token_usd
  pricingSource: string // pricing_source enum ('' = unset)
  // ── Capabilities (full flag set) ──
  capabilities: Record<ModelCapKey, boolean>
  // ── Meta ──
  description: string
  options: string // options JSON (textarea)
  // server-managed; shown read-only with a deprecate/restore affordance.
  state: string
}

function blankModel(defaultProvider: string): ModelFormState {
  return {
    role: 'chat',
    provider: defaultProvider,
    model: '',
    priority: 50,
    enabled: true,
    sliderMin: '',
    sliderMax: '',
    temperature: '',
    maxTokens: '',
    thinkingBudget: '',
    fca: '',
    costRequest: '',
    costInput: '',
    costOutput: '',
    costCacheRead: '',
    costCacheWrite: '',
    costThinking: '',
    costEmbedding: '',
    pricingSource: '',
    capabilities: {
      chat: true,
      tools: false,
      streaming: true,
      vision: false,
      thinking: false,
      embeddings: false,
      imageGeneration: false,
      nativeToolCalling: false,
    },
    description: '',
    options: '',
    state: 'active',
  }
}

function modelFromRow(r: LlmRegistryRow): ModelFormState {
  const raw = r as unknown as Record<string, unknown>
  const caps = (r.capabilities ?? {}) as Record<string, boolean>
  const num = (v: unknown): string => (typeof v === 'number' ? String(v) : '')
  // a registry value may arrive under the snake or camel name depending on caller.
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (raw[k] != null) return raw[k]
    return undefined
  }
  const optionsObj = raw.options
  return {
    role: r.role ?? 'chat',
    provider: r.provider ?? '',
    model: r.model ?? '',
    priority: r.priority ?? 50,
    enabled: r.enabled !== false,
    sliderMin: num(pick('slider_min_position', 'sliderMinPosition')),
    sliderMax: num(pick('slider_max_position', 'sliderMaxPosition')),
    temperature: num(pick('temperature')),
    maxTokens: num(pick('max_tokens', 'maxTokens')),
    thinkingBudget: num(pick('thinking_budget', 'thinkingBudget')),
    fca: num(r.functionCallingAccuracy ?? pick('function_calling_accuracy')),
    costRequest: num(pick('cost_per_request', 'costPerRequest')),
    costInput: num(pick('cost_per_input_token_usd', 'costPerInputTokenUsd')),
    costOutput: num(pick('cost_per_output_token_usd', 'costPerOutputTokenUsd')),
    costCacheRead: num(pick('cost_per_cache_read_usd', 'costPerCacheReadUsd')),
    costCacheWrite: num(pick('cost_per_cache_write_usd', 'costPerCacheWriteUsd')),
    costThinking: num(pick('cost_per_thinking_token_usd', 'costPerThinkingTokenUsd')),
    costEmbedding: num(pick('cost_per_embedding_token_usd', 'costPerEmbeddingTokenUsd')),
    pricingSource: typeof pick('pricing_source', 'pricingSource') === 'string' ? String(pick('pricing_source', 'pricingSource')) : '',
    capabilities: {
      chat: caps.chat ?? true,
      tools: caps.tools ?? false,
      streaming: caps.streaming ?? true,
      vision: caps.vision ?? false,
      thinking: caps.thinking ?? false,
      embeddings: caps.embeddings ?? false,
      imageGeneration: caps.imageGeneration ?? false,
      nativeToolCalling: caps.nativeToolCalling ?? false,
    },
    description: typeof r.description === 'string' ? r.description : '',
    options:
      optionsObj && typeof optionsObj === 'object' && Object.keys(optionsObj as object).length > 0
        ? JSON.stringify(optionsObj, null, 2)
        : '',
    state: typeof raw.state === 'string' ? String(raw.state) : 'active',
  }
}

export function ModelModal({
  editing,
  defaultProvider,
  onClose,
  notify,
}: {
  editing: LlmRegistryRow | null
  defaultProvider?: string
  onClose: () => void
  notify?: NotifyFn
}) {
  const invalidate = useAdminInvalidate()
  const providers = useLlmProviders()
  const isEdit = editing != null
  const [form, setForm] = React.useState<ModelFormState>(() =>
    editing ? modelFromRow(editing) : blankModel(defaultProvider ?? ''),
  )
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [discovering, setDiscovering] = React.useState(false)
  const [discovered, setDiscovered] = React.useState<string[] | null>(null)

  const providerRows = providers.data?.providers ?? []
  const providerNames = providerRows.map((p) => p.name)
  // a provider id is needed to PUT a model; resolve from the chosen name.
  const providerId = React.useMemo(
    () => providerRows.find((p) => p.name === form.provider)?.id ?? form.provider,
    [providerRows, form.provider],
  )

  const numOrNull = (s: string): number | null => {
    const t = s.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const handleDiscover = async () => {
    if (!form.provider) {
      setErr('select a provider first, then discover its models')
      return
    }
    setDiscovering(true)
    setErr(null)
    try {
      const res = await apiRequest(
        `/api/admin/llm-providers/${encodeURIComponent(form.provider)}/discover-models`,
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(`discover failed: ${body.error ?? body.message ?? `HTTP ${res.status}`}`)
        return
      }
      const list = (body.models ?? body.discovered ?? body) as unknown
      const names: string[] = Array.isArray(list)
        ? list
            .map((m) => (typeof m === 'string' ? m : (m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name))
            .filter((x): x is string => typeof x === 'string')
        : []
      setDiscovered(names)
      if (names.length === 0) setErr('provider returned no discoverable models')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'discover error')
    } finally {
      setDiscovering(false)
    }
  }

  const validate = (): string | null => {
    if (!form.provider.trim()) return 'provider is required'
    if (!form.model.trim()) return 'model id is required'
    if (!form.role.trim()) return 'role is required'
    const fca = numOrNull(form.fca)
    if (fca != null && (fca < 0 || fca > 1)) return 'FCA must be between 0 and 1'
    const temp = numOrNull(form.temperature)
    if (temp != null && (temp < 0 || temp > 2)) return 'temperature must be between 0 and 2'
    const sMin = numOrNull(form.sliderMin)
    const sMax = numOrNull(form.sliderMax)
    if (sMin != null && (sMin < 0 || sMin > 100)) return 'slider min must be between 0 and 100'
    if (sMax != null && (sMax < 0 || sMax > 100)) return 'slider max must be between 0 and 100'
    if (sMin != null && sMax != null && sMin > sMax) return 'slider min must be ≤ slider max'
    // options must be valid JSON when provided.
    if (form.options.trim()) {
      try {
        const o = JSON.parse(form.options)
        if (o == null || typeof o !== 'object' || Array.isArray(o)) return 'options must be a JSON object'
      } catch {
        return 'options must be valid JSON'
      }
    }
    return null
  }

  /**
   * Build the FULL settable-field payload. Sent flat (snake_case) to BOTH the
   * model PUT (create + edit upsert) and the registry PATCH (edit), which both
   * route through the API's buildRegistryWriteData whitelist. Only keys with a
   * meaningful value are included — a blank numeric clears (null) the column on
   * EDIT but is omitted entirely on CREATE so defaults apply.
   */
  const buildFullBody = (): Record<string, unknown> => {
    const optionsParsed = form.options.trim()
      ? (JSON.parse(form.options) as Record<string, unknown>)
      : undefined
    // For edit, blank → null (explicit clear). For create, blank → omit.
    const numField = (s: string): number | null | undefined => {
      const n = numOrNull(s)
      if (n != null) return n
      return isEdit ? null : undefined
    }
    const body: Record<string, unknown> = {
      role: form.role,
      priority: form.priority,
      enabled: form.enabled,
      capabilities: form.capabilities,
      description: form.description.trim() || (isEdit ? '' : undefined),
      slider_min_position: numField(form.sliderMin),
      slider_max_position: numField(form.sliderMax),
      temperature: numField(form.temperature),
      max_tokens: numField(form.maxTokens),
      thinking_budget: numField(form.thinkingBudget),
      functionCallingAccuracy: numField(form.fca),
      cost_per_request: numField(form.costRequest),
      cost_per_input_token_usd: numField(form.costInput),
      cost_per_output_token_usd: numField(form.costOutput),
      cost_per_cache_read_usd: numField(form.costCacheRead),
      cost_per_cache_write_usd: numField(form.costCacheWrite),
      cost_per_thinking_token_usd: numField(form.costThinking),
      cost_per_embedding_token_usd: numField(form.costEmbedding),
      pricing_source: form.pricingSource || (isEdit ? null : undefined),
      options: optionsParsed ?? (isEdit ? {} : undefined),
      // legacy aliases the model PUT still understands.
      displayName: form.description.trim() || undefined,
      config: {
        roles: [form.role],
        enabled: form.enabled,
        temperature: numOrNull(form.temperature) ?? undefined,
        maxOutputTokens: numOrNull(form.maxTokens) ?? undefined,
      },
    }
    // strip undefined so create-path omits unset fields.
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
    return body
  }

  const handleSave = async () => {
    const v = validate()
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const fullBody = buildFullBody()

      // 1) Model PUT — the canonical write. On CREATE it now creates the
      //    registry row with the full field set (create-on-PUT); on EDIT it
      //    upserts the same field set onto the existing row.
      const putRes = await apiRequest(
        `/api/admin/llm-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(
          form.model.trim(),
        )}`,
        { method: 'PUT', body: JSON.stringify(fullBody) },
      )
      // On CREATE the PUT is authoritative — a failure is fatal. On EDIT a 404
      // can mean the model lives only as a registry row with no provider model
      // record; the registry PATCH below is then the authoritative write.
      if (!putRes.ok && !(isEdit && putRes.status === 404)) {
        const t = await putRes.text().catch(() => putRes.statusText)
        setErr(`model ${isEdit ? 'update' : 'create'} failed: ${t.slice(0, 220)}`)
        return
      }

      // 2) On EDIT, also PATCH the registry row directly so every settable
      //    field persists even when the provider has no model record (the
      //    registry is the routing SoT).
      if (isEdit && editing) {
        const patchRes = await apiRequest(
          `/api/admin/llm-providers/registry/${encodeURIComponent(editing.id)}`,
          { method: 'PATCH', body: JSON.stringify(fullBody) },
        )
        if (!patchRes.ok) {
          const t = await patchRes.text().catch(() => patchRes.statusText)
          setErr(`registry update failed: ${t.slice(0, 220)}`)
          return
        }
      }

      notify?.('ok', `model "${form.model.trim()}" ${isEdit ? 'updated' : 'created'}`)
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-registry', 'enabled'])
      invalidate(['llm-providers'])
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  /** Deprecate / restore the row's lifecycle state (server-managed column). */
  const handleStateChange = async (nextState: 'deprecated' | 'active') => {
    if (!editing) return
    setSaving(true)
    setErr(null)
    try {
      const res = await apiRequest(
        `/api/admin/llm-providers/registry/${encodeURIComponent(editing.id)}`,
        { method: 'PATCH', body: JSON.stringify({ state: nextState }) },
      )
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        setErr(`state change failed: ${t.slice(0, 220)}`)
        return
      }
      setForm((s) => ({ ...s, state: nextState }))
      notify?.('ok', `model "${editing.model}" ${nextState === 'deprecated' ? 'deprecated' : 'restored to active'}`)
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-registry', 'enabled'])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editing) return
    setDeleting(true)
    setErr(null)
    try {
      const res = await apiRequest(
        `/api/admin/llm-providers/registry/${encodeURIComponent(editing.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        const t = await res.text().catch(() => res.statusText)
        setErr(`delete failed: ${t.slice(0, 220)}`)
        return
      }
      notify?.('ok', `model "${editing.model}" removed from registry`)
      invalidate(['llm-registry', 'all'])
      invalidate(['llm-registry', 'enabled'])
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setDeleting(false)
    }
  }

  const busy = saving || deleting || discovering

  return (
    <ModalShell
      title={isEdit ? `Edit model · ${editing!.model}` : 'Add model'}
      sub={
        isEdit
          ? `registry row ${editing!.id.slice(0, 8)} · full field set · PATCH /registry/:id + PUT model config`
          : 'PUT /:providerId/models/:modelId — register a model with the full settable field set'
      }
      width={620}
      onClose={onClose}
      footer={
        <>
          {isEdit &&
            (confirmDelete ? (
              <>
                <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--err)' }}>
                  remove this model from the registry?
                </span>
                <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  keep
                </Btn>
                <Btn variant="danger" size="sm" disabled={busy} onClick={handleDelete}>
                  {deleting ? 'deleting…' : 'confirm delete'}
                </Btn>
              </>
            ) : (
              <Btn
                variant="danger"
                size="sm"
                disabled={busy}
                style={{ marginRight: 'auto' }}
                onClick={() => setConfirmDelete(true)}
              >
                delete
              </Btn>
            ))}
          <Btn variant="ghost" disabled={busy} onClick={onClose}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={busy} onClick={handleSave}>
            {saving ? 'saving…' : isEdit ? 'save changes' : 'create model'}
          </Btn>
        </>
      }
    >
      {err && <Banner tone="err">{err}</Banner>}

      <div style={sectionHeadStyle}>Assignment</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Provider" desc="which provider serves this model" required>
          <select
            value={form.provider}
            disabled={isEdit}
            onChange={(e) => setForm((s) => ({ ...s, provider: e.target.value }))}
            style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
          >
            <option value="">— select —</option>
            {providerNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role" desc="router role this model serves" required>
          <select
            value={form.role}
            onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
            style={inputStyle}
          >
            {MODEL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Model id"
        desc={isEdit ? 'immutable for an existing registry row' : 'the provider-native model id · use discover to list'}
        required
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={form.model}
            disabled={isEdit}
            onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))}
            style={{ ...inputStyle, opacity: isEdit ? 0.6 : 1 }}
            placeholder="e.g. gpt-oss:20b, claude-sonnet-4, gemini-2.0-flash"
            list="aw-discovered-models"
          />
          {!isEdit && (
            <Btn variant="ghost" size="sm" disabled={busy || !form.provider} onClick={handleDiscover}>
              {discovering ? 'discovering…' : 'discover'}
            </Btn>
          )}
        </div>
        {discovered && discovered.length > 0 && (
          <>
            <datalist id="aw-discovered-models">
              {discovered.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {discovered.slice(0, 24).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="awc-tag"
                  style={{ cursor: 'pointer', border: 'none' }}
                  onClick={() => setForm((s) => ({ ...s, model: m }))}
                >
                  {m}
                </button>
              ))}
            </div>
          </>
        )}
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Priority" desc="lower = preferred (0–100)">
          <input
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={(e) => setForm((s) => ({ ...s, priority: Number(e.target.value) }))}
            style={inputStyle}
          />
        </Field>
        <Field label="Enabled" desc="part of the routing pool when on">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))}
            />
            <Pill tone={form.enabled ? 'ok' : 'muted'} dot>
              {form.enabled ? 'on' : 'off'}
            </Pill>
          </label>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Slider min position" desc="slider_min_position · lowest complexity slot (0–100) · blank = 0">
          <input
            type="number"
            min={0}
            max={100}
            value={form.sliderMin}
            onChange={(e) => setForm((s) => ({ ...s, sliderMin: e.target.value }))}
            style={inputStyle}
            placeholder="0"
          />
        </Field>
        <Field label="Slider max position" desc="slider_max_position · highest complexity slot (0–100) · blank = 100">
          <input
            type="number"
            min={0}
            max={100}
            value={form.sliderMax}
            onChange={(e) => setForm((s) => ({ ...s, sliderMax: e.target.value }))}
            style={inputStyle}
            placeholder="100"
          />
        </Field>
      </div>

      <div style={sectionHeadStyle}>Inference defaults</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Temperature" desc="blank = provider default (0–2)">
          <input
            type="number"
            step={0.05}
            min={0}
            max={2}
            value={form.temperature}
            onChange={(e) => setForm((s) => ({ ...s, temperature: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
        <Field label="Max output tokens" desc="max_tokens · output cap · blank = default">
          <input
            type="number"
            min={1}
            value={form.maxTokens}
            onChange={(e) => setForm((s) => ({ ...s, maxTokens: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Thinking budget" desc="thinking_budget · extended-thinking token budget · blank = none">
          <input
            type="number"
            min={0}
            value={form.thinkingBudget}
            onChange={(e) => setForm((s) => ({ ...s, thinkingBudget: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
        <Field label="FCA (0–1)" desc="function_calling_accuracy floor">
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={form.fca}
            onChange={(e) => setForm((s) => ({ ...s, fca: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <div style={descStyle}>
        Context window (max input tokens) is resolved live from provider
        discovery + the capability registry — it is not a registry column, so
        it is shown read-only in the catalog rather than set here.
      </div>

      <div style={sectionHeadStyle}>Capabilities</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {MODEL_CAP_KEYS.map((c) => (
          <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={form.capabilities[c]}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  capabilities: { ...s.capabilities, [c]: e.target.checked },
                }))
              }
            />
            <span style={{ color: 'var(--fg-1)' }}>{c}</span>
          </label>
        ))}
      </div>

      <div style={sectionHeadStyle}>Pricing (USD)</div>
      <Field label="Pricing source" desc="pricing_source · how the rates below were obtained">
        <select
          value={form.pricingSource}
          onChange={(e) => setForm((s) => ({ ...s, pricingSource: e.target.value }))}
          style={inputStyle}
        >
          <option value="">— unset —</option>
          {PRICING_SOURCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Cost / input" desc="cost_per_input_token_usd · blank = local/free">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costInput}
            onChange={(e) => setForm((s) => ({ ...s, costInput: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
        <Field label="Cost / output" desc="cost_per_output_token_usd">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costOutput}
            onChange={(e) => setForm((s) => ({ ...s, costOutput: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Cost / cache read" desc="cost_per_cache_read_usd">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costCacheRead}
            onChange={(e) => setForm((s) => ({ ...s, costCacheRead: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
        <Field label="Cost / cache write" desc="cost_per_cache_write_usd">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costCacheWrite}
            onChange={(e) => setForm((s) => ({ ...s, costCacheWrite: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Cost / thinking token" desc="cost_per_thinking_token_usd">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costThinking}
            onChange={(e) => setForm((s) => ({ ...s, costThinking: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
        <Field label="Cost / embedding token" desc="cost_per_embedding_token_usd">
          <input
            type="number"
            step={0.0000001}
            min={0}
            value={form.costEmbedding}
            onChange={(e) => setForm((s) => ({ ...s, costEmbedding: e.target.value }))}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <Field label="Cost / request" desc="cost_per_request · flat estimated cost per call · blank = derived from tokens">
        <input
          type="number"
          step={0.000001}
          min={0}
          value={form.costRequest}
          onChange={(e) => setForm((s) => ({ ...s, costRequest: e.target.value }))}
          style={inputStyle}
          placeholder="—"
        />
      </Field>

      <div style={sectionHeadStyle}>Metadata</div>
      <Field label="Description" desc="operator-facing note (maps to displayName on the provider model record)">
        <textarea
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          style={textareaStyle}
          placeholder="optional"
        />
      </Field>
      <Field label="Options (JSON)" desc="options · role-specific knobs · must be a JSON object">
        <textarea
          value={form.options}
          onChange={(e) => setForm((s) => ({ ...s, options: e.target.value }))}
          style={{ ...textareaStyle, fontFamily: 'var(--font-v3-mono, ui-monospace, monospace)' }}
          placeholder={'{\n  "auto": false\n}'}
          spellCheck={false}
        />
      </Field>
      {isEdit && (
        <Field label="Lifecycle state" desc="state · server-managed (RegistryRowState) · deprecate/restore below">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30 }}>
            <Pill tone={form.state === 'active' ? 'ok' : form.state === 'deprecated' ? 'warn' : 'muted'} dot>
              {form.state}
            </Pill>
            {form.state !== 'deprecated' && form.state !== 'disposed' && (
              <Btn variant="ghost" size="sm" disabled={busy} onClick={() => handleStateChange('deprecated')}>
                deprecate
              </Btn>
            )}
            {form.state === 'deprecated' && (
              <Btn variant="ghost" size="sm" disabled={busy} onClick={() => handleStateChange('active')}>
                restore to active
              </Btn>
            )}
          </div>
        </Field>
      )}
    </ModalShell>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * ModelSandbox — playground. provider+model picker, prompts, knobs, Run.
 * ════════════════════════════════════════════════════════════════════════ */
interface PlaygroundResult {
  success?: boolean
  response?: string
  thinking?: string | null
  usage?: { prompt?: number; completion?: number; total?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  latency?: number
  error?: string
  message?: string
}

export function ModelSandbox({
  initialProvider,
  initialModel,
  onClose,
  notify,
}: {
  initialProvider?: string
  initialModel?: string
  onClose: () => void
  notify?: NotifyFn
}) {
  const providers = useLlmProviders()
  const registry = useLlmRegistry(false)
  const providerRows = providers.data?.providers ?? []
  const regRows = registry.data ?? []

  const [provider, setProvider] = React.useState(initialProvider ?? '')
  const [model, setModel] = React.useState(initialModel ?? '')
  const [systemPrompt, setSystemPrompt] = React.useState('')
  const [prompt, setPrompt] = React.useState('Say "Hello, World!" and nothing else.')
  const [temperature, setTemperature] = React.useState('0.7')
  const [maxTokens, setMaxTokens] = React.useState('1024')
  const [topP, setTopP] = React.useState('')
  const [stream, setStream] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<PlaygroundResult | null>(null)
  const [err, setErr] = React.useState<string | null>(null)

  // models available for the chosen provider (from the registry).
  const modelsForProvider = React.useMemo(
    () =>
      Array.from(
        new Set(regRows.filter((r) => !provider || r.provider === provider).map((r) => r.model)),
      ),
    [regRows, provider],
  )
  // pricing lookup for cost estimate.
  const priceOf = React.useMemo(() => {
    const m = new Map<string, { in: number; out: number }>()
    for (const r of regRows) {
      const raw = r as unknown as Record<string, unknown>
      const ci = (raw.cost_per_input_token_usd ?? raw.costPerInputTokenUsd) as number | undefined
      const co = (raw.cost_per_output_token_usd ?? raw.costPerOutputTokenUsd) as number | undefined
      if (ci != null || co != null) m.set(r.model, { in: ci ?? 0, out: co ?? 0 })
    }
    return m
  }, [regRows])

  const num = (s: string): number | undefined => {
    const t = s.trim()
    if (t === '') return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }

  const handleRun = async () => {
    if (!provider) {
      setErr('select a provider')
      return
    }
    if (!model) {
      setErr('select or enter a model')
      return
    }
    if (!prompt.trim()) {
      setErr('enter a user prompt')
      return
    }
    setRunning(true)
    setErr(null)
    setResult(null)
    try {
      const res = await apiRequest('/api/admin/llm-providers/playground', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          model,
          testType: 'chat',
          config: {
            temperature: num(temperature),
            maxTokens: num(maxTokens),
            topP: num(topP),
            stream,
          },
          input: {
            prompt,
            systemPrompt: systemPrompt.trim() || undefined,
          },
        }),
      })
      const body = (await res.json().catch(() => ({}))) as PlaygroundResult
      if (!res.ok || body.success === false) {
        setErr(body.error ?? body.message ?? `playground failed — HTTP ${res.status}`)
        setResult(body)
        return
      }
      setResult(body)
      notify?.('ok', `playground ran on ${model} (${body.latency ?? '—'}ms)`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setRunning(false)
    }
  }

  const usage = result?.usage
  const promptTok = usage?.prompt ?? usage?.prompt_tokens
  const compTok = usage?.completion ?? usage?.completion_tokens
  const totalTok = usage?.total ?? usage?.total_tokens
  const price = priceOf.get(model)
  const estCost =
    price && (promptTok != null || compTok != null)
      ? (promptTok ?? 0) * price.in + (compTok ?? 0) * price.out
      : null

  return (
    <ModalShell
      title="Model sandbox"
      sub="POST /api/admin/llm-providers/playground · testType chat · live model call"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" disabled={running} onClick={onClose}>
            close
          </Btn>
          <Btn variant="primary" disabled={running} onClick={handleRun}>
            {running ? 'running…' : 'run ▷'}
          </Btn>
        </>
      }
    >
      {err && <Banner tone="err">{err}</Banner>}

      <div style={sectionHeadStyle}>Target</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Provider" required>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value)
              setModel('')
            }}
            style={inputStyle}
          >
            <option value="">— select —</option>
            {providerRows.map((p) => (
              <option key={p.id} value={p.name}>
                {p.displayName ?? p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model" desc="from the registry, or type a model id" required>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={inputStyle}
            placeholder="model id"
            list="aw-sandbox-models"
          />
          <datalist id="aw-sandbox-models">
            {modelsForProvider.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
      </div>

      <div style={sectionHeadStyle}>Prompt</div>
      <Field label="System prompt" desc="optional">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          style={textareaStyle}
          placeholder="optional system prompt"
        />
      </Field>
      <Field label="User prompt" required>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ ...textareaStyle, minHeight: 90 }}
        />
      </Field>

      <div style={sectionHeadStyle}>Config</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="Temperature">
          <input
            type="number"
            step={0.05}
            min={0}
            max={2}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Max tokens">
          <input
            type="number"
            min={1}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="top_p" desc="blank = default">
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={topP}
            onChange={(e) => setTopP(e.target.value)}
            style={inputStyle}
            placeholder="—"
          />
        </Field>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>
        <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
        <span style={{ color: 'var(--fg-1)' }}>stream</span>
      </label>

      {result && (
        <>
          <div style={sectionHeadStyle}>Result</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <Pill tone={result.success !== false && !result.error ? 'ok' : 'err'} dot>
              {result.success !== false && !result.error ? 'ok' : 'failed'}
            </Pill>
            <Tag>latency {result.latency != null ? `${result.latency}ms` : '—'}</Tag>
            <Tag>prompt {promptTok ?? '—'} tok</Tag>
            <Tag>completion {compTok ?? '—'} tok</Tag>
            <Tag>total {totalTok ?? '—'} tok</Tag>
            <Tag>cost {estCost != null ? `$${estCost.toFixed(6)}` : '—'}</Tag>
          </div>
          {result.thinking && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--fg-2)' }}>
                thinking
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 11,
                  color: 'var(--fg-2)',
                  background: 'var(--bg-0)',
                  border: '1px solid var(--line-1)',
                  borderRadius: 6,
                  padding: 10,
                  margin: '6px 0 0',
                  maxHeight: 180,
                  overflow: 'auto',
                }}
              >
                {asText(result.thinking)}
              </pre>
            </details>
          )}
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12.5,
              color: 'var(--fg-0)',
              background: 'var(--bg-0)',
              border: '1px solid var(--line-1)',
              borderRadius: 8,
              padding: 12,
              margin: 0,
              maxHeight: 280,
              overflow: 'auto',
            }}
          >
            {result.response ? asText(result.response) : result.error ?? '(empty response)'}
          </pre>
        </>
      )}
    </ModalShell>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * ProviderAuditFeed — scoped change feed (chain-of-custody) for providers.
 *   GET /api/admin/audit-logs?resourceType=LLMProvider&limit=50
 * ════════════════════════════════════════════════════════════════════════ */
interface AuditLog {
  id: string
  userName?: string
  userEmail?: string
  action?: string
  resourceType?: string
  resourceId?: string
  success?: boolean
  timestamp: string
}
interface AuditResponse {
  success?: boolean
  logs?: AuditLog[]
}

function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return String(ts).slice(0, 16)
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ProviderAuditFeed({ limit = 50 }: { limit?: number }) {
  const q = useAdminQuery<AuditResponse>(
    ['audit-logs', 'LLMProvider', String(limit)],
    `/api/admin/audit-logs?resourceType=LLMProvider&limit=${limit}`,
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const logs = q.data?.logs ?? []

  if (q.isError) {
    return (
      <Banner tone="err">
        Failed to load the provider change feed — the audit endpoint returned an error. No rows are
        shown rather than a fabricated trail.
      </Banner>
    )
  }
  if (q.isLoading) {
    return <Banner tone="info">Loading the provider change feed…</Banner>
  }
  if (logs.length === 0) {
    return (
      <Banner tone="info">
        No provider changes recorded yet. Provider create / edit / delete actions land here with the
        actor, action and timestamp (chain-of-custody · GET /api/admin/audit-logs?resourceType=LLMProvider).
      </Banner>
    )
  }

  return (
    <div className="awc-tablewrap">
      <table className="awc-dt">
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>{relTime(l.timestamp)}</td>
              <td>
                <span className="awc-name">{l.userName ?? '—'}</span>
                {l.userEmail && (
                  <div style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
                    {l.userEmail}
                  </div>
                )}
              </td>
              <td>
                <Tag>{l.action ?? '—'}</Tag>
              </td>
              <td style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
                {l.resourceType ?? '—'}
                {l.resourceId ? ` · ${String(l.resourceId).slice(0, 16)}` : ''}
              </td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot tone={l.success === false ? 'err' : 'ok'} />
                  {l.success === false ? 'denied' : 'ok'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
