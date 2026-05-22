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

const SOURCE_LABELS: Record<string, string> = {
  'built-in': 'Built-in',
  userSettings: 'User',
  projectSettings: 'Project',
  policySettings: 'Managed',
  localSettings: 'Local',
  flagSettings: 'Flag',
  plugin: 'Plugin',
};

function isReadOnly(source: string): boolean {
  return source === 'built-in' || source === 'plugin';
}

interface AgentDetailPaneProps {
  agent: AgentEntry;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const AgentDetailPane: React.FC<AgentDetailPaneProps> = ({
  agent,
  onBack,
  onEdit,
  onDelete,
}) => {
  // Initial collapsed state lets the prompt body stay tidy when it's a
  // long file — common for built-in agents that ship their full system
  // prompt in the detail pane preview.
  const [expanded, setExpanded] = useState(false);
  const readonly = isReadOnly(agent.source);
  const sourceLabel = SOURCE_LABELS[agent.source] ?? agent.source;

  return (
    <div
      data-testid="agent-detail-pane"
      style={{
        fontFamily: MONO,
        color: TEXT,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header row: Back + name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.7ch',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            background: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            padding: '4px 10px',
            fontFamily: MONO,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: TEXT,
          }}
        >
          {agent.id}
        </span>
        <ScopeBadge label={sourceLabel} />
      </div>

      {/* Description */}
      {agent.description && (
        <div style={{ fontSize: 12, color: DIM }}>{agent.description}</div>
      )}

      {/* Chip strip: model + tools + plugin id */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5ch',
          alignItems: 'center',
        }}
      >
        {agent.model && <Chip label={agent.model} />}
        {agent.plugin && <Chip label={agent.plugin} dim />}
        {agent.tools && agent.tools.length > 0 && (
          <>
            <span style={{ fontSize: 10, color: DIM, marginRight: '0.3ch' }}>
              tools:
            </span>
            {agent.tools.map((t) => (
              <Chip key={t} label={t} dim />
            ))}
          </>
        )}
      </div>

      {/* System prompt body — collapsible */}
      {agent.systemPrompt && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            background: BG_INSET,
            padding: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: ACCENT,
              fontFamily: MONO,
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
              marginBottom: 6,
            }}
          >
            {expanded ? '▼' : '▶'} System prompt
          </button>
          <div
            style={{
              fontSize: 11,
              color: TEXT,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: expanded ? 'none' : 120,
              overflow: 'hidden',
              fontFamily: MONO,
            }}
          >
            {agent.systemPrompt}
          </div>
        </div>
      )}

      {/* Action buttons (custom-only) */}
      {!readonly && (
        <div
          style={{
            display: 'flex',
            gap: '0.7ch',
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onEdit}
            style={{
              background: 'transparent',
              border: `1px solid ${ACCENT}`,
              color: ACCENT,
              borderRadius: 4,
              padding: '6px 14px',
              fontFamily: MONO,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={{
              background: 'transparent',
              border: `1px solid ${ERROR}`,
              color: ERROR,
              borderRadius: 4,
              padding: '6px 14px',
              fontFamily: MONO,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      )}
      {readonly && (
        <div style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }}>
          {agent.source === 'built-in'
            ? 'Built-in agents are read-only.'
            : 'Plugin agents are read-only — edit the plugin source.'}
        </div>
      )}
    </div>
  );
};

const ScopeBadge: React.FC<{ label: string }> = ({ label }) => (
  <span
    style={{
      fontSize: 10,
      fontFamily: MONO,
      color: ACCENT,
      border: `1px solid ${ACCENT}`,
      borderRadius: 3,
      padding: '1px 6px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    {label}
  </span>
);

const Chip: React.FC<{ label: string; dim?: boolean }> = ({ label, dim }) => (
  <span
    style={{
      fontSize: 10,
      fontFamily: MONO,
      color: dim ? DIM : ACCENT,
      border: `1px solid ${dim ? BORDER : 'rgba(88,166,255,0.4)'}`,
      borderRadius: 3,
      padding: '1px 6px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    {label}
  </span>
);

export default AgentDetailPane;
