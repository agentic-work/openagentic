import * as React from 'react'
import {
  Banner,
  Btn,
  Dt,
  type DtCol,
  EmptyInline,
  FormGrid,
  FormRow,
  Panel,
  PanelHead,
  SectionBar,
  StatusDot,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import { EditPolicyModal, type NetworkPolicyDraft } from './EditPolicyModal'

interface NetworkStatus {
  available?: boolean
  services?: Array<{ name?: string; status?: string }>
}

interface NetworkPolicy {
  id?: string
  service?: string
  name?: string
  enabled?: boolean
  cidrs?: string[]
  description?: string
}

interface NetworkPoliciesResponse {
  policies?: NetworkPolicy[]
  allowedOrigins?: string[]
  ipAllowlist?: string[]
  corsEnabled?: boolean
}

interface ProtectedConnection {
  id?: string
  service?: string
  source?: string
  state?: string
}

export const NetworkPane: React.FC = () => {
  const statusQ = useAdminQuery<NetworkStatus>(
    ['network', 'status'],
    '/api/admin/network/status',
    { staleTime: 30_000 },
  )
  const policiesQ = useAdminQuery<NetworkPoliciesResponse>(
    ['network', 'policies'],
    '/api/admin/network/policies',
    { staleTime: 60_000 },
  )
  const protectedQ = useAdminQuery<{ connections?: ProtectedConnection[] }>(
    ['network', 'protected'],
    '/api/admin/network/protected',
    { staleTime: 30_000 },
  )

  const status = statusQ.data ?? {}
  const policiesData = policiesQ.data ?? {}
  const policies = policiesData.policies ?? []
  const allowedOrigins = policiesData.allowedOrigins ?? []
  const ipAllowlist = policiesData.ipAllowlist ?? []
  const connections = protectedQ.data?.connections ?? []

  const [editing, setEditing] = React.useState<NetworkPolicyDraft | null>(null)

  const policyCols: DtCol<NetworkPolicy>[] = [
    {
      key: 'service',
      label: 'service',
      className: 'name',
      render: (r) => r.service ?? r.name ?? '—',
    },
    {
      key: 'enabled',
      label: 'enabled',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.enabled ? 'ok' : 'idle'} />
          {r.enabled ? 'on' : 'off'}
        </span>
      ),
    },
    {
      key: 'cidrs',
      label: 'cidrs',
      className: 'mono',
      render: (r) => (r.cidrs && r.cidrs.length > 0 ? r.cidrs.join(', ') : '—'),
    },
    {
      key: 'desc',
      label: 'description',
      className: 'dim',
      render: (r) => r.description ?? '—',
    },
    {
      key: 'edit',
      label: 'edit',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={() => setEditing({
            service: r.service ?? r.name ?? '',
            enabled: !!r.enabled,
            cidrs: r.cidrs,
            description: r.description,
          })}
          disabled={!r.service && !r.name}
        >
          edit
        </Btn>
      ),
    },
  ]

  const connCols: DtCol<ProtectedConnection>[] = [
    {
      key: 'service',
      label: 'service',
      className: 'name',
      render: (r) => r.service ?? '—',
    },
    {
      key: 'source',
      label: 'source',
      className: 'mono',
      render: (r) => r.source ?? '—',
    },
    {
      key: 'state',
      label: 'state',
      render: (r) => r.state ?? '—',
    },
  ]

  return (
    <div data-density="compact">
      <EditPolicyModal policy={editing} onClose={() => setEditing(null)} />

      {(statusQ.isError || policiesQ.isError || protectedQ.isError) && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/network/*</span> endpoints unreachable
        </Banner>
      )}

      {/* I-3: surface that k8s NetworkPolicies live in helm. Toggles + value
          edits below mutate the api-side overlay layer (CORS allowlist, IP
          allowlist, etc.); the pod-to-pod NetworkPolicy graph is owned by
          `helm/openagentic-helm/templates/networkpolicy/*.yaml` and won't
          change from this pane. */}
      <Banner level="info" label="info">
        kubernetes <span className="accent">NetworkPolicy</span> resources are
        helm-managed (see <span className="accent">openagentic-helm/templates/networkpolicy/</span>) —
        this pane edits the <span className="accent">application-layer</span> network surface
        (CORS, IP allowlist, request gates). To change pod-to-pod connectivity,
        update the chart and <span className="accent">helm upgrade</span>.
      </Banner>

      <SectionBar title="network status" />
      <Panel>
        <PanelHead title="status" />
        {statusQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : statusQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : (
          <FormGrid>
            <FormRow name="Available" desc="Network controller reachable">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <StatusDot status={status.available ? 'ok' : 'err'} />
                {status.available ? 'yes' : 'no'}
              </span>
            </FormRow>
            <FormRow name="CORS enabled" configKey="network.corsEnabled">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <StatusDot status={policiesData.corsEnabled ? 'ok' : 'idle'} />
                {policiesData.corsEnabled === undefined
                  ? '—'
                  : policiesData.corsEnabled
                    ? 'yes'
                    : 'no'}
              </span>
            </FormRow>
            <FormRow name="Allowed origins" configKey="network.allowedOrigins">
              {allowedOrigins.length === 0 ? (
                <span style={{ color: 'var(--fg-3)' }}>none</span>
              ) : (
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {allowedOrigins.join(', ')}
                </span>
              )}
            </FormRow>
            <FormRow name="IP allowlist" configKey="network.ipAllowlist">
              {ipAllowlist.length === 0 ? (
                <span style={{ color: 'var(--fg-3)' }}>none</span>
              ) : (
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {ipAllowlist.join(', ')}
                </span>
              )}
            </FormRow>
          </FormGrid>
        )}
      </Panel>

      <SectionBar title="policies" count={policies.length} />
      <Panel>
        <PanelHead title="policies" count={policies.length} />
        {policiesQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : policiesQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : policies.length === 0 ? (
          <EmptyInline pad>no policies configured</EmptyInline>
        ) : (
          <Dt
            columns={policyCols}
            rows={policies}
            rowKey={(r, i) => r.id ?? r.service ?? r.name ?? String(i)}
            rowDataAttrs={(r: any) => ({
              status: r.enabled === false ? 'idle'
                : r.state === 'enforced' || r.state === 'active' ? 'ok'
                : r.state === 'monitor' || r.state === 'audit' ? 'warn'
                : 'idle',
            })}
          />
        )}
      </Panel>

      <SectionBar title="protected connections" count={connections.length} />
      <Panel>
        <PanelHead title="connections" count={connections.length} />
        {protectedQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : protectedQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : connections.length === 0 ? (
          <EmptyInline pad>no protected connections recorded</EmptyInline>
        ) : (
          <Dt
            columns={connCols}
            rows={connections}
            rowKey={(r, i) => r.id ?? `${r.service ?? ''}-${r.source ?? ''}-${i}`}
            rowDataAttrs={(r: any) => ({
              status: r.allowed === false || r.blocked === true ? 'err'
                : r.allowed === true ? 'ok'
                : 'idle',
            })}
          />
        )}
      </Panel>
    </div>
  )
}

export default NetworkPane
