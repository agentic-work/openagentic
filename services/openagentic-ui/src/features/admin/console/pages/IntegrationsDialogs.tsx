/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Integrations domain — the admin "configure an integration" WRITE UI
 * (OSS issue #119, G2). A single create/edit modal per platform wired to the
 * real, admin-gated integration endpoints:
 *
 *   POST   /api/admin/integrations                       — create
 *   PUT    /api/admin/integrations/:id                   — update
 *   DELETE /api/admin/integrations/:id                   — soft-delete
 *   POST   /api/admin/integrations/:id/test              — test connection
 *   POST   /api/admin/integrations/:id/test/send-message — Slack test post
 *
 * Secrets are WRITE-ONLY. The list/get routes EXCLUDE `config` (server-side),
 * so on edit no secret is ever pre-filled — the inputs render blank with a
 * "leave blank to keep" affordance, and `config` is only re-sent when the
 * admin actually enters new credentials (a PUT with `config` REPLACES the
 * stored config wholesale, so a partial secret edit is rejected by client
 * validation that requires the full credential set).
 *
 * Everything here is token-only (var(--*) — zero hex/rgb/named colors,
 * CLAUDE.md Rule 8b) and every payload is stringified before render so a raw
 * object never reaches the DOM. No `any` (the no-explicit-any ratchet lints
 * changed UI files as errors).
 *
 * The ModalShell + Field + token-only input styles mirror the established
 * console dialog pattern in ./ModelsDialogs.tsx; they are kept local here so
 * the Integrations dialogs do not take a cross-page dependency on the Models
 * dialogs (and so this module stays lightweight to render-test).
 */
import * as React from 'react'
import { apiRequest } from '@/utils/api'
import { Banner, Btn } from '../primitives'

/** Inline status callback (mirrors ./ModelsDialogs NotifyFn). */
export type NotifyFn = (tone: 'ok' | 'err' | 'info', msg: string) => void

export type IntegrationPlatform = 'slack' | 'teams'

/**
 * The non-secret shape an edit carries. The admin list/get routes exclude
 * `config` (secrets), so an edit NEVER has any credential to pre-fill.
 */
export interface IntegrationEditing {
  id: string
  name?: string
  platform?: string
  allowed_channels?: string[]
  allowed_workflows?: string[]
}

/* ──────────────── format validation (mirrors the API) ────────────────
 * Kept in lock-step with services/openagentic-api/src/routes/admin-integrations.ts
 * so the admin gets a clear client-side error before the round-trip. */
const SLACK_BOT_TOKEN_RE = /^xoxb-[\w-]+$/
const SLACK_SIGNING_SECRET_RE = /^[a-f0-9]{32}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ──────────────── token-only input styles ──────────────── */
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
  minHeight: 60,
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

/* ──────────────── small helpers ──────────────── */
/** Render an array as newline-joined text for a textarea. */
function toLines(arr: string[] | undefined): string {
  return (arr ?? []).filter(Boolean).join('\n')
}
/** Parse a comma/newline-separated textarea back into a trimmed string list. */
function parseList(s: string): string[] {
  return s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)
}
/** Read a string field off an unknown JSON payload (no `any`). */
function readStr(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}
/** Best-effort human error from a non-ok Response. */
async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText)
  try {
    const parsed: unknown = JSON.parse(text)
    return readStr(parsed, 'error') ?? readStr(parsed, 'message') ?? text
  } catch {
    return text
  }
}

/** Diagnostic shape returned by /test + /test/send-message. */
interface TestDetails {
  team?: string
  user?: string
  url?: string
  scopes?: string[]
  tokenType?: string
  expiresIn?: number
  appDisplayName?: string
  error?: string
  errorDescription?: string
  field?: string
  ts?: string
  channel?: string
}
interface TestResponse {
  success?: boolean
  details?: TestDetails
}

/* ──────────────── Field + ModalShell (mirror the console pattern) ──────────────── */
function Field({
  label,
  desc,
  required,
  children,
}: {
  label: string
  desc?: React.ReactNode
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

function ModalShell({
  title,
  sub,
  onClose,
  width = 580,
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
        aria-label={typeof title === 'string' ? title : undefined}
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
 * IntegrationModal — create + edit a Slack or Teams integration.
 * ════════════════════════════════════════════════════════════════════════ */
export function IntegrationModal({
  platform,
  editing,
  onClose,
  onSaved,
  notify,
}: {
  /** which platform form to render (fixed for the lifetime of the modal). */
  platform: IntegrationPlatform
  /** null → create; a row → edit (secrets are never carried — write-only). */
  editing: IntegrationEditing | null
  onClose: () => void
  /** called after a successful create/update/delete so the list can refetch. */
  onSaved?: () => void
  notify?: NotifyFn
}) {
  const isEdit = editing != null
  const isSlack = platform === 'slack'

  const [name, setName] = React.useState(editing?.name ?? '')
  const [botToken, setBotToken] = React.useState('')
  const [signingSecret, setSigningSecret] = React.useState('')
  const [appId, setAppId] = React.useState('')
  const [appPassword, setAppPassword] = React.useState('')
  const [allowedChannels, setAllowedChannels] = React.useState(toLines(editing?.allowed_channels))
  const [allowedWorkflows, setAllowedWorkflows] = React.useState(toLines(editing?.allowed_workflows))
  const [testChannel, setTestChannel] = React.useState('')

  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [test, setTest] = React.useState<{ ok: boolean; latency?: number; message: string } | null>(
    null,
  )
  const [sendResult, setSendResult] = React.useState<{ ok: boolean; message: string } | null>(null)

  // Has the admin entered any credential? Controls "leave blank to keep" on edit.
  const secretsDirty = isSlack
    ? botToken.trim() !== '' || signingSecret.trim() !== ''
    : appId.trim() !== '' || appPassword.trim() !== ''

  const platformLabel = isSlack ? 'Slack' : 'Microsoft Teams'

  const validate = (): string | null => {
    if (!name.trim()) return 'name is required'
    // On create, the credential is always required. On edit it is required
    // only when the admin is changing it (a PUT with `config` replaces the
    // stored config wholesale, so a partial change must carry the full set).
    const mustHaveSecret = !isEdit || secretsDirty
    if (!mustHaveSecret) return null
    if (isSlack) {
      if (!botToken.trim()) return 'bot token is required (xoxb-…)'
      if (!SLACK_BOT_TOKEN_RE.test(botToken.trim()))
        return 'bot token must start with "xoxb-" (e.g. xoxb-1234-…)'
      if (signingSecret.trim() && !SLACK_SIGNING_SECRET_RE.test(signingSecret.trim()))
        return 'signing secret must be 32 hexadecimal characters'
    } else {
      if (!appId.trim()) return 'app id is required'
      if (!UUID_RE.test(appId.trim())) return 'app id must be a UUID (e.g. 2c2cdf17-…)'
      if (!appPassword.trim()) return 'app password is required'
    }
    return null
  }

  const buildConfig = (): Record<string, string> => {
    if (isSlack) {
      const cfg: Record<string, string> = { botToken: botToken.trim() }
      if (signingSecret.trim()) cfg.signingSecret = signingSecret.trim()
      return cfg
    }
    return { appId: appId.trim(), appPassword: appPassword.trim() }
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
      if (isEdit) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          allowed_channels: parseList(allowedChannels),
          allowed_workflows: parseList(allowedWorkflows),
        }
        // Only re-send config when the admin actually entered new secrets —
        // otherwise the existing (server-side, write-only) config is kept.
        if (secretsDirty) payload.config = buildConfig()
        const res = await apiRequest(
          `/api/admin/integrations/${encodeURIComponent(editing!.id)}`,
          { method: 'PUT', body: JSON.stringify(payload) },
        )
        if (!res.ok) {
          setErr((await readError(res)).slice(0, 260))
          return
        }
        notify?.('ok', `integration "${name.trim()}" updated`)
      } else {
        const payload = {
          name: name.trim(),
          platform,
          config: buildConfig(),
          allowed_channels: parseList(allowedChannels),
          allowed_workflows: parseList(allowedWorkflows),
        }
        const res = await apiRequest('/api/admin/integrations', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          setErr((await readError(res)).slice(0, 260))
          return
        }
        notify?.('ok', `${platformLabel} integration "${name.trim()}" created`)
      }
      onSaved?.()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!isEdit) return
    setTesting(true)
    setTest(null)
    setErr(null)
    try {
      const t0 = Date.now()
      const res = await apiRequest(
        `/api/admin/integrations/${encodeURIComponent(editing!.id)}/test`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      const body = (await res.json().catch(() => ({}))) as TestResponse
      const latency = Date.now() - t0
      const ok = res.ok && body.success !== false
      const d = body.details ?? {}
      let message: string
      if (ok) {
        message = isSlack
          ? `connected — team ${d.team ?? '—'}${d.user ? ` · bot ${d.user}` : ''}` +
            `${d.scopes ? ` · ${d.scopes.length} scopes` : ''}`
          : `connected — token acquired${d.appDisplayName ? ` · ${d.appDisplayName}` : ''}` +
            `${d.expiresIn ? ` · expires in ${d.expiresIn}s` : ''}`
      } else {
        message = d.error
          ? `${d.error}${d.errorDescription ? ` — ${d.errorDescription}` : ''}` +
            `${d.field ? ` (${d.field})` : ''}`
          : `HTTP ${res.status}`
      }
      setTest({ ok, latency, message })
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'network error' })
    } finally {
      setTesting(false)
    }
  }

  const handleSendMessage = async () => {
    if (!isEdit || !isSlack) return
    if (!testChannel.trim()) {
      setSendResult({ ok: false, message: 'enter a channel id or name first (e.g. #ops or C0123ABC)' })
      return
    }
    setSending(true)
    setSendResult(null)
    try {
      const res = await apiRequest(
        `/api/admin/integrations/${encodeURIComponent(editing!.id)}/test/send-message`,
        { method: 'POST', body: JSON.stringify({ channel: testChannel.trim() }) },
      )
      const body = (await res.json().catch(() => ({}))) as TestResponse
      const ok = res.ok && body.success !== false
      const d = body.details ?? {}
      setSendResult({
        ok,
        message: ok
          ? `message posted to ${d.channel ?? testChannel.trim()}${d.ts ? ` · ts ${d.ts}` : ''}`
          : d.error ?? `HTTP ${res.status}`,
      })
    } catch (e) {
      setSendResult({ ok: false, message: e instanceof Error ? e.message : 'network error' })
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    if (!isEdit) return
    setDeleting(true)
    setErr(null)
    try {
      const res = await apiRequest(
        `/api/admin/integrations/${encodeURIComponent(editing!.id)}`,
        { method: 'DELETE' },
      )
      if (!res.ok && res.status !== 204) {
        setErr(`delete failed: ${(await readError(res)).slice(0, 220)}`)
        return
      }
      notify?.('ok', `integration "${editing!.name ?? name.trim()}" removed`)
      onSaved?.()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error')
    } finally {
      setDeleting(false)
    }
  }

  const busy = saving || testing || sending || deleting
  const keepHint = isEdit ? '•••• leave blank to keep the current value' : undefined

  return (
    <ModalShell
      title={isEdit ? `Edit ${platformLabel} integration` : `Add ${platformLabel} integration`}
      sub={
        isEdit
          ? `PUT /api/admin/integrations/${editing!.id.slice(0, 8)} · secrets are write-only`
          : `POST /api/admin/integrations · ${platform} bot credentials + routing`
      }
      width={600}
      onClose={onClose}
      footer={
        <>
          {isEdit &&
            (confirmDelete ? (
              <>
                <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--err)' }}>
                  delete this integration? (soft-delete)
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
          <Btn
            variant="ghost"
            disabled={busy || !isEdit}
            title={isEdit ? undefined : 'save the integration first, then reopen it to test'}
            onClick={handleTest}
          >
            {testing ? 'testing…' : 'test connection'}
          </Btn>
          <Btn variant="ghost" disabled={busy} onClick={onClose}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={busy} onClick={handleSave}>
            {saving ? 'saving…' : isEdit ? 'save changes' : `create ${platform} integration`}
          </Btn>
        </>
      }
    >
      {err && <Banner tone="err">{err}</Banner>}
      {test && (
        <Banner tone={test.ok ? 'ok' : 'err'}>
          <b>{test.ok ? 'connection ok' : 'connection failed'}</b>
          {test.latency != null ? ` · ${test.latency}ms` : ''} — {test.message}
        </Banner>
      )}

      {/* ── Identity ── */}
      <div style={sectionHeadStyle}>Identity</div>
      <Field label="Name" desc="shown in the operator UI + audit logs" required>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
          placeholder={isSlack ? 'e.g. Slack — Acme workspace' : 'e.g. Teams — Contoso tenant'}
        />
      </Field>

      {/* ── Credentials (write-only) ── */}
      <div style={sectionHeadStyle}>Credentials</div>
      {isEdit && (
        <Banner tone="info">
          Secrets are <b>write-only</b> — they are encrypted server-side and never returned, so they
          are not pre-filled here. Leave the credential fields <b>blank to keep</b> the stored values;
          entering a new value <b>replaces</b> the stored configuration (re-enter the full set).
        </Banner>
      )}
      {isSlack ? (
        <>
          <Field
            label="Bot token"
            desc={keepHint ?? 'Slack bot OAuth token — starts with xoxb-'}
            required={!isEdit}
          >
            <input
              type="password"
              autoComplete="off"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              style={inputStyle}
              placeholder="xoxb-…"
            />
          </Field>
          <Field
            label="Signing secret"
            desc={keepHint ?? 'verifies inbound event + slash payloads — 32 hex chars (optional)'}
          >
            <input
              type="password"
              autoComplete="off"
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              style={inputStyle}
              placeholder={isEdit ? '•••• unchanged' : 'optional — 32 hex characters'}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label="App id"
            desc={keepHint ?? 'Azure Bot / app registration client id — a UUID'}
            required={!isEdit}
          >
            <input
              type="text"
              autoComplete="off"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              style={inputStyle}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </Field>
          <Field
            label="App password"
            desc={keepHint ?? 'app registration client secret'}
            required={!isEdit}
          >
            <input
              type="password"
              autoComplete="off"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              style={inputStyle}
              placeholder={isEdit ? '•••• unchanged' : 'client secret'}
            />
          </Field>
        </>
      )}

      {/* ── Routing ── */}
      <div style={sectionHeadStyle}>Routing</div>
      <Field
        label="Allowed channels"
        desc="optional allow-list — one channel id/name per line (or comma-separated). Empty = all channels."
      >
        <textarea
          value={allowedChannels}
          onChange={(e) => setAllowedChannels(e.target.value)}
          style={textareaStyle}
          placeholder={isSlack ? 'C0123ABCD\n#ops' : 'team / channel ids'}
        />
      </Field>
      <Field
        label="Allowed workflows"
        desc="optional — workflow ids this integration may trigger, one per line (or comma-separated)."
      >
        <textarea
          value={allowedWorkflows}
          onChange={(e) => setAllowedWorkflows(e.target.value)}
          style={textareaStyle}
          placeholder="workflow-id-1\nworkflow-id-2"
        />
      </Field>

      {/* ── Send test message (Slack, saved integrations only) ── */}
      {isSlack && (
        <>
          <div style={sectionHeadStyle}>Send test message</div>
          {isEdit ? (
            <>
              {sendResult && (
                <Banner tone={sendResult.ok ? 'ok' : 'err'}>
                  <b>{sendResult.ok ? 'sent' : 'send failed'}</b> — {sendResult.message}
                </Banner>
              )}
              <Field label="Channel" desc="posts a test message via chat.postMessage to confirm routing">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={testChannel}
                    onChange={(e) => setTestChannel(e.target.value)}
                    style={inputStyle}
                    placeholder="#ops or C0123ABCD"
                  />
                  <Btn variant="ghost" size="sm" disabled={busy} onClick={handleSendMessage}>
                    {sending ? 'sending…' : 'send'}
                  </Btn>
                </div>
              </Field>
            </>
          ) : (
            <Banner tone="info">
              Create the integration first, then reopen it to <b>test the connection</b> or{' '}
              <b>send a test message</b>.
            </Banner>
          )}
        </>
      )}
    </ModalShell>
  )
}
