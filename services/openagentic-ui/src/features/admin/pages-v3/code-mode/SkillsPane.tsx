import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  Btn,
  Banner,
  EmptyInline,
  SectionBar,
  Toggle,
  v3InputStyle,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'
import { ConfirmInline } from '../shared/ConfirmInline'
import {
  useCodeModeSkills,
  useCodeModePlugins,
  type CodeModeSkillRow,
  type CodeModePluginRow,
} from '../../hooks/useDashboardMetrics'

export interface SkillsPaneProps {
  onAdd?: (label: string) => void
}

export const SkillsPane: React.FC<SkillsPaneProps> = (_props) => {
  const skillsQ = useCodeModeSkills()
  const pluginsQ = useCodeModePlugins()
  const [error, setError] = React.useState<string | null>(null)
  const [addSkillOpen, setAddSkillOpen] = React.useState(false)
  const [addPluginOpen, setAddPluginOpen] = React.useState(false)
  const [skillForm, setSkillForm] = React.useState({ id: '', name: '', description: '' })
  const [pluginForm, setPluginForm] = React.useState({ id: '', name: '', version: '' })
  const [confirmDelSkill, setConfirmDelSkill] = React.useState<string | null>(null)
  const [confirmDelPlugin, setConfirmDelPlugin] = React.useState<string | null>(null)

  const skills: CodeModeSkillRow[] = skillsQ.data?.skills ?? []
  const plugins: CodeModePluginRow[] = pluginsQ.data?.plugins ?? []

  const skillToggleM = useAdminMutation<unknown, { id: string; enabled: boolean }>(
    (vars) => `/api/admin/codemode/skills/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ enabled }) => ({ enabled }),
      invalidateKeys: [['code-mode-skills']],
      onError: (err) => setError(err.message),
    },
  )

  const pluginToggleM = useAdminMutation<unknown, { id: string; enabled: boolean }>(
    (vars) => `/api/admin/codemode/plugins/${encodeURIComponent(vars.id)}`,
    {
      method: 'PUT',
      bodyOf: ({ enabled }) => ({ enabled }),
      invalidateKeys: [['code-mode-plugins']],
      onError: (err) => setError(err.message),
    },
  )

  const syncM = useAdminMutation<unknown, void>('/api/admin/codemode/sync', {
    method: 'POST',
    invalidateKeys: [['code-mode-skills'], ['code-mode-plugins']],
    onError: (err) => setError(err.message),
  })

  const addSkillM = useAdminMutation<unknown, typeof skillForm>('/api/admin/codemode/skills', {
    method: 'POST',
    bodyOf: (vars) => ({
      id: vars.id.trim(),
      name: vars.name.trim() || vars.id.trim(),
      description: vars.description.trim() || undefined,
      enabled: true,
    }),
    invalidateKeys: [['code-mode-skills']],
    onSuccess: () => {
      setAddSkillOpen(false)
      setSkillForm({ id: '', name: '', description: '' })
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  const delSkillM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/codemode/skills/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['code-mode-skills']],
      onSuccess: () => {
        setConfirmDelSkill(null)
        setError(null)
      },
      onError: (err) => setError(err.message),
    },
  )

  const addPluginM = useAdminMutation<unknown, typeof pluginForm>('/api/admin/codemode/plugins', {
    method: 'POST',
    bodyOf: (vars) => ({
      id: vars.id.trim(),
      name: vars.name.trim() || vars.id.trim(),
      version: vars.version.trim() || undefined,
      enabled: true,
    }),
    invalidateKeys: [['code-mode-plugins']],
    onSuccess: () => {
      setAddPluginOpen(false)
      setPluginForm({ id: '', name: '', version: '' })
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  const delPluginM = useAdminMutation<unknown, { id: string }>(
    (vars) => `/api/admin/codemode/plugins/${encodeURIComponent(vars.id)}`,
    {
      method: 'DELETE',
      invalidateKeys: [['code-mode-plugins']],
      onSuccess: () => {
        setConfirmDelPlugin(null)
        setError(null)
      },
      onError: (err) => setError(err.message),
    },
  )

  const skillCols: DtCol<CodeModeSkillRow>[] = [
    {
      key: 'enabled',
      label: '',
      width: '40px',
      render: (r) => (
        <Toggle
          on={r.enabled}
          onChange={(v) => skillToggleM.mutate({ id: r.id, enabled: v })}
          label={r.enabled ? 'enabled' : 'disabled'}
        />
      ),
    },
    {
      key: 'name',
      label: 'Skill',
      className: 'name',
      render: (r) => r.name ?? r.id,
    },
    {
      key: 'desc',
      label: 'Description',
      render: (r) => (
        <span style={{ color: 'var(--fg-2)' }}>{r.description ?? '—'}</span>
      ),
    },
    {
      key: 'source',
      label: 'Source',
      width: '120px',
      className: 'mono',
      render: (r) => r.source ?? '—',
    },
    {
      key: 'tags',
      label: 'Tags',
      className: 'dim',
      render: (r) =>
        (r.tags ?? []).length === 0 ? '—' : (r.tags ?? []).join(', '),
    },
    {
      key: 'actions',
      label: '',
      width: '60px',
      align: 'right',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDelSkill(r.id)
          }}
        >
          del
        </Btn>
      ),
    },
  ]

  const pluginCols: DtCol<CodeModePluginRow>[] = [
    {
      key: 'enabled',
      label: '',
      width: '40px',
      render: (r) => (
        <Toggle
          on={r.enabled}
          onChange={(v) => pluginToggleM.mutate({ id: r.id, enabled: v })}
          label={r.enabled ? 'enabled' : 'disabled'}
        />
      ),
    },
    {
      key: 'name',
      label: 'Plugin',
      className: 'name',
      render: (r) => r.name ?? r.id,
    },
    {
      key: 'version',
      label: 'Version',
      width: '110px',
      className: 'mono',
      render: (r) => r.version ?? '—',
    },
    {
      key: 'desc',
      label: 'Description',
      render: (r) => (
        <span style={{ color: 'var(--fg-2)' }}>{r.description ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '60px',
      align: 'right',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDelPlugin(r.id)
          }}
        >
          del
        </Btn>
      ),
    },
  ]

  return (
    <>
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      <Banner level="info" label="source">
        skills + plugins are synced from the upstream registry on{' '}
        <span className="accent">POST /api/admin/codemode/sync</span> · use
        the +add affordances below for one-off operator additions/removals
      </Banner>
      {confirmDelSkill && (
        <ConfirmInline
          level="err"
          confirmLabel="remove skill"
          busy={delSkillM.isPending}
          label={
            <>
              remove skill{' '}
              <span className="accent">
                {skills.find((s) => s.id === confirmDelSkill)?.name ?? confirmDelSkill}
              </span>{' '}
              from the codemode bundle?
            </>
          }
          onConfirm={() => delSkillM.mutate({ id: confirmDelSkill })}
          onCancel={() => setConfirmDelSkill(null)}
        />
      )}
      {confirmDelPlugin && (
        <ConfirmInline
          level="err"
          confirmLabel="remove plugin"
          busy={delPluginM.isPending}
          label={
            <>
              remove plugin{' '}
              <span className="accent">
                {plugins.find((p) => p.id === confirmDelPlugin)?.name ?? confirmDelPlugin}
              </span>{' '}
              from the codemode bundle?
            </>
          }
          onConfirm={() => delPluginM.mutate({ id: confirmDelPlugin })}
          onCancel={() => setConfirmDelPlugin(null)}
        />
      )}
      <SectionBar
        title="skills"
        count={skills.length}
        right={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Btn
              variant="ghost"
              disabled={syncM.isPending}
              onClick={() => syncM.mutate(undefined)}
            >
              {syncM.isPending ? 'syncing…' : 'sync from registry'}
            </Btn>
            <Btn variant="ghost" onClick={() => setAddSkillOpen((v) => !v)}>
              {addSkillOpen ? 'cancel' : '+ add skill'}
            </Btn>
          </span>
        }
      />
      {addSkillOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 200px 1fr auto',
            gap: 8,
            padding: '10px 18px',
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--line-1)',
            alignItems: 'center',
          }}
        >
          <input
            style={v3InputStyle}
            placeholder="id (slug)"
            value={skillForm.id}
            onChange={(e) => setSkillForm({ ...skillForm, id: e.target.value })}
          />
          <input
            style={v3InputStyle}
            placeholder="name"
            value={skillForm.name}
            onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
          />
          <input
            style={v3InputStyle}
            placeholder="description (optional)"
            value={skillForm.description}
            onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })}
          />
          <Btn
            variant="primary"
            disabled={!skillForm.id.trim() || addSkillM.isPending}
            onClick={() => addSkillM.mutate(skillForm)}
          >
            {addSkillM.isPending ? 'adding…' : 'add'}
          </Btn>
        </div>
      )}
      <Panel>
        <PanelHead
          title="Allowed skills"
          count={`${skills.filter((s) => s.enabled).length} enabled · ${skills.length} total`}
        />
        {skillsQ.isLoading ? (
          <EmptyInline pad>loading /api/admin/codemode/skills…</EmptyInline>
        ) : skillsQ.isError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/codemode/skills</span>
          </Banner>
        ) : skills.length === 0 ? (
          <EmptyInline pad>no skills registered</EmptyInline>
        ) : (
          <Dt<CodeModeSkillRow> columns={skillCols} rows={skills} rowKey={(r) => r.id} />
        )}
      </Panel>

      <SectionBar
        title="plugins"
        count={plugins.length}
        right={
          <Btn variant="ghost" onClick={() => setAddPluginOpen((v) => !v)}>
            {addPluginOpen ? 'cancel' : '+ install plugin'}
          </Btn>
        }
      />
      {addPluginOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 200px 1fr auto',
            gap: 8,
            padding: '10px 18px',
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--line-1)',
            alignItems: 'center',
          }}
        >
          <input
            style={v3InputStyle}
            placeholder="id (slug)"
            value={pluginForm.id}
            onChange={(e) => setPluginForm({ ...pluginForm, id: e.target.value })}
          />
          <input
            style={v3InputStyle}
            placeholder="name"
            value={pluginForm.name}
            onChange={(e) => setPluginForm({ ...pluginForm, name: e.target.value })}
          />
          <input
            style={v3InputStyle}
            placeholder="version (optional)"
            value={pluginForm.version}
            onChange={(e) => setPluginForm({ ...pluginForm, version: e.target.value })}
          />
          <Btn
            variant="primary"
            disabled={!pluginForm.id.trim() || addPluginM.isPending}
            onClick={() => addPluginM.mutate(pluginForm)}
          >
            {addPluginM.isPending ? 'installing…' : 'install'}
          </Btn>
        </div>
      )}
      <Panel>
        <PanelHead
          title="Installed plugins"
          count={`${plugins.filter((p) => p.enabled).length} enabled · ${plugins.length} total`}
        />
        {pluginsQ.isLoading ? (
          <EmptyInline pad>loading /api/admin/codemode/plugins…</EmptyInline>
        ) : pluginsQ.isError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/codemode/plugins</span>
          </Banner>
        ) : plugins.length === 0 ? (
          <EmptyInline pad>no plugins installed</EmptyInline>
        ) : (
          <Dt<CodeModePluginRow> columns={pluginCols} rows={plugins} rowKey={(r) => r.id} />
        )}
      </Panel>
    </>
  )
}
