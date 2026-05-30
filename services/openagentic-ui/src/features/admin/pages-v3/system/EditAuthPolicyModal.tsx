import * as React from 'react'
import {
  Banner,
  Btn,
  FormGrid,
  FormRow,
  SidePanel,
  Toggle,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'

type Mode = 'user' | 'domain'

interface EditAuthPolicyModalProps {
  open: boolean
  mode: Mode
  onClose: () => void
}

interface UserBody { email: string; is_admin?: boolean; display_name?: string; notes?: string }
interface DomainBody { domain: string; is_admin_domain?: boolean; notes?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export const EditAuthPolicyModal: React.FC<EditAuthPolicyModalProps> = ({
  open,
  mode,
  onClose,
}) => {
  // Two separate mutations so each invalidates only the right query.
  const addUser = useAdminMutation<{ user: any }, UserBody>(
    '/api/admin/auth/users',
    { method: 'POST', invalidateKeys: [['auth', 'users']] },
  )
  const addDomain = useAdminMutation<{ domain: any }, DomainBody>(
    '/api/admin/auth/domains',
    { method: 'POST', invalidateKeys: [['auth', 'domains']] },
  )
  const active = mode === 'user' ? addUser : addDomain

  const [emailOrDomain, setEmailOrDomain] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmailOrDomain('')
      setDisplayName('')
      setIsAdmin(false)
      setNotes('')
      setTouched(false)
      addUser.reset()
      addDomain.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  const valid = mode === 'user'
    ? EMAIL_RE.test(emailOrDomain.trim())
    : DOMAIN_RE.test(emailOrDomain.trim().replace(/^@/, ''))
  const canSubmit = valid && !active.isPending

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    if (mode === 'user') {
      addUser.mutate(
        {
          email: emailOrDomain.trim().toLowerCase(),
          is_admin: isAdmin,
          display_name: displayName.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        { onSuccess: () => onClose() },
      )
    } else {
      addDomain.mutate(
        {
          domain: emailOrDomain.trim().toLowerCase().replace(/^@/, ''),
          is_admin_domain: isAdmin,
          notes: notes.trim() || undefined,
        },
        { onSuccess: () => onClose() },
      )
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={mode === 'user' ? 'add allowed user' : 'add allowed domain'}
      meta={mode === 'user'
        ? 'POST /api/admin/auth/users'
        : 'POST /api/admin/auth/domains'}
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {active.isError && (
          <Banner level="err" label="error">
            {active.error?.message ?? 'failed to add entry'}
          </Banner>
        )}

        <FormGrid>
          <FormRow
            name={mode === 'user' ? 'Email' : 'Domain'}
            desc={mode === 'user'
              ? 'Required. SSO-verified email permitted to sign in.'
              : 'Required. Any user from @domain may sign in once added.'}
          >
            <input
              className="aw-input"
              type="text"
              autoFocus
              value={emailOrDomain}
              onChange={(e) => setEmailOrDomain(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={mode === 'user' ? 'user@example.com' : 'example.com'}
              aria-invalid={touched && !valid}
              required
            />
            {touched && !valid && (
              <div style={{
                marginTop: 4,
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--err)',
              }}>
                {mode === 'user' ? 'enter a valid email' : 'enter a valid domain (e.g. example.com)'}
              </div>
            )}
          </FormRow>
          {mode === 'user' && (
            <FormRow name="Display name" desc="Optional.">
              <input
                className="aw-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Operator"
              />
            </FormRow>
          )}
          <FormRow
            name={mode === 'user' ? 'Admin' : 'Admin domain'}
            desc={mode === 'user'
              ? 'Grants full portal access to this user.'
              : 'Every user from this domain becomes an admin on first sign-in.'}
            configKey={mode === 'user' ? 'auth.is_admin' : 'auth.is_admin_domain'}
          >
            <Toggle on={isAdmin} onChange={setIsAdmin} label="admin" />
          </FormRow>
          <FormRow name="Notes" desc="Optional admin-visible context.">
            <textarea
              className="aw-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="why this entry was added"
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
          <Btn variant="primary" type="submit" disabled={!canSubmit} onClick={() => submit()}>
            {active.isPending ? 'adding…' : mode === 'user' ? 'add user' : 'add domain'}
          </Btn>
        </div>
      </form>
    </SidePanel>
  )
}

export default EditAuthPolicyModal
