import React, { useCallback, useState } from 'react';

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const SUCCESS = 'var(--cm-success, #3fb950)';

// ── Shared modal shell ──────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, onClose, children, width = 440 }) => (
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
      backgroundColor: 'rgba(0,0,0,0.5)',
      fontFamily: MONO,
      padding: 16,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
  >
    <div
      style={{
        maxWidth: width,
        width: '100%',
        backgroundColor: BG,
        color: TEXT,
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
      <div style={{ marginTop: 14, fontSize: 11, color: DIM }}>esc to close</div>
    </div>
  </div>
);

// ── Toggle row ──────────────────────────────────────────────────────

const ToggleRow: React.FC<{
  label: string;
  description: string;
  active: boolean;
  onToggle: () => void;
}> = ({ label, description, active, onToggle }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 0',
      borderBottom: `1px solid ${BORDER}`,
    }}
  >
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: TEXT }}>{label}</div>
      <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{description}</div>
    </div>
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: 'none',
        cursor: 'pointer',
        backgroundColor: active ? SUCCESS : BORDER,
        position: 'relative',
        transition: 'background-color 150ms',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: active ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: '#fff',
          transition: 'left 150ms',
        }}
      />
    </button>
  </div>
);

// ── /compact ────────────────────────────────────────────────────────

export const CompactModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const handleCompact = useCallback(() => {
    onSend('/compact');
    onClose();
  }, [onSend, onClose]);

  return (
    <ModalShell title="/compact" onClose={onClose}>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 12 }}>
        Summarize conversation history to free up context window space.
        Your current context will be compressed into a concise summary.
      </div>
      <button
        type="button"
        autoFocus
        onClick={handleCompact}
        style={{
          padding: '8px 16px',
          backgroundColor: ACCENT,
          color: 'var(--cm-bg, #0d1117)',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Compact Now
      </button>
    </ModalShell>
  );
};

// ── /debug ──────────────────────────────────────────────────────────

export const DebugModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const [enabled, setEnabled] = useState(false);
  return (
    <ModalShell title="/debug" onClose={onClose}>
      <ToggleRow
        label="Debug Mode"
        description="Enable detailed logging for troubleshooting"
        active={enabled}
        onToggle={() => {
          const next = !enabled;
          setEnabled(next);
          onSend(next ? '/debug on' : '/debug off');
        }}
      />
    </ModalShell>
  );
};

// ── /hooks ──────────────────────────────────────────────────────────

export const HooksModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => (
  <ModalShell title="/hooks" onClose={onClose}>
    <div style={{ fontSize: 12, color: DIM, marginBottom: 12 }}>
      Lifecycle hooks automate actions on events like pre-commit, post-tool, session-start.
      Hooks are configured in your OPENAGENTIC.md or settings file.
    </div>
    <button
      type="button"
      autoFocus
      onClick={() => { onSend('/hooks'); onClose(); }}
      style={{
        padding: '8px 16px',
        backgroundColor: ACCENT,
        color: 'var(--cm-bg, #0d1117)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      Show Hooks
    </button>
  </ModalShell>
);

// ── /memory ─────────────────────────────────────────────────────────

export const MemoryModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const [text, setText] = useState('');
  return (
    <ModalShell title="/memory" onClose={onClose} width={520}>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>
        View or add to persistent memory. Memory persists across sessions.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          autoFocus
          onClick={() => { onSend('/memory'); onClose(); }}
          style={{
            padding: '6px 14px',
            backgroundColor: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          View Memory
        </button>
        <button
          type="button"
          onClick={() => { onSend('/memory edit'); onClose(); }}
          style={{
            padding: '6px 14px',
            backgroundColor: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          Edit OPENAGENTIC.md
        </button>
      </div>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Add to memory:</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type something to remember…"
        rows={3}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 12,
          backgroundColor: 'var(--cm-bg, #0d1117)',
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 4,
          resize: 'vertical',
          outline: 'none',
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (text.trim()) {
            onSend(`# ${text.trim()}`);
            onClose();
          }
        }}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          backgroundColor: text.trim() ? ACCENT : BORDER,
          color: text.trim() ? 'var(--cm-bg, #0d1117)' : DIM,
          border: 'none',
          borderRadius: 4,
          cursor: text.trim() ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Save to Memory
      </button>
    </ModalShell>
  );
};

// ── /plan ───────────────────────────────────────────────────────────

export const PlanModal: React.FC<{
  currentMode: string;
  onClose: () => void;
  onSend: (cmd: string) => void;
  onCycleMode: () => void;
}> = ({ currentMode, onClose, onSend, onCycleMode }) => {
  const isPlanMode = currentMode === 'plan';
  return (
    <ModalShell title="/plan" onClose={onClose}>
      <ToggleRow
        label="Plan Mode"
        description="When enabled, the agent proposes plans for approval before executing"
        active={isPlanMode}
        onToggle={() => {
          if (!isPlanMode) {
            // Cycle to plan mode
            while (currentMode !== 'plan') onCycleMode();
          }
          onSend(isPlanMode ? '/plan off' : '/plan');
          onClose();
        }}
      />
      <div style={{ marginTop: 10, fontSize: 12, color: DIM }}>
        In plan mode, tool calls are proposed for your review before execution.
        Press Shift+Tab to cycle permission modes.
      </div>
    </ModalShell>
  );
};

// ── /resume ─────────────────────────────────────────────────────────

export const ResumeModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => (
  <ModalShell title="/resume" onClose={onClose}>
    <div style={{ fontSize: 12, color: DIM, marginBottom: 12 }}>
      Resume a previous conversation. OpenAgentic will list recent sessions
      you can continue from where you left off.
    </div>
    <button
      type="button"
      autoFocus
      onClick={() => { onSend('/resume'); onClose(); }}
      style={{
        padding: '8px 16px',
        backgroundColor: ACCENT,
        color: 'var(--cm-bg, #0d1117)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      List Previous Sessions
    </button>
  </ModalShell>
);

// ── /save ───────────────────────────────────────────────────────────

export const SaveModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => (
  <ModalShell title="/save" onClose={onClose}>
    <div style={{ fontSize: 12, color: DIM, marginBottom: 12 }}>
      Save the current conversation to a file for later reference or sharing.
    </div>
    <button
      type="button"
      autoFocus
      onClick={() => { onSend('/save'); onClose(); }}
      style={{
        padding: '8px 16px',
        backgroundColor: ACCENT,
        color: 'var(--cm-bg, #0d1117)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      Save Conversation
    </button>
  </ModalShell>
);

// ── /system ─────────────────────────────────────────────────────────

export const SystemPromptModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const [text, setText] = useState('');
  return (
    <ModalShell title="/system" onClose={onClose} width={520}>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>
        View or modify the system prompt for this session.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          autoFocus
          onClick={() => { onSend('/system'); onClose(); }}
          style={{
            padding: '6px 14px',
            backgroundColor: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          View Current
        </button>
      </div>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Set system prompt:</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter a custom system prompt…"
        rows={4}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 12,
          backgroundColor: 'var(--cm-bg, #0d1117)',
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 4,
          resize: 'vertical',
          outline: 'none',
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (text.trim()) {
            onSend(`/system ${text.trim()}`);
            onClose();
          }
        }}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          backgroundColor: text.trim() ? ACCENT : BORDER,
          color: text.trim() ? 'var(--cm-bg, #0d1117)' : DIM,
          border: 'none',
          borderRadius: 4,
          cursor: text.trim() ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Apply System Prompt
      </button>
    </ModalShell>
  );
};

// ── /task ───────────────────────────────────────────────────────────

export const TaskModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const [desc, setDesc] = useState('');
  return (
    <ModalShell title="/task" onClose={onClose} width={480}>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 8 }}>
        Create and manage background tasks. Tasks run independently and
        can be monitored from the transcript.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          autoFocus
          onClick={() => { onSend('/tasks'); onClose(); }}
          style={{
            padding: '6px 14px',
            backgroundColor: 'transparent',
            border: `1px solid ${BORDER}`,
            color: TEXT,
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          List Tasks
        </button>
      </div>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Create new task:</div>
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Task description…"
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 12,
          backgroundColor: 'var(--cm-bg, #0d1117)',
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 4,
          outline: 'none',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && desc.trim()) {
            onSend(`/task ${desc.trim()}`);
            onClose();
          }
        }}
      />
      <button
        type="button"
        disabled={!desc.trim()}
        onClick={() => {
          if (desc.trim()) {
            onSend(`/task ${desc.trim()}`);
            onClose();
          }
        }}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          backgroundColor: desc.trim() ? ACCENT : BORDER,
          color: desc.trim() ? 'var(--cm-bg, #0d1117)' : DIM,
          border: 'none',
          borderRadius: 4,
          cursor: desc.trim() ? 'pointer' : 'default',
          fontFamily: 'inherit',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Create Task
      </button>
    </ModalShell>
  );
};

// ── /version ────────────────────────────────────────────────────────

export const VersionModal: React.FC<{
  version: string;
  model: string;
  permissionMode: string;
  sessionId: string;
  onClose: () => void;
}> = ({ version, model, permissionMode, sessionId, onClose }) => (
  <ModalShell title="/version" onClose={onClose}>
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="OpenAgentic" value={version || '(unknown)'} />
      <Row label="Model" value={model || '(default)'} />
      <Row label="Permission Mode" value={permissionMode} />
      <Row label="Session" value={sessionId?.slice(0, 12) || '(none)'} />
      <Row label="Platform" value="OpenAgentic CodeMode" />
    </div>
  </ModalShell>
);

// ── /status, /stats ─────────────────────────────────────────────────

export const StatusModal: React.FC<{
  model: string;
  permissionMode: string;
  sessionId: string;
  contextTokens: number | undefined;
  totalOutputTokens: number;
  totalCostUsd: number;
  lastTurnMs: number | undefined;
  version: string;
  toolCount: number;
  mcpCount: number;
  onClose: () => void;
}> = ({ model, permissionMode, sessionId, contextTokens, totalOutputTokens, totalCostUsd, lastTurnMs, version, toolCount, mcpCount, onClose }) => (
  <ModalShell title="/status" onClose={onClose}>
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="Model" value={model || '(default)'} />
      <Row label="Permission Mode" value={permissionMode} />
      <Row label="Session" value={sessionId?.slice(0, 12) || '(none)'} />
      <Row label="Context" value={contextTokens != null ? `${contextTokens.toLocaleString()} tokens` : '—'} />
      <Row label="Output Tokens" value={totalOutputTokens > 0 ? totalOutputTokens.toLocaleString() : '—'} />
      <Row label="Cost" value={totalCostUsd > 0 ? `$${totalCostUsd.toFixed(4)}` : '—'} />
      <Row label="Last Turn" value={typeof lastTurnMs === 'number' ? `${(lastTurnMs / 1000).toFixed(1)}s` : '—'} />
      <Row label="Tools" value={`${toolCount} available`} />
      <Row label="MCP Servers" value={`${mcpCount} connected`} />
      <Row label="Version" value={version || '(unknown)'} />
    </div>
  </ModalShell>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: '1ch' }}>
    <span style={{ color: DIM, width: '16ch', flexShrink: 0 }}>{label}</span>
    <span style={{ color: ACCENT }}>{value}</span>
  </div>
);
