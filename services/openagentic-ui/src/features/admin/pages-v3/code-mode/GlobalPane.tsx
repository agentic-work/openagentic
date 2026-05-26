import * as React from 'react'
import {
  FormGrid,
  FormRow,
  Toggle,
  Btn,
  Banner,
  EmptyInline,
  SavedTag,
  DirtyTag,
} from '../../primitives-v3'
import {
  useCodeModeGlobalSettings,
  type CodeModeGlobalSettings,
} from '../../hooks/useDashboardMetrics'
import { useAdminMutation } from '../../hooks/useAdminQuery'

interface SaveBody {
  lockdown?: boolean
  internet?: boolean
}

export const GlobalPane: React.FC = () => {
  const q = useCodeModeGlobalSettings()
  const server: CodeModeGlobalSettings = q.data?.settings ?? {}

  const [lockdown, setLockdown] = React.useState<boolean>(false)
  const [internet, setInternet] = React.useState<boolean>(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  React.useEffect(() => {
    if (!q.data?.settings) return
    setLockdown(server.lockdown === true)
    setInternet(server.internet !== false)
  }, [q.data, server.lockdown, server.internet])

  const dirty =
    lockdown !== (server.lockdown === true) || internet !== (server.internet !== false)

  const saveM = useAdminMutation<unknown, SaveBody>(
    '/api/admin/codemode/global-settings',
    {
      method: 'PUT',
      invalidateKeys: [['code-mode-global-settings']],
      onSuccess: () => {
        setError(null)
        setSaved(true)
        window.setTimeout(() => setSaved(false), 3000)
      },
      onError: (err) => setError(err.message),
    },
  )

  if (q.isLoading) {
    return <EmptyInline pad>loading /api/admin/codemode/global-settings…</EmptyInline>
  }
  if (q.isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/codemode/global-settings</span>
      </Banner>
    )
  }
  if (!q.data?.settings) {
    return (
      <EmptyInline pad>
        endpoint returned no settings — check that the api service is on a
        build that includes the code-mode global-settings route
      </EmptyInline>
    )
  }

  return (
    <>
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      {lockdown && (
        <Banner level="warn" label="lockdown">
          all newly spawned sessions start with no network and tools denied
          by default. operators must explicitly grant per-session.
        </Banner>
      )}
      <FormGrid>
        <FormRow
          name="lockdown mode"
          desc="strips network + tools from every new session (audit + compliance posture)"
          configKey="awcode.lockdown"
          status={dirty ? <DirtyTag /> : saved ? <SavedTag /> : null}
        >
          <Toggle on={lockdown} onChange={setLockdown} label={lockdown ? 'enabled' : 'disabled'} />
        </FormRow>
        <FormRow
          name="internet access"
          desc="allows outbound network when lockdown=false; ignored when lockdown=true"
          configKey="awcode.internet"
          status={dirty ? <DirtyTag /> : saved ? <SavedTag /> : null}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Toggle on={internet} onChange={setInternet} label={internet ? 'enabled' : 'disabled'} />
            {lockdown && (
              <span style={{ color: 'var(--fg-3)' }}>· overridden by lockdown</span>
            )}
          </span>
        </FormRow>
      </FormGrid>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px' }}>
        <Btn
          variant="ghost"
          disabled={!dirty || saveM.isPending}
          onClick={() => {
            setLockdown(server.lockdown === true)
            setInternet(server.internet !== false)
            setError(null)
          }}
        >
          revert
        </Btn>
        <Btn
          variant="primary"
          disabled={!dirty || saveM.isPending}
          onClick={() => saveM.mutate({ lockdown, internet })}
        >
          {saveM.isPending ? 'saving…' : 'save'}
        </Btn>
      </div>
    </>
  )
}
