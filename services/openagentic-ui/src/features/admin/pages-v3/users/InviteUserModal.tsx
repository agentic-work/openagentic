import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
  Toggle,
} from '../../primitives-v3'
import { useInviteAllowedUser } from '../../hooks/useUserManagement'

interface InviteUserModalProps {
  open: boolean
  onClose: () => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const InviteUserModal: React.FC<InviteUserModalProps> = ({ open, onClose }) => {
  const invite = useInviteAllowedUser()

  const [email, setEmail] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  // Reset form whenever the modal re-opens — otherwise stale values
  // would persist across invocations.
  React.useEffect(() => {
    if (open) {
      setEmail('')
      setDisplayName('')
      setIsAdmin(false)
      setNotes('')
      setTouched(false)
      invite.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const emailValid = EMAIL_RE.test(email.trim())
  const canSubmit = emailValid && !invite.isPending

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    invite.mutate(
      {
        email: email.trim().toLowerCase(),
        is_admin: isAdmin,
        display_name: displayName.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="invite user"
      meta="add to auth allow-list — gates SSO sign-in"
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {invite.isError && (
          <Banner level="err" label="error">
            {invite.error?.message ?? 'failed to add user'}
          </Banner>
        )}
        <Banner level="info" label="how this works">
          adds <span className="accent">{email.trim() || 'email'}</span> to the auth
          allow-list. The full user record is created automatically the first time
          they sign in via SSO.
        </Banner>

        <FormGrid>
          <FormRow name="Email" desc="Required. Used as the sign-in identity.">
            <input
              className="aw-input"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="user@example.com"
              aria-invalid={touched && !emailValid}
              required
            />
            {touched && !emailValid && (
              <div style={{
                marginTop: 4,
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--err)',
              }}>
                enter a valid email address
              </div>
            )}
          </FormRow>
          <FormRow name="Display name" desc="Optional. Shown in the directory list.">
            <input
              className="aw-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Operator"
            />
          </FormRow>
          <FormRow
            name="Admin"
            desc="Grants full portal access. Use sparingly."
            configKey="auth.is_admin"
          >
            <Toggle on={isAdmin} onChange={setIsAdmin} label="admin" />
          </FormRow>
          <FormRow name="Notes" desc="Optional admin-visible context (e.g. ticket #).">
            <textarea
              className="aw-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="why this user was invited"
            />
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
            {invite.isPending ? 'inviting…' : 'invite user'}
          </Btn>
        </div>
      </form>
    </SidePanel>
  )
}

export default InviteUserModal
