import React, { useState } from 'react';
import type { AgentEntry } from './AgentsPicker';

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const BG_INSET = 'var(--cm-bg-tertiary, #0d1117)';

export interface AgentEditorPayload {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
  scope: 'user' | 'project';
}

interface AgentEditorProps {
  mode: 'create' | 'edit';
  existing?: AgentEntry;
  /** Called with the collected payload + whether this is a create (true)
   * or update (false). May reject; the editor renders the message. */
  onSave: (payload: AgentEditorPayload, isCreate: boolean) => Promise<void>;
  onCancel: () => void;
}

/** Map a settings source bucket → editor scope.
 * Both 'localSettings' and 'projectSettings' map to 'project' so the UI
 * doesn't expose the distinction (settings/managed vs settings/project). */
function sourceToScope(source: string | undefined): 'user' | 'project' {
  if (source === 'projectSettings' || source === 'localSettings') return 'project';
  return 'user';
}

export const AgentEditor: React.FC<AgentEditorProps> = ({
  mode,
  existing,
  onSave,
  onCancel,
}) => {
  // Pre-fill from existing in edit mode; otherwise start blank. Tools
  // serialize as a comma-separated string (same shape as the frontmatter
  // `tools:` field) so the user can type Bash, Read, Grep without
  // hunting a multi-select widget.
  const [name, setName] = useState(existing?.id ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [tools, setTools] = useState((existing?.tools ?? []).join(', '));
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [scope, setScope] = useState<'user' | 'project'>(
    sourceToScope(existing?.source),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = mode === 'create';

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    const toolsArr = tools
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const payload: AgentEditorPayload = {
      name: name.trim(),
      description: description.trim(),
      systemPrompt,
      scope,
    };
    if (model.trim().length > 0) payload.model = model.trim();
    if (toolsArr.length > 0) payload.tools = toolsArr;

    try {
      await onSave(payload, isCreate);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="agent-editor"
      style={{
        fontFamily: MONO,
        color: TEXT,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
        {isCreate ? 'New Agent' : `Edit ${existing?.id ?? ''}`}
      </div>

      <Field label="Name" id="agent-name">
        <input
          id="agent-name"
          type="text"
          value={name}
          readOnly={!isCreate}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle(!isCreate)}
        />
      </Field>

      <Field label="Description" id="agent-description">
        <input
          id="agent-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle(false)}
        />
      </Field>

      <Field label="Model" id="agent-model">
        <input
          id="agent-model"
          type="text"
          value={model}
          placeholder="(inherit)"
          onChange={(e) => setModel(e.target.value)}
          style={inputStyle(false)}
        />
      </Field>

      <Field label="Tools" id="agent-tools" hint="comma-separated, e.g. Bash, Read, Grep">
        <input
          id="agent-tools"
          type="text"
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          style={inputStyle(false)}
        />
      </Field>

      <Field label="System prompt" id="agent-system-prompt">
        <textarea
          id="agent-system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          style={{
            ...inputStyle(false),
            resize: 'vertical',
            fontFamily: MONO,
            minHeight: 100,
          }}
        />
      </Field>

      {isCreate && (
        <div style={{ display: 'flex', gap: '1ch', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: DIM }}>Scope:</span>
          <label style={{ fontSize: 11, color: TEXT, display: 'flex', alignItems: 'center', gap: '0.4ch' }}>
            <input
              type="radio"
              name="agent-scope"
              checked={scope === 'user'}
              onChange={() => setScope('user')}
            />
            User
          </label>
          <label style={{ fontSize: 11, color: TEXT, display: 'flex', alignItems: 'center', gap: '0.4ch' }}>
            <input
              type="radio"
              name="agent-scope"
              checked={scope === 'project'}
              onChange={() => setScope('project')}
            />
            Project
          </label>
        </div>
      )}

      {error && (
        <div
          style={{
            color: ERROR,
            fontSize: 11,
            border: `1px solid ${ERROR}`,
            borderRadius: 4,
            padding: '6px 10px',
            background: BG_INSET,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.7ch', marginTop: 4 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            background: 'transparent',
            border: `1px solid ${ACCENT}`,
            color: ACCENT,
            borderRadius: 4,
            padding: '6px 14px',
            fontFamily: MONO,
            fontSize: 12,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            padding: '6px 14px',
            fontFamily: MONO,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

function inputStyle(readonly: boolean): React.CSSProperties {
  return {
    background: BG_INSET,
    border: `1px solid ${BORDER}`,
    color: readonly ? DIM : TEXT,
    borderRadius: 4,
    padding: '6px 10px',
    fontFamily: MONO,
    fontSize: 12,
    width: '100%',
    boxSizing: 'border-box',
  };
}

const Field: React.FC<{
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, id, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <label htmlFor={id} style={{ fontSize: 11, color: DIM }}>
      {label}
      {hint && (
        <span style={{ marginLeft: '0.7ch', fontStyle: 'italic', fontSize: 10 }}>
          {hint}
        </span>
      )}
    </label>
    {children}
  </div>
);

export default AgentEditor;
