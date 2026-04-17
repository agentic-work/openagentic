import React, { useState } from 'react';

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BG_DEEP = 'var(--cm-bg, #0d1117)';
const BORDER = 'var(--cm-border, #30363d)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const WARNING = 'var(--cm-warning, #d29922)';
const ERROR = 'var(--cm-error, #f85149)';

interface StatusModalProps {
  model: string;
  permissionMode: string;
  sessionId: string;
  contextTokens: number | undefined;
  contextLimit: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  version: string;
  cwd: string;
  toolCount: number;
  mcpServers: Array<{ name: string; status: string }>;
  agents: string[];
  plugins: string[];
  skills: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
}

type TabId = 'status' | 'config' | 'usage';

export const StatusModal: React.FC<StatusModalProps> = (props) => {
  const [tab, setTab] = useState<TabId>('status');
  const tabs: TabId[] = ['status', 'config', 'usage'];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); }
        if (e.key === 'Tab') {
          e.preventDefault();
          setTab((t) => tabs[(tabs.indexOf(t) + 1) % tabs.length]);
        }
      }}
    >
      <div
        style={{
          maxWidth: 580,
          width: '100%',
          maxHeight: '80vh',
          backgroundColor: BG,
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: tab === t ? BG_DEEP : 'transparent',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
                color: tab === t ? ACCENT : DIM,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {tab === 'status' && <StatusTab {...props} />}
          {tab === 'config' && <ConfigTab {...props} />}
          {tab === 'usage' && <UsageTab {...props} />}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${BORDER}`,
            fontSize: 11,
            color: DIM,
          }}
        >
          tab to switch · esc to close
        </div>
      </div>
    </div>
  );
};

// ── Status Tab ───────────────────────────────────────────────────────

const StatusTab: React.FC<StatusModalProps> = (p) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <SectionHeader>Session</SectionHeader>
    <PropRow label="Version" value={p.version || '(unknown)'} />
    <PropRow label="Session ID" value={p.sessionId?.slice(0, 16) || '(none)'} />
    <PropRow label="cwd" value={p.cwd || '/workspace'} />
    <PropRow label="Model" value={p.model || '(default)'} accent />
    <PropRow label="Permission Mode" value={p.permissionMode} />

    <SectionHeader>MCP Servers</SectionHeader>
    {p.mcpServers.length === 0 ? (
      <div style={{ fontSize: 12, color: DIM, padding: '4px 0' }}>no servers connected</div>
    ) : (
      p.mcpServers.map((s) => (
        <div
          key={s.name}
          style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontSize: 12, padding: '2px 0' }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: s.status === 'connected' ? SUCCESS : s.status === 'error' ? ERROR : WARNING,
              flexShrink: 0,
            }}
          />
          <span style={{ color: TEXT }}>{s.name}</span>
          <span style={{ color: DIM, fontSize: 11 }}>{s.status}</span>
        </div>
      ))
    )}

    <SectionHeader>Resources</SectionHeader>
    <PropRow label="Tools" value={`${p.toolCount} available`} />
    <PropRow label="Agents" value={p.agents.length > 0 ? p.agents.join(', ') : 'none'} />
    <PropRow label="Plugins" value={p.plugins.length > 0 ? p.plugins.join(', ') : 'none'} />
    <PropRow label="Skills" value={p.skills.length > 0 ? `${p.skills.length} loaded` : 'none'} />
  </div>
);

// ── Config Tab ───────────────────────────────────────────────────────

const ConfigTab: React.FC<StatusModalProps> = (p) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <SectionHeader>Configuration</SectionHeader>
    <PropRow label="model" value={p.model || '(default)'} accent />
    <PropRow label="permissionMode" value={p.permissionMode} />
    <PropRow label="contextLimit" value={`${p.contextLimit.toLocaleString()} tokens`} />

    <SectionHeader>Actions</SectionHeader>
    <ActionRow label="Change model" onClick={() => { p.onSend('/model'); p.onClose(); }} />
    <ActionRow label="Edit permissions" onClick={() => { p.onSend('/permissions'); p.onClose(); }} />
    <ActionRow label="Manage MCP servers" onClick={() => { p.onSend('/mcp'); p.onClose(); }} />
    <ActionRow label="Edit memory" onClick={() => { p.onSend('/memory edit'); p.onClose(); }} />
    <ActionRow label="View hooks" onClick={() => { p.onSend('/hooks'); p.onClose(); }} />
  </div>
);

// ── Usage Tab ────────────────────────────────────────────────────────

const UsageTab: React.FC<StatusModalProps> = (p) => {
  const contextPct = p.contextTokens != null
    ? Math.min(100, (p.contextTokens / p.contextLimit) * 100)
    : 0;
  const contextColor = contextPct < 50 ? SUCCESS : contextPct < 80 ? WARNING : ERROR;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHeader>Context Window</SectionHeader>
      <UsageBar
        label="Context"
        pct={contextPct}
        detail={p.contextTokens != null ? `${p.contextTokens.toLocaleString()} / ${p.contextLimit.toLocaleString()} tokens` : 'waiting for first turn'}
        color={contextColor}
      />

      <SectionHeader>Session Totals</SectionHeader>
      <PropRow label="Output Tokens" value={p.totalOutputTokens > 0 ? p.totalOutputTokens.toLocaleString() : '—'} />
      <PropRow label="Cost" value={p.totalCostUsd > 0 ? `$${p.totalCostUsd.toFixed(4)}` : '—'} accent />

      <SectionHeader>Actions</SectionHeader>
      <ActionRow label="Compact context" onClick={() => { p.onSend('/compact'); p.onClose(); }} />
    </div>
  );
};

// ── Shared sub-components ────────────────────────────────────────────

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: 11,
      color: DIM,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginTop: 10,
      marginBottom: 2,
      borderBottom: `1px solid ${BORDER}`,
      paddingBottom: 4,
    }}
  >
    {children}
  </div>
);

const PropRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: '1ch', fontSize: 12, padding: '2px 0' }}>
    <span style={{ color: DIM, minWidth: '16ch', flexShrink: 0 }}>{label}</span>
    <span style={{ color: accent ? ACCENT : TEXT, wordBreak: 'break-all' }}>{value}</span>
  </div>
);

const ActionRow: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '6px 10px',
      fontSize: 12,
      fontFamily: 'inherit',
      color: ACCENT,
      backgroundColor: 'transparent',
      border: `1px solid ${BORDER}`,
      borderRadius: 4,
      cursor: 'pointer',
      marginBottom: 4,
    }}
  >
    {label}
  </button>
);

const UsageBar: React.FC<{ label: string; pct: number; detail: string; color: string }> = ({
  label,
  pct,
  detail,
  color,
}) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: TEXT }}>{label}</span>
      <span style={{ color }}>{Math.round(pct)}%</span>
    </div>
    <div style={{ height: 8, borderRadius: 4, backgroundColor: BORDER, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 4, transition: 'width 300ms' }} />
    </div>
    <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>{detail}</div>
  </div>
);
