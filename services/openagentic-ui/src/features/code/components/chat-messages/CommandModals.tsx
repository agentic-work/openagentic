import React, { useCallback, useEffect, useState } from 'react';
import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';
import { SLASH_COMMANDS, type SlashCommand, type SlashCommandPriority } from '../../slashCommands';

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BG_DEEP = 'var(--cm-bg, #0d1117)';
const BORDER = 'var(--cm-border, #30363d)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR = 'var(--cm-error, #f85149)';

// ── Document-level Esc handler ──────────────────────────────────────
//
// The dialog's onKeyDown only fires while the dialog is in the focus
// path; the floating composer's textarea is the default focus owner
// and swallows Escape before it bubbles. Pinning a document-level
// keydown listener bypasses that — scoped to mount/unmount of each
// modal so multiple stacked listeners don't leak. Captured in the
// capture phase (third arg = true) so it preempts other handlers
// that might call stopPropagation on Escape.
//
// EXPORTED for shared use by RichModals.tsx so the same fix applies
// across both modal families.
export function useEscToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

// ── Shared modal shell ──────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, onClose, children, width = 440 }) => {
  // Document-level Esc (see hook docstring).
  useEscToClose(onClose);
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
        backgroundColor: 'rgba(0,0,0,0.5)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
};

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
//
// The TUI's /memory command is multi-scope (project / user / managed);
// the codemode UI handles the two scopes most users actually edit:
//   - project (./OPENAGENTIC.md)
//   - user    (~/.openagentic/OPENAGENTIC.md)
//
// Reads/writes go via daemon RPCs (`get_memory` / `set_memory`) so the
// browser doesn't need pod filesystem access. The textarea reflects the
// daemon's response; Save sends the in-progress text via `set_memory`
// and updates the "original" baseline so subsequent edits dirty again.
// Empty-state ("file doesn't exist yet") is treated identically to
// "file is empty" — both render an editable textarea with a placeholder
// hint, and the first Save creates the file.
// ───────────────────────────────────────────────────────────────────

interface MemoryGetResult {
  scope: 'project' | 'user';
  path: string;
  content: string;
  exists: boolean;
}

export const MemoryModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend: _onSend }) => {
  const rpc = useDaemonRPCContext();
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memPath, setMemPath] = useState<string>('');
  const [exists, setExists] = useState<boolean>(false);
  const [content, setContent] = useState<string>('');
  const [original, setOriginal] = useState<string>('');

  // Load memory whenever scope changes (or on mount).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    rpc
      .call<MemoryGetResult>('get_memory', { scope })
      .then((res) => {
        if (cancelled) return;
        setMemPath(res.path);
        setExists(res.exists);
        setContent(res.content);
        setOriginal(res.content);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, scope]);

  const dirty = content !== original;

  const handleSave = useCallback(() => {
    setSaving(true);
    setError(null);
    rpc
      .call<{ scope: string; path: string; bytesWritten: number }>('set_memory', {
        scope,
        content,
      })
      .then((res) => {
        setOriginal(content);
        setExists(true);
        setSaving(false);
        setMemPath(res.path);
      })
      .catch((err: Error) => {
        setError(err.message);
        setSaving(false);
      });
  }, [rpc, scope, content]);

  // TUI parity (tui-memory.txt): the picker exposes two automation
  // toggles above the editor — Auto-memory (default on) and Auto-dream
  // (default off, "never" in the TUI). Codemode v1 surfaces them as
  // localStorage-backed toggles; the daemon-side wiring (auto-memory
  // injection on each turn) is a follow-up task. Until that lands these
  // are advisory toggles that record the user's preference.
  const [autoMemory, setAutoMemory] = useState<boolean>(() => {
    try { return localStorage.getItem('cm-auto-memory') !== 'off'; }
    catch { return true; }
  });
  const [autoDream, setAutoDream] = useState<boolean>(() => {
    try { return localStorage.getItem('cm-auto-dream') === 'on'; }
    catch { return false; }
  });

  return (
    <ModalShell title="/memory" onClose={onClose} width={620}>
      {/* Automation toggles — match the TUI's "Auto-memory: on / Auto-dream:
          off · never" header rows in the /memory picker. */}
      <div style={{ marginBottom: 10 }}>
        <ToggleRow
          label="Auto-memory"
          description="Inject persistent memory into each turn automatically"
          active={autoMemory}
          onToggle={() => {
            const next = !autoMemory;
            setAutoMemory(next);
            try { localStorage.setItem('cm-auto-memory', next ? 'on' : 'off'); }
            catch { /* quota */ }
          }}
        />
        <ToggleRow
          label="Auto-dream"
          description="Periodically synthesize new memory entries from recent turns"
          active={autoDream}
          onToggle={() => {
            const next = !autoDream;
            setAutoDream(next);
            try { localStorage.setItem('cm-auto-dream', next ? 'on' : 'off'); }
            catch { /* quota */ }
          }}
        />
      </div>

      <div
        data-testid="memory-scope-tabs"
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 10,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {(['project', 'user'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            data-scope={s}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontFamily: 'inherit',
              background: 'none',
              border: 'none',
              color: scope === s ? ACCENT : DIM,
              borderBottom: scope === s ? `2px solid ${ACCENT}` : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {s === 'project' ? 'Project (./OPENAGENTIC.md)' : 'User (~/.openagentic/OPENAGENTIC.md)'}
          </button>
        ))}
      </div>

      {memPath && (
        <div
          data-testid="memory-path"
          style={{
            fontSize: 10,
            color: DIM,
            marginBottom: 8,
            fontFamily: MONO,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {memPath}
          {!exists && (
            <span style={{ color: SUCCESS, marginLeft: 8 }}>
              (will be created on save)
            </span>
          )}
        </div>
      )}

      {loading && (
        <div
          data-testid="memory-loading"
          style={{ textAlign: 'center', padding: '20px 0', color: DIM, fontSize: 12 }}
        >
          Loading memory…
        </div>
      )}

      {error && (
        <div
          data-testid="memory-error"
          style={{ color: ERROR, fontSize: 12, padding: '8px 0' }}
        >
          {error}
        </div>
      )}

      {!loading && (
        <textarea
          data-testid="memory-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            exists
              ? ''
              : 'No memory file yet. Type instructions for OpenAgentic here, then click Save.'
          }
          rows={14}
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            fontFamily: MONO,
            fontSize: 12,
            backgroundColor: BG_DEEP,
            color: TEXT,
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            resize: 'vertical',
            outline: 'none',
            minHeight: 200,
          }}
        />
      )}

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          disabled={!dirty || saving || loading}
          onClick={handleSave}
          data-testid="memory-save"
          style={{
            padding: '6px 14px',
            backgroundColor: dirty && !saving ? ACCENT : BORDER,
            color: dirty && !saving ? BG_DEEP : DIM,
            border: 'none',
            borderRadius: 4,
            cursor: dirty && !saving ? 'pointer' : 'default',
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {saving ? 'Saving…' : `Save ${scope === 'project' ? 'Project' : 'User'} Memory`}
        </button>
        {dirty && !saving && (
          <span style={{ fontSize: 11, color: DIM }}>unsaved changes</span>
        )}
      </div>
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
//
// Lists prior persisted sessions for the current project via the
// `list_sessions` daemon RPC. The TUI's /resume picker actually
// performs the resume by re-spawning openagentic with --resume <id>;
// the codemode UI v1 emits the `/resume <id>` slash for the daemon
// to handle (mirrors how /skills + /plugins picker rows dispatch).
//
// Empty state is normal for a fresh pod or first session — show a
// helpful empty-state message instead of a blank pane.
// ───────────────────────────────────────────────────────────────────

interface ResumableSession {
  sessionId: string;
  summary: string;
  lastModified: number;
  createdAt?: number;
  cwd?: string;
}

interface ListSessionsResult {
  sessions: ResumableSession[];
}

function formatRelative(epochMs: number): string {
  const d = Date.now() - epochMs;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

export const ResumeModal: React.FC<{
  onClose: () => void;
  onSend: (cmd: string) => void;
}> = ({ onClose, onSend }) => {
  const rpc = useDaemonRPCContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ResumableSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    rpc
      .call<ListSessionsResult>('list_sessions', { limit: 20 })
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions ?? []);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  return (
    <ModalShell title="/resume" onClose={onClose} width={580}>
      <div style={{ fontSize: 12, color: DIM, marginBottom: 10 }}>
        Resume a previous conversation in this workspace. Sessions are saved
        automatically on exit; the most recent {sessions.length || 'few'} appear here.
      </div>

      {loading && (
        <div
          data-testid="resume-loading"
          style={{ textAlign: 'center', padding: '24px 0', color: DIM, fontSize: 12 }}
        >
          Loading sessions…
        </div>
      )}

      {error && (
        <div
          data-testid="resume-error"
          style={{ color: ERROR, fontSize: 12, padding: '8px 0' }}
        >
          {error}
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div
          data-testid="resume-empty"
          style={{
            padding: '20px 12px',
            backgroundColor: BG_DEEP,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            textAlign: 'center',
            color: DIM,
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 6, color: TEXT }}>No sessions yet</div>
          <div>Sessions are saved automatically when you /save or exit a chat.</div>
          <div style={{ marginTop: 4 }}>Send a few messages, run /save, then come back here.</div>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div
          data-testid="resume-list"
          style={{
            maxHeight: 380,
            overflowY: 'auto',
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
          }}
        >
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              type="button"
              data-testid={`resume-row-${s.sessionId}`}
              onClick={() => {
                onSend(`/resume ${s.sessionId}`);
                onClose();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${BORDER}33`,
                color: TEXT,
                fontFamily: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = BG_DEEP;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: ACCENT, fontFamily: MONO, fontSize: 11 }}>
                  {s.sessionId.slice(0, 12)}
                </span>
                <span style={{ color: DIM, fontSize: 10 }}>
                  {formatRelative(s.lastModified)}
                </span>
              </div>
              <div
                style={{
                  color: TEXT,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.summary}
              </div>
              {s.cwd && (
                <div style={{ fontSize: 10, color: DIM, marginTop: 2, fontFamily: MONO }}>
                  {s.cwd}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
};

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

// ── /help ───────────────────────────────────────────────────────────
//
// Lists the SLASH_COMMANDS registry grouped by priority. Phase 0
// removed /help from the api slash-dispatcher (only /exit + /clear
// remain) and the daemon's headless slash dispatch isn't yet wired
// in remote-session mode (Phase 1, in companion repo). Until that
// lands, the canonical command list lives client-side here.
//
// Captured 2026-05-02 in tui-vs-codemode-diff.report.md:
//   /help → empty assistant turn in codemode (high severity).
//
// The TUI's /help has tabbed "general / commands / custom-commands"
// view — we ship the commands tab here (the most useful one) and
// elide the others until the daemon-side path lands.

const PRIORITY_LABELS: Record<SlashCommandPriority, string> = {
  p0: 'Essentials',
  p1: 'Common',
  p2: 'Less common',
  p3: 'Debug · feature-gated',
};

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // Group visible (non-hidden) commands by priority. Within each
  // priority bucket, slashCommands.ts already keeps entries
  // alphabetical, so we just preserve insertion order.
  const groups: Array<{ priority: SlashCommandPriority; cmds: SlashCommand[] }> = (
    ['p0', 'p1', 'p2', 'p3'] as SlashCommandPriority[]
  ).map((priority) => ({
    priority,
    cmds: SLASH_COMMANDS.filter((c) => !c.hidden && c.priority === priority),
  })).filter((g) => g.cmds.length > 0);

  return (
    <ModalShell title="/help" onClose={onClose} width={560}>
      <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: DIM }}>
          {SLASH_COMMANDS.filter((c) => !c.hidden).length} commands · type{' '}
          <span style={{ color: ACCENT }}>/</span> in the composer to filter.
        </div>
        {groups.map(({ priority, cmds }) => (
          <div key={priority} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: DIM,
              }}
            >
              {PRIORITY_LABELS[priority]} ({cmds.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {cmds.map((c) => (
                <HelpRow key={c.name} cmd={c} />
              ))}
            </div>
          </div>
        ))}
        <div style={{ color: DIM, fontSize: 11, paddingTop: 4, borderTop: `1px solid ${BORDER}` }}>
          Press <span style={{ color: TEXT }}>Esc</span> to close ·{' '}
          <span style={{ color: TEXT }}>Tab</span> to autocomplete in palette ·{' '}
          <span style={{ color: TEXT }}>Shift+Enter</span> for new line.
        </div>
      </div>
    </ModalShell>
  );
};

const HelpRow: React.FC<{ cmd: SlashCommand }> = ({ cmd }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(14ch, max-content) 1fr',
      gap: '1.5ch',
      alignItems: 'baseline',
    }}
  >
    <span style={{ color: ACCENT, fontWeight: 600 }}>
      /{cmd.name}
      {cmd.args ? <span style={{ color: DIM, fontWeight: 400 }}> {cmd.args}</span> : null}
    </span>
    <span style={{ color: TEXT }}>{cmd.description}</span>
  </div>
);
