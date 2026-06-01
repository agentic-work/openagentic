import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import { useUserManagement, asUsers } from '../../hooks/useUserManagement'

interface IssueTokenModalProps {
  open: boolean
  onClose: () => void
}

interface IssueTokenBody {
  userId: string
  name: string
  expiresInDays?: number
  rateLimitTier?: 'free' | 'pro' | 'enterprise' | 'custom'
}

interface IssueTokenResponse {
  success: boolean
  message: string
  token: {
    id: string
    apiKey: string
    name: string
    expiresAt: string | null
    rateLimitTier: string
  }
}

const TIERS: Array<IssueTokenBody['rateLimitTier']> = ['free', 'pro', 'enterprise', 'custom']
const EXPIRY_OPTIONS = [
  { label: 'never', value: undefined },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]

export const IssueTokenModal: React.FC<IssueTokenModalProps> = ({ open, onClose }) => {
  const usersQ = useUserManagement()
  const issue = useAdminMutation<IssueTokenResponse, IssueTokenBody>(
    '/api/admin/tokens',
    {
      method: 'POST',
      invalidateKeys: [['tokens']],
    },
  )

  // #811 — include ALL users (admin + non-admin). Sort admins last so the
  // common case (issuing for a service / non-admin) stays at the top of
  // the list. The back-end already audit-logs admin key issuance.
  const allUsers = asUsers(usersQ.data).slice().sort((a, b) => {
    if (a.is_admin === b.is_admin) {
      return (a.email || '').localeCompare(b.email || '')
    }
    return a.is_admin ? 1 : -1
  })

  const [userId, setUserId] = React.useState('')
  const [name, setName] = React.useState('')
  const [tier, setTier] = React.useState<IssueTokenBody['rateLimitTier']>('free')
  const [expiresInDays, setExpiresInDays] = React.useState<number | undefined>(30)
  const [issued, setIssued] = React.useState<IssueTokenResponse['token'] | null>(null)
  const [touched, setTouched] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  // Reset whenever the modal re-opens.
  React.useEffect(() => {
    if (open) {
      setUserId('')
      setName('')
      setTier('free')
      setExpiresInDays(30)
      setIssued(null)
      setTouched(false)
      setCopied(false)
      issue.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const canSubmit = userId.length > 0 && name.trim().length > 0 && !issue.isPending
  const selectedUser = allUsers.find((u) => u.id === userId)
  const issuingForAdmin = !!selectedUser?.is_admin

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    issue.mutate(
      {
        userId,
        name: name.trim(),
        expiresInDays,
        rateLimitTier: tier,
      },
      {
        onSuccess: (resp) => {
          setIssued(resp.token)
        },
      },
    )
  }

  const copy = async () => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.apiKey)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard write blocked — leave the inline value visible
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={issued ? 'token created' : 'issue api token'}
      meta={issued ? 'save the key NOW — it is not shown again' : 'POST /api/admin/tokens'}
    >
      {issued ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Banner level="warn" label="one-time secret">
            this api key will <span className="accent">never</span> be shown again — copy it now
          </Banner>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: 'var(--fg-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}>
              api key
            </div>
            <code style={{
              display: 'block',
              padding: '8px 10px',
              background: 'var(--bg-2)',
              border: '1px solid var(--accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--v3-t-body, 12px)',
              color: 'var(--fg-0)',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}>
              {issued.apiKey}
            </code>
          </div>
          <FormGrid>
            <FormRow name="Name">
              <span className="mono">{issued.name}</span>
            </FormRow>
            <FormRow name="Tier">
              <span className="mono">{issued.rateLimitTier}</span>
            </FormRow>
            <FormRow name="Expires">
              <span className="mono">{issued.expiresAt ?? 'never'}</span>
            </FormRow>
          </FormGrid>
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 6,
            paddingTop: 6,
            borderTop: '1px solid var(--line-1)',
          }}>
            <Btn variant="ghost" onClick={copy}>
              {copied ? 'copied!' : 'copy key'}
            </Btn>
            <Btn variant="primary" onClick={onClose}>done</Btn>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {issue.isError && (
            <Banner level="err" label="error">
              {issue.error?.message ?? 'failed to issue token'}
            </Banner>
          )}
          <FormGrid>
            <FormRow name="User" desc="Admin users are excluded by policy.">
              <select
                className="aw-input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                aria-invalid={touched && !userId}
                required
              >
                <option value="">— select user —</option>
                {usersQ.isLoading && <option disabled>loading…</option>}
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.name || u.email.split('@')[0])} — {u.email}{u.is_admin ? ' (admin)' : ''}
                  </option>
                ))}
              </select>
              {issuingForAdmin && (
                <div style={{ marginTop: 8 }}>
                  <Banner level="warn" label="admin key">
                    issuing an api key for an <span className="accent">admin</span> user — this will be audit-logged. Confirm the recipient is intentional before submitting.
                  </Banner>
                </div>
              )}
            </FormRow>
            <FormRow name="Token name" desc="Human-readable label. Required.">
              <input
                className="aw-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="ci-pipeline / vscode / etc."
                aria-invalid={touched && !name.trim()}
                required
                maxLength={255}
              />
            </FormRow>
            <FormRow
              name="Rate-limit tier"
              desc="Per-token rate limits override the user's default tier."
              configKey="apiKey.rate_limit_tier"
            >
              <select
                className="aw-input"
                value={tier}
                onChange={(e) => setTier(e.target.value as IssueTokenBody['rateLimitTier'])}
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </FormRow>
            <FormRow name="Expires" desc="Self-revoke after this many days.">
              <select
                className="aw-input"
                value={expiresInDays === undefined ? '' : String(expiresInDays)}
                onChange={(e) => {
                  const v = e.target.value
                  setExpiresInDays(v === '' ? undefined : parseInt(v, 10))
                }}
              >
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value === undefined ? '' : String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
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
            <Btn
              variant="primary"
              type="submit"
              disabled={!canSubmit}
              onClick={() => submit()}
            >
              {issue.isPending ? 'issuing…' : 'issue token'}
            </Btn>
          </div>
        </form>
      )}
    </SidePanel>
  )
}

export default IssueTokenModal
