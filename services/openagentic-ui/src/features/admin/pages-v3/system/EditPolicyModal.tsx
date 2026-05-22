import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
  StatusDot,
  Toggle,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'

export interface NetworkPolicyDraft {
  /** Bare service name — the back-end prefixes `openagentic-` itself. */
  service: string
  enabled: boolean
  cidrs?: string[]
  description?: string
}

interface EditPolicyModalProps {
  policy: NetworkPolicyDraft | null
  onClose: () => void
}

interface ToggleResponse {
  success: boolean
  action?: string
  service?: string
  message?: string
}

export const EditPolicyModal: React.FC<EditPolicyModalProps> = ({ policy, onClose }) => {
  const open = policy !== null
  const toggle = useAdminMutation<ToggleResponse, { enabled: boolean }>(
    policy
      ? `/api/admin/network/policies/${encodeURIComponent(policy.service)}/toggle`
      : '/api/admin/network/policies/_/toggle',
    {
      method: 'PUT',
      invalidateKeys: [['network']],
    },
  )

  const [enabled, setEnabled] = React.useState<boolean>(false)
  React.useEffect(() => {
    if (!policy) return
    setEnabled(policy.enabled)
    toggle.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.service])

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!policy) return
    toggle.mutate({ enabled }, {
      onSuccess: (resp) => {
        // Enabling requires helm — the API returns success:false in that
        // case. Surface the message instead of silently closing.
        if (resp.success === false) return
        onClose()
      },
    })
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={policy ? `network policy — ${policy.service}` : 'network policy'}
      meta={policy ? `PUT /api/admin/network/policies/${policy.service}/toggle` : ''}
    >
      {policy && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {toggle.isError && (
            <Banner level="err" label="error">
              {toggle.error?.message ?? 'failed to update policy'}
            </Banner>
          )}
          {toggle.data?.success === false && (
            <Banner level="warn" label="helm required">
              {toggle.data.message ?? 'enabling a NetworkPolicy requires a helm upgrade'}
            </Banner>
          )}

          <FormGrid>
            <FormRow name="Service" desc="K8s service this policy targets.">
              <span className="mono">{policy.service}</span>
            </FormRow>
            <FormRow
              name="Enabled"
              desc={enabled
                ? 'When checked: applies the bundled NetworkPolicy CRD (helm-managed).'
                : 'When unchecked: deletes the live NetworkPolicy. Traffic falls back to default-allow.'}
              configKey={`network.${policy.service}.enabled`}
            >
              <Toggle on={enabled} onChange={setEnabled} label="enabled" />
              <span style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <StatusDot status={enabled ? 'ok' : 'idle'} />
                {enabled ? 'on' : 'off'}
              </span>
            </FormRow>
            {policy.cidrs && policy.cidrs.length > 0 && (
              <FormRow name="Allowed CIDRs" desc="Edit via helm chart values.">
                <span className="mono" style={{ wordBreak: 'break-all' }}>
                  {policy.cidrs.join(', ')}
                </span>
              </FormRow>
            )}
            {policy.description && (
              <FormRow name="Description">
                <span style={{ color: 'var(--fg-2)' }}>{policy.description}</span>
              </FormRow>
            )}
          </FormGrid>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--line-1)',
          }}>
            <Btn variant="ghost" type="button" onClick={onClose}>cancel</Btn>
            <Btn
              variant="primary"
              type="submit"
              disabled={toggle.isPending || enabled === policy.enabled}
              onClick={() => submit()}
            >
              {toggle.isPending
                ? 'saving…'
                : enabled === policy.enabled
                  ? 'no change'
                  : enabled ? 'enable policy' : 'disable policy'}
            </Btn>
          </div>
        </form>
      )}
    </SidePanel>
  )
}

export default EditPolicyModal
