import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'

export interface RateLimitTier {
  name: string
  displayName?: string
  requestsPerMinute?: number
  requestsPerHour?: number
  requestsPerDay?: number
  tokensPerDay?: number
  workflowExecutionsPerHour?: number
  concurrentWorkflows?: number
  codeExecutionsPerHour?: number
  description?: string
}

interface EditRateLimitTierModalProps {
  tier: RateLimitTier | null
  onClose: () => void
}

interface UpdateBody {
  requestsPerMinute?: number
  requestsPerHour?: number
  requestsPerDay?: number
  tokensPerDay?: number
  workflowExecutionsPerHour?: number
  concurrentWorkflows?: number
  codeExecutionsPerHour?: number
}

// 2026-05-06 wire-up: the FormRow accepts only a single child for the
// numeric input, so the helper just renders an `<input>` and lets the
// caller supply the row name + description.
const NumberInput: React.FC<{
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  min?: number
  max?: number
}> = ({ value, onChange, placeholder, min = 0, max = 10_000_000 }) => (
  <input
    className="aw-input"
    type="number"
    min={min}
    max={max}
    style={{ maxWidth: 160 }}
    value={typeof value === 'number' ? String(value) : ''}
    onChange={(e) => {
      const v = e.target.value
      onChange(v === '' ? undefined : parseInt(v, 10))
    }}
    placeholder={placeholder ?? '(unlimited)'}
  />
)

export const EditRateLimitTierModal: React.FC<EditRateLimitTierModalProps> = ({
  tier,
  onClose,
}) => {
  const open = tier !== null

  // Endpoint binds to a specific tier name. We use a per-mount mutation
  // (recreated on every modal open) so the URL stays in sync.
  const save = useAdminMutation<{ success: boolean; tier: any }, UpdateBody>(
    tier ? `/api/admin/rate-limits/tiers/${encodeURIComponent(tier.name)}` : '/api/admin/rate-limits/tiers/_',
    {
      method: 'PUT',
      invalidateKeys: [['rate-limits']],
    },
  )

  const [draft, setDraft] = React.useState<UpdateBody>({})
  React.useEffect(() => {
    if (!tier) return
    setDraft({
      requestsPerMinute: tier.requestsPerMinute,
      requestsPerHour: tier.requestsPerHour,
      requestsPerDay: tier.requestsPerDay,
      tokensPerDay: tier.tokensPerDay,
      workflowExecutionsPerHour: tier.workflowExecutionsPerHour,
      concurrentWorkflows: tier.concurrentWorkflows,
      codeExecutionsPerHour: tier.codeExecutionsPerHour,
    })
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier?.name])

  const set = <K extends keyof UpdateBody>(k: K, v: UpdateBody[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    save.mutate(draft, { onSuccess: () => onClose() })
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={tier ? `edit tier — ${tier.displayName ?? tier.name}` : 'edit tier'}
      meta={tier ? `PUT /api/admin/rate-limits/tiers/${tier.name}` : ''}
    >
      {tier && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {save.isError && (
            <Banner level="err" label="error">
              {save.error?.message ?? 'failed to update tier'}
            </Banner>
          )}
          <FormGrid>
            <FormRow name="Requests / minute" desc="Hard cap. Empty = unlimited.">
              <NumberInput value={draft.requestsPerMinute} onChange={(v) => set('requestsPerMinute', v)} />
            </FormRow>
            <FormRow name="Requests / hour">
              <NumberInput value={draft.requestsPerHour} onChange={(v) => set('requestsPerHour', v)} />
            </FormRow>
            <FormRow name="Requests / day">
              <NumberInput value={draft.requestsPerDay} onChange={(v) => set('requestsPerDay', v)} />
            </FormRow>
            <FormRow name="Tokens / day" desc="LLM tokens (input + output) per UTC day.">
              <NumberInput value={draft.tokensPerDay} onChange={(v) => set('tokensPerDay', v)} />
            </FormRow>
            <FormRow name="Workflow runs / hour">
              <NumberInput value={draft.workflowExecutionsPerHour} onChange={(v) => set('workflowExecutionsPerHour', v)} />
            </FormRow>
            <FormRow name="Concurrent workflows">
              <NumberInput value={draft.concurrentWorkflows} onChange={(v) => set('concurrentWorkflows', v)} />
            </FormRow>
            <FormRow name="Code runs / hour" desc="Per-tier ceiling on the synth-executor pod.">
              <NumberInput value={draft.codeExecutionsPerHour} onChange={(v) => set('codeExecutionsPerHour', v)} />
            </FormRow>
          </FormGrid>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--line-1)',
          }}>
            <Btn variant="ghost" type="button" onClick={onClose}>cancel</Btn>
            <Btn variant="primary" type="submit" disabled={save.isPending} onClick={() => submit()}>
              {save.isPending ? 'saving…' : 'save tier'}
            </Btn>
          </div>
        </form>
      )}
    </SidePanel>
  )
}

export default EditRateLimitTierModal
