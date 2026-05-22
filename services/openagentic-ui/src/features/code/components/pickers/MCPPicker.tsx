import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';

// ── Types ───────────────────────────────────────────────────────────

/**
 * MCP entry shape returned by the daemon's `list_mcps` RPC. Mirrors
 * the daemon-side `McpEntry` (see openagentic-cli/src/entrypoints/
 * daemonRequestHandlers.ts:77). Some fields only exist for stdio (command
 * + args) or sse/http (url) — both are optional. `type` and `scope` are
 * declared `string | undefined` upstream so the wire shape never crashes
 * on a server config we haven't seen yet.
 */
export interface McpEntry {
  name: string;
  /** Transport kind: 'stdio' | 'sse' | 'http' | 'sdk' | 'openagentic-proxy' | 'disabled' | ... */
  type?: string;
  /** 'project' | 'user' | 'local' | 'managed' | undefined */
  scope?: string;
  command?: string;
  args?: string[];
  url?: string;
}

interface ListMcpsResult {
  mcps: McpEntry[];
}

interface MCPPickerProps {
  open: boolean;
  onClose: () => void;
}

// ── Design tokens (match SkillsPicker / PluginsPicker) ─────────────

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const SUCCESS = 'var(--cm-success, #56d364)';
const WARN = 'var(--cm-warn, #d29922)';
const SELECTED_BG = 'rgba(88, 166, 255, 0.12)';

// ── Status mapping ──────────────────────────────────────────────────

/**
 * Map a daemon-reported MCP `type` to a status indicator. The daemon's
 * `list_mcps` is config-only — it doesn't probe live connections — so
 * we infer:
 *   - `disabled` → '✗' (red)
 *   - any normal transport (stdio/sse/http/sdk/openagentic-proxy) → '◯'
 *     (configured but live state not known here)
 *   - missing/unknown → '?' (dim)
 *
 * When a future enhancement adds live connection state to list_mcps we
 * can promote configured-and-connected to '●' (green).
 */
function statusFor(type: string | undefined): { glyph: string; color: string; label: string } {
  if (type === 'disabled') return { glyph: '✗', color: ERROR, label: 'disabled' };
  if (
    type === 'stdio' ||
    type === 'sse' ||
    type === 'http' ||
    type === 'sdk' ||
    type === 'openagentic-proxy' ||
    type === 'sse-ide' ||
    type === 'ws-ide'
  ) {
    return { glyph: '◯', color: WARN, label: 'configured' };
  }
  return { glyph: '?', color: DIM, label: 'unknown' };
}

// ── Component ───────────────────────────────────────────────────────

export const MCPPicker: React.FC<MCPPickerProps> = ({ open, onClose }) => {
  // Same gating pattern as SkillsPicker: skip context lookup entirely
  // when closed so test harnesses that mount the chat view without a
  // DaemonRPCContext provider don't explode.
  if (!open) return null;
  return <MCPPickerOpen onClose={onClose} />;
};

const MCPPickerOpen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { call } = useDaemonRPCContext();
  const [mcps, setMcps] = useState<McpEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const requestSeqRef = useRef(0);

  const fetchMcps = useCallback(() => {
    setMcps(null);
    setError(null);
    setSelectedIdx(0);
    const seq = ++requestSeqRef.current;
    call<ListMcpsResult>('list_mcps')
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setMcps(res?.mcps ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
  }, [call]);

  useEffect(() => {
    fetchMcps();
    return () => {
      requestSeqRef.current++;
    };
  }, [fetchMcps]);

  // Sort: stable by name (the daemon order is config-load order which
  // is opaque to the user; alphabetical is more useful for navigation).
  const ordered = useMemo<McpEntry[]>(() => {
    if (!mcps) return [];
    return [...mcps].sort((a, b) => a.name.localeCompare(b.name));
  }, [mcps]);

  // Clamp selection on data change.
  useEffect(() => {
    if (selectedIdx >= ordered.length) {
      setSelectedIdx(ordered.length === 0 ? 0 : ordered.length - 1);
    }
  }, [ordered.length, selectedIdx]);

  // Keyboard handlers — match SkillsPicker. Enter/t/d are no-ops with
  // a TODO marker; the picker's MVP is read-only browse.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(ordered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        // TODO Slice 5 / future: open a details panel showing tools,
        // prompts, last-connected-at, error log entries for this server.
        e.preventDefault();
        onClose();
        return;
      }
      // TODO future: 't' to toggle enabled, 'd' to delete. The daemon
      // would need new RPCs (toggle_mcp, remove_mcp) — track separately
      // so we can ship the read-only picker first.
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, ordered.length]);

  const overlay = (
    <div
      data-testid="mcp-picker"
      role="dialog"
      aria-modal="true"
      aria-label="MCP servers picker"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${BORDER}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7ch' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
              MCP Servers
            </span>
            {mcps && (
              <span style={{ fontSize: 11, color: DIM }}>
                {mcps.length} configured
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: DIM }}>
            <kbd>Esc</kbd> close
          </span>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 12px',
          }}
        >
          {error !== null ? (
            <ErrorState message={error} onRetry={fetchMcps} />
          ) : mcps === null ? (
            <LoadingState />
          ) : ordered.length === 0 ? (
            <EmptyState />
          ) : (
            ordered.map((m, idx) => {
              const selected = idx === selectedIdx;
              const status = statusFor(m.type);
              return (
                <div
                  key={m.name}
                  data-testid={`mcp-row-${idx}`}
                  data-selected={selected ? 'true' : 'false'}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 4,
                    backgroundColor: selected ? SELECTED_BG : 'transparent',
                    borderLeft: selected ? `2px solid ${ACCENT}` : '2px solid transparent',
                    marginBottom: 1,
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7ch' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        color: status.color,
                        fontFamily: MONO,
                        fontSize: 12,
                        width: '1.2ch',
                        display: 'inline-block',
                      }}
                      title={status.label}
                    >
                      {status.glyph}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        color: selected ? ACCENT : TEXT,
                        fontWeight: selected ? 600 : 500,
                      }}
                    >
                      {m.name}
                    </span>
                    {m.type && (
                      <Chip label={m.type} />
                    )}
                    {m.scope && (
                      <Chip label={m.scope} dim />
                    )}
                  </div>
                  <ConnectionDetails entry={m} />
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${BORDER}`,
            fontSize: 10,
            color: DIM,
            display: 'flex',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span>↑↓ navigate · Enter for details · t to toggle · d to delete</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
};

// ── Sub-renderers ──────────────────────────────────────────────────

const Chip: React.FC<{ label: string; dim?: boolean }> = ({ label, dim }) => (
  <span
    style={{
      fontSize: 9,
      fontFamily: MONO,
      color: dim ? DIM : ACCENT,
      border: `1px solid ${dim ? BORDER : 'rgba(88,166,255,0.4)'}`,
      borderRadius: 3,
      padding: '0 5px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    {label}
  </span>
);

const ConnectionDetails: React.FC<{ entry: McpEntry }> = ({ entry }) => {
  // Compose a human-readable description of the connection. stdio shows
  // `cmd arg1 arg2`; sse/http shows the url; everything else (sdk,
  // openagentic-proxy, disabled, unknown) shows nothing rather than
  // misleading text.
  let line: string | null = null;
  if (entry.command) {
    line = entry.args && entry.args.length > 0
      ? `${entry.command} ${entry.args.join(' ')}`
      : entry.command;
  } else if (entry.url) {
    line = entry.url;
  }
  if (!line) return null;
  return (
    <div
      style={{
        fontSize: 11,
        color: DIM,
        marginTop: 2,
        marginLeft: '2.0ch', // align under the name (after status glyph + space)
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: MONO,
      }}
      title={line}
    >
      {line}
    </div>
  );
};

const LoadingState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.7ch',
      padding: '32px 0',
      color: DIM,
      fontSize: 12,
    }}
  >
    <span aria-hidden="true">⠋</span>
    <span>Loading MCP servers…</span>
  </div>
);

const EmptyState: React.FC = () => (
  <div
    style={{
      textAlign: 'center',
      padding: '24px 0',
      color: DIM,
      fontSize: 12,
    }}
  >
    <div style={{ marginBottom: 6 }}>No MCP servers configured.</div>
    <div style={{ fontSize: 11 }}>
      Tip: install a plugin with MCP tools via{' '}
      <code style={{ color: ACCENT }}>/plugin</code>
    </div>
  </div>
);

const ErrorState: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div
    style={{
      padding: '20px 0',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        color: ERROR,
        fontSize: 12,
        marginBottom: 12,
        wordBreak: 'break-word',
      }}
    >
      {message}
    </div>
    <button
      type="button"
      onClick={onRetry}
      style={{
        padding: '6px 14px',
        background: 'transparent',
        border: `1px solid ${ACCENT}`,
        color: ACCENT,
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      Retry
    </button>
  </div>
);

export default MCPPicker;
