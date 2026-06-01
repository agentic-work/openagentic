import * as React from 'react'
import {
  Banner,
  Btn,
  EmptyInline,
  FormGrid,
  FormRow,
  Panel,
  PanelHead,
  SectionBar,
  StatusDot,
  Toggle,
} from '../../primitives-v3'
import { useAdminQuery, useAdminMutation } from '../../hooks/useAdminQuery'

interface ReadOnlyModeResponse {
  success: boolean
  readOnlyMode: boolean
}

interface TieredFCConfig {
  enabled?: boolean
  toolStrippingEnabled?: boolean
  decisionCacheEnabled?: boolean
  decisionCacheTTL?: number
  cheapModel?: string
  balancedModel?: string
  premiumModel?: string
}

const yn = (v: boolean | undefined): React.ReactNode =>
  v === undefined ? (
    <span style={{ color: 'var(--fg-3)' }}>—</span>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusDot status={v ? 'ok' : 'idle'} />
      {v ? 'on' : 'off'}
    </span>
  )

export const SettingsPane: React.FC = () => {
  const q = useAdminQuery<TieredFCConfig>(
    ['system-settings', 'tiered-fc'],
    '/api/admin/tiered-fc',
    { staleTime: 60_000 },
  )
  const save = useAdminMutation<{ config: TieredFCConfig }, Partial<TieredFCConfig>>(
    '/api/admin/tiered-fc',
    {
      method: 'PUT',
      invalidateKeys: [['system-settings', 'tiered-fc']],
    },
  )

  const remote = q.data ?? {}
  const [draft, setDraft] = React.useState<TieredFCConfig>(remote)

  // Hydrate the draft from the server payload whenever it lands.
  React.useEffect(() => {
    setDraft(remote)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dataUpdatedAt])

  const set = <K extends keyof TieredFCConfig>(k: K, v: TieredFCConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const dirty = (Object.keys(draft) as Array<keyof TieredFCConfig>).some(
    (k) => draft[k] !== remote[k],
  ) || (Object.keys(remote) as Array<keyof TieredFCConfig>).some(
    (k) => draft[k] !== remote[k],
  )

  const onSave = () => {
    // Only ship the diff — keeps the audit log clean and respects the
    // back-end's "only present keys are mutated" contract.
    const diff: Partial<TieredFCConfig> = {}
    for (const k of Object.keys(draft) as Array<keyof TieredFCConfig>) {
      if (draft[k] !== remote[k]) (diff as any)[k] = draft[k]
    }
    save.mutate(diff)
  }

  const onRevert = () => {
    setDraft(remote)
    save.reset()
  }

  return (
    <>
      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/tiered-fc</span>
        </Banner>
      )}
      {save.isError && (
        <Banner level="err" label="error">
          {save.error?.message ?? 'failed to save tiered-fc config'}
        </Banner>
      )}
      {save.isSuccess && !dirty && (
        <Banner level="ok" label="ok">tiered-fc config saved</Banner>
      )}

      {dirty && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--line-1)',
          background: 'var(--bg-1)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--v3-t-meta)',
            color: 'var(--warn)',
          }}>unsaved changes</span>
          <span style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onRevert} disabled={save.isPending}>revert</Btn>
          <Btn variant="primary" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? 'saving…' : 'save'}
          </Btn>
        </div>
      )}

      <SectionBar title="global read-only mode" />
      <ReadOnlyModeSection />

      <SectionBar title="tiered function calling" />
      <Panel>
        <PanelHead title="config" />
        {q.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : q.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : (
          <FormGrid>
            <FormRow
              name="Enabled"
              desc="Master switch for tier-aware tool dispatch"
              configKey="tieredFC.enabled"
            >
              <Toggle on={!!draft.enabled} onChange={(v) => set('enabled', v)} label="enabled" />
              <span style={{ marginLeft: 10 }}>{yn(draft.enabled)}</span>
            </FormRow>
            <FormRow
              name="Tool stripping"
              desc="Strip unused tools from the per-turn payload"
              configKey="tieredFC.toolStrippingEnabled"
            >
              <Toggle
                on={!!draft.toolStrippingEnabled}
                onChange={(v) => set('toolStrippingEnabled', v)}
                label="tool stripping"
              />
              <span style={{ marginLeft: 10 }}>{yn(draft.toolStrippingEnabled)}</span>
            </FormRow>
            <FormRow
              name="Decision cache"
              desc="Cache classifier decisions across turns"
              configKey="tieredFC.decisionCacheEnabled"
            >
              <Toggle
                on={!!draft.decisionCacheEnabled}
                onChange={(v) => set('decisionCacheEnabled', v)}
                label="decision cache"
              />
              <span style={{ marginLeft: 10 }}>{yn(draft.decisionCacheEnabled)}</span>
            </FormRow>
            <FormRow
              name="Decision cache TTL"
              desc="Seconds a cached decision is considered valid"
              configKey="tieredFC.decisionCacheTTL"
            >
              <input
                className="aw-input"
                type="number"
                min={0}
                max={86400}
                step={1}
                style={{ maxWidth: 120 }}
                value={
                  typeof draft.decisionCacheTTL === 'number'
                    ? String(draft.decisionCacheTTL)
                    : ''
                }
                onChange={(e) => {
                  const v = e.target.value
                  set('decisionCacheTTL', v === '' ? undefined : parseInt(v, 10))
                }}
                placeholder="(unset)"
              />
            </FormRow>
            <FormRow
              name="Cheap model"
              desc="Tier 1 — used for simple classifier paths"
              configKey="tieredFC.cheapModel"
            >
              <input
                className="aw-input"
                type="text"
                value={draft.cheapModel ?? ''}
                onChange={(e) => set('cheapModel', e.target.value)}
                placeholder="(model id from registry)"
              />
            </FormRow>
            <FormRow
              name="Balanced model"
              desc="Tier 2 — default chat orchestration"
              configKey="tieredFC.balancedModel"
            >
              <input
                className="aw-input"
                type="text"
                value={draft.balancedModel ?? ''}
                onChange={(e) => set('balancedModel', e.target.value)}
                placeholder="(model id from registry)"
              />
            </FormRow>
            <FormRow
              name="Premium model"
              desc="Tier 3 — escalation for complex multi-tool turns"
              configKey="tieredFC.premiumModel"
            >
              <input
                className="aw-input"
                type="text"
                value={draft.premiumModel ?? ''}
                onChange={(e) => set('premiumModel', e.target.value)}
                placeholder="(model id from registry)"
              />
            </FormRow>
          </FormGrid>
        )}
      </Panel>

      <Banner level="info" label="model ids">
        cheap/balanced/premium model strings must match the model id (not display
        name) of a registered model in <span className="accent">/api/admin/model-registry</span>.
        Hardcoding raw provider names here violates the no-hardcoded-models rule.
      </Banner>
    </>
  )
}

// ============================================================
// Global Read-Only Mode — platform-wide kill switch for every
// CRUD tool. When ON, PermissionService denies any non-read tool
// regardless of cloud RBAC. Backed by system_configuration row
// keyed on `tool_read_only_mode` (survives pod restarts).
// ============================================================
const ReadOnlyModeSection: React.FC = () => {
  const q = useAdminQuery<ReadOnlyModeResponse>(
    ['permissions', 'read-only-mode'],
    '/api/admin/permissions/read-only-mode',
    { staleTime: 30_000 },
  )
  const mut = useAdminMutation<ReadOnlyModeResponse, { readOnlyMode: boolean }>(
    '/api/admin/permissions/read-only-mode',
    {
      method: 'POST',
      invalidateKeys: [['permissions', 'read-only-mode']],
    },
  )

  const active = q.data?.readOnlyMode ?? false
  const pending = mut.isPending
  const onToggle = () => mut.mutate({ readOnlyMode: !active })

  return (
    <>
      {q.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/permissions/read-only-mode</span>
        </Banner>
      )}
      {mut.isError && (
        <Banner level="err" label="error">
          {mut.error?.message ?? 'failed to toggle read-only mode'}
        </Banner>
      )}
      <Panel>
        <PanelHead title="global read-only mode" />
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Toggle on={active} disabled={q.isLoading || pending} onChange={onToggle} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: active ? 'var(--warn)' : 'var(--fg-3)',
            }}>
              {pending ? 'saving…' : active ? 'ENFORCED · all CRUD tools blocked' : 'disabled · CRUD tools follow per-user RBAC'}
            </span>
          </div>
          <p style={{ fontSize: 'var(--v3-t-meta)', color: 'var(--fg-3)', margin: 0, lineHeight: 1.5 }}>
            When ENFORCED: every tool not on the read-only allow-list is denied by
            <span className="accent"> PermissionService</span> before dispatch — regardless of
            whether the calling user has Owner / Contributor / Administrator on the underlying
            Azure / AWS / GCP / k8s / DB resource. Models are told via the system prompt that
            mutating calls will fail, so they stop trying. Auto-approve / HITL gates are
            irrelevant in this mode. Setting persists in
            <span className="accent"> system_configuration[tool_read_only_mode]</span> and
            survives pod restarts.
          </p>
        </div>
      </Panel>
    </>
  )
}

export default SettingsPane
