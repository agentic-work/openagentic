import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';
import { AgentDetailPane } from './AgentDetailPane';
import { AgentEditor, type AgentEditorPayload } from './AgentEditor';

// ── Types ───────────────────────────────────────────────────────────

/**
 * Agent entry shape returned by the daemon's `list_agents` RPC. Mirrors
 * the daemon-side `AgentEntry` (openagentic/src/entrypoints/
 * daemonRequestHandlers.ts). Keep the schemas in sync — the wire shape
 * is the contract between the browser and the daemon.
 */
export interface AgentEntry {
  /** Unique agent id (== `agentType` in daemon-side AgentDefinition). */
  id: string;
  /** Short description shown under the name (== `whenToUse`). */
  description: string;
  /** Bucket for grouping in the picker UI. */
  source:
    | 'built-in'
    | 'plugin'
    | 'userSettings'
    | 'projectSettings'
    | 'policySettings'
    | 'localSettings'
    | 'flagSettings'
    | (string & {});
  /** Optional tool allowlist (e.g. ['Read','Grep']). Omitted when absent. */
  tools?: string[];
  /** Override model for this agent (e.g. 'inherit', 'gpt-oss:20b'). */
  model?: string;
  /** Plugin id when source === 'plugin'. */
  plugin?: string;
  /** System prompt body — included by `list_agents` so the detail pane +
   * editor can render/pre-fill without an extra RPC. May be empty for
   * dynamic built-in prompts. */
  systemPrompt?: string;
}

interface ListAgentsResult {
  agents: AgentEntry[];
}

interface AgentsPickerProps {
  open: boolean;
  onClose: () => void;
}

// ── Design tokens (match SkillsPicker / MCPPicker / ModelPicker) ───

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const SELECTED_BG = 'rgba(88, 166, 255, 0.12)';

// ── Source grouping ─────────────────────────────────────────────────

/**
 * Grouping labels mirror the daemon's `SettingSource` union plus the
 * built-in / plugin special cases. Uppercased at render time so the
 * test can assert case-insensitive.
 */
const SOURCE_LABELS: Record<string, string> = {
  'built-in': 'Built-in',
  userSettings: 'User',
  projectSettings: 'Project',
  policySettings: 'Managed',
  localSettings: 'Local',
  flagSettings: 'Flag',
  plugin: 'Plugin',
};

/**
 * Display order — built-ins first (most visible defaults), then user,
 * then project / policy / etc., plugins last (typically the largest
 * bucket on a user's machine).
 */
const SOURCE_ORDER: string[] = [
  'built-in',
  'userSettings',
  'projectSettings',
  'policySettings',
  'localSettings',
  'flagSettings',
  'plugin',
];

const FALLBACK_GROUP_LABEL = (src: string) => SOURCE_LABELS[src] ?? src;

// ── Component ───────────────────────────────────────────────────────

export const AgentsPicker: React.FC<AgentsPickerProps> = ({ open, onClose }) => {
  // Skip the context lookup entirely while closed so test harnesses
  // that mount the chat view without a DaemonRPCContext provider don't
  // explode. This component only ever needs the RPC surface when
  // `open=true` — fetchAgents is gated by the same.
  if (!open) return null;
  return <AgentsPickerOpen onClose={onClose} />;
};

type ViewMode =
  | { kind: 'list' }
  | { kind: 'detail'; agentId: string }
  | { kind: 'create' }
  | { kind: 'edit'; agentId: string }
  | { kind: 'confirm-delete'; agentId: string };

const AgentsPickerOpen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { call } = useDaemonRPCContext();
  const [agents, setAgents] = useState<AgentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [view, setView] = useState<ViewMode>({ kind: 'list' });
  // Cancel flag so a stale resolved promise doesn't clobber state if
  // the picker closes before the daemon answers.
  const requestSeqRef = useRef(0);

  const fetchAgents = useCallback(() => {
    setAgents(null);
    setError(null);
    setSelectedIdx(0);
    const seq = ++requestSeqRef.current;
    call<ListAgentsResult>('list_agents')
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setAgents(res?.agents ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
  }, [call]);

  // Kick off list_agents when the picker mounts. Mount happens on each
  // close→open transition because the outer `AgentsPicker` returns null
  // for `open=false`, which unmounts this inner component entirely.
  useEffect(() => {
    fetchAgents();
    return () => {
      // Bump the seq so an in-flight resolve from a previous open
      // doesn't update state after unmount.
      requestSeqRef.current++;
    };
  }, [fetchAgents]);

  // Flat ordered list mirroring the rendered DOM order — used for
  // arrow-key navigation. Recomputed when agents change.
  const orderedAgents = useMemo<AgentEntry[]>(() => {
    if (!agents) return [];
    const buckets = new Map<string, AgentEntry[]>();
    for (const a of agents) {
      const src = a.source ?? 'built-in';
      const bucket = buckets.get(src);
      if (bucket) bucket.push(a);
      else buckets.set(src, [a]);
    }
    const out: AgentEntry[] = [];
    for (const src of SOURCE_ORDER) {
      const bucket = buckets.get(src);
      if (!bucket) continue;
      bucket.sort((a, b) => a.id.localeCompare(b.id));
      out.push(...bucket);
      buckets.delete(src);
    }
    // Any sources not in SOURCE_ORDER append at the end (alphabetised
    // by source key for stability) rather than being dropped.
    for (const src of Array.from(buckets.keys()).sort()) {
      const bucket = buckets.get(src)!;
      bucket.sort((a, b) => a.id.localeCompare(b.id));
      out.push(...bucket);
    }
    return out;
  }, [agents]);

  // Keep selectedIdx in range when the data changes (e.g. retry).
  useEffect(() => {
    if (selectedIdx >= orderedAgents.length) {
      setSelectedIdx(orderedAgents.length === 0 ? 0 : orderedAgents.length - 1);
    }
  }, [orderedAgents.length, selectedIdx]);

  // Keyboard handlers — attached for the lifetime of this open instance.
  // Escape semantics:
  //   list   → onClose
  //   detail → back to list
  //   create / edit → back to list (form discards)
  //   confirm-delete → back to detail
  // Enter only fires the "open detail" path while in the list view; the
  // editor / detail pane have their own buttons + native form behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (view.kind === 'list') onClose();
        else if (view.kind === 'detail') setView({ kind: 'list' });
        else if (view.kind === 'create' || view.kind === 'edit')
          setView({ kind: 'list' });
        else if (view.kind === 'confirm-delete')
          setView({ kind: 'detail', agentId: view.agentId });
        return;
      }
      // Arrow / Enter keyboard navigation only applies in list view.
      if (view.kind !== 'list') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(orderedAgents.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = orderedAgents[selectedIdx];
        if (sel) setView({ kind: 'detail', agentId: sel.id });
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, orderedAgents, selectedIdx, view]);

  // Look up the active agent for detail/edit/confirm views.
  const currentAgent =
    view.kind === 'detail' || view.kind === 'edit' || view.kind === 'confirm-delete'
      ? agents?.find((a) => a.id === view.agentId) ?? null
      : null;

  // Wire up the create/update RPCs. After a successful save we refetch
  // the list so the picker stays in sync with what's on disk.
  const handleSave = useCallback(
    async (payload: AgentEditorPayload, isCreate: boolean) => {
      const method = isCreate ? 'create_agent' : 'update_agent';
      const result = (await call<unknown>(method, {
        name: payload.name,
        description: payload.description,
        model: payload.model,
        tools: payload.tools,
        systemPrompt: payload.systemPrompt,
        scope: payload.scope,
      })) as { ok: boolean; error?: string };
      if (result && result.ok === false) {
        // The daemon contract uses ok:false{error} for create/update
        // failures (name_taken / not_found / fs_error). Re-throw so the
        // editor's error pane renders the message inline.
        throw new Error(result.error ?? 'unknown_error');
      }
      // Success — close the editor and refresh the list.
      setView({ kind: 'list' });
      fetchAgents();
    },
    [call, fetchAgents],
  );

  const handleDelete = useCallback(
    async (agentId: string) => {
      const result = (await call<unknown>('delete_agent', {
        name: agentId,
        scope: 'user', // backend ignores when finding by name; included for the contract
      })) as { ok: boolean; error?: string };
      if (result && result.ok === false) {
        throw new Error(result.error ?? 'unknown_error');
      }
      setView({ kind: 'list' });
      fetchAgents();
    },
    [call, fetchAgents],
  );

  // Render groups for the current agents snapshot. We group again here
  // (rather than reusing orderedAgents) so the section headers can
  // interleave with their rows in DOM order. The flat orderedAgents is
  // the navigation source of truth — same agent ordering, just without
  // the headers.
  const grouped: { source: string; rows: AgentEntry[] }[] = [];
  if (agents) {
    const buckets = new Map<string, AgentEntry[]>();
    for (const a of agents) {
      const src = a.source ?? 'built-in';
      const bucket = buckets.get(src);
      if (bucket) bucket.push(a);
      else buckets.set(src, [a]);
    }
    for (const src of SOURCE_ORDER) {
      const bucket = buckets.get(src);
      if (!bucket || bucket.length === 0) continue;
      bucket.sort((a, b) => a.id.localeCompare(b.id));
      grouped.push({ source: src, rows: bucket });
      buckets.delete(src);
    }
    for (const src of Array.from(buckets.keys()).sort()) {
      const bucket = buckets.get(src)!;
      bucket.sort((a, b) => a.id.localeCompare(b.id));
      grouped.push({ source: src, rows: bucket });
    }
  }

  // Map agent id → flat index for highlight lookups during render.
  const flatIndex = new Map<string, number>();
  orderedAgents.forEach((a, i) => flatIndex.set(a.id, i));

  const overlay = (
    <div
      data-testid="agents-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Agents picker"
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
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Agents</span>
            {agents && (
              <span style={{ fontSize: 11, color: DIM }}>
                {agents.length} available
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7ch' }}>
            {view.kind === 'list' && (
              <button
                type="button"
                onClick={() => setView({ kind: 'create' })}
                style={{
                  background: 'transparent',
                  border: `1px solid ${ACCENT}`,
                  color: ACCENT,
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                + New Agent
              </button>
            )}
            <span style={{ fontSize: 11, color: DIM }}>
              <kbd>Esc</kbd> close
            </span>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 12px',
          }}
        >
          {view.kind === 'create' ? (
            <AgentEditor
              mode="create"
              onSave={handleSave}
              onCancel={() => setView({ kind: 'list' })}
            />
          ) : view.kind === 'edit' && currentAgent ? (
            <AgentEditor
              mode="edit"
              existing={currentAgent}
              onSave={handleSave}
              onCancel={() => setView({ kind: 'detail', agentId: view.agentId })}
            />
          ) : view.kind === 'detail' && currentAgent ? (
            <AgentDetailPane
              agent={currentAgent}
              onBack={() => setView({ kind: 'list' })}
              onEdit={() => setView({ kind: 'edit', agentId: currentAgent.id })}
              onDelete={() => setView({ kind: 'confirm-delete', agentId: currentAgent.id })}
            />
          ) : view.kind === 'confirm-delete' && currentAgent ? (
            <ConfirmDelete
              agent={currentAgent}
              onConfirm={() => handleDelete(currentAgent.id)}
              onCancel={() => setView({ kind: 'detail', agentId: currentAgent.id })}
            />
          ) : error !== null ? (
            <ErrorState message={error} onRetry={fetchAgents} />
          ) : agents === null ? (
            <LoadingState />
          ) : agents.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {grouped.map(({ source, rows }) => (
                <section key={source} style={{ marginBottom: 8 }}>
                  <SectionHeader label={FALLBACK_GROUP_LABEL(source)} count={rows.length} />
                  {rows.map((a) => {
                    const idx = flatIndex.get(a.id) ?? -1;
                    const selected = idx === selectedIdx;
                    return (
                      <div
                        key={a.id}
                        data-testid={`agent-row-${idx}`}
                        data-selected={selected ? 'true' : 'false'}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 4,
                          backgroundColor: selected ? SELECTED_BG : 'transparent',
                          borderLeft: selected ? `2px solid ${ACCENT}` : '2px solid transparent',
                          marginBottom: 1,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={() => idx >= 0 && setSelectedIdx(idx)}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: '0.7ch',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 12,
                              color: selected ? ACCENT : TEXT,
                              fontWeight: selected ? 600 : 500,
                            }}
                          >
                            {a.id}
                          </span>
                          {a.model && <Chip label={a.model} />}
                          {a.tools && a.tools.length > 0 && (
                            <Chip label={`${a.tools.length} tools`} dim />
                          )}
                          {a.plugin && <Chip label={a.plugin} dim />}
                        </div>
                        {a.description && (
                          <div
                            style={{
                              fontSize: 11,
                              color: DIM,
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {a.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </>
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
          <span>↑↓ navigate · Enter for details · v1 read-only</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );

  // SSR guard — the chat view only mounts in the browser, but be safe.
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
};

// ── Sub-renderers ──────────────────────────────────────────────────

const SectionHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 600,
      color: DIM,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      padding: '8px 0 4px',
      borderBottom: `1px solid ${BORDER}`,
      marginBottom: 4,
      display: 'flex',
      justifyContent: 'space-between',
    }}
  >
    <span>{label}</span>
    <span style={{ color: ACCENT }}>{count}</span>
  </div>
);

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
    <span>Loading agents…</span>
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
    <div style={{ marginBottom: 6 }}>No agents found.</div>
    <div style={{ fontSize: 11 }}>
      Tip: drop agent files into <code style={{ color: ACCENT }}>~/.openagentic/agents/</code>
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

const ConfirmDelete: React.FC<{
  agent: AgentEntry;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}> = ({ agent, onConfirm, onCancel }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handleConfirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="agent-confirm-delete"
      style={{
        fontFamily: MONO,
        color: TEXT,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
        Delete {agent.id}?
      </div>
      <div style={{ fontSize: 11, color: DIM }}>
        This removes the agent file from disk. Other sessions referencing
        this agent will fall back to the next available source on next
        load.
      </div>
      {err && (
        <div
          style={{
            color: ERROR,
            fontSize: 11,
            border: `1px solid ${ERROR}`,
            borderRadius: 4,
            padding: '6px 10px',
          }}
        >
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.7ch' }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          style={{
            background: 'transparent',
            border: `1px solid ${ERROR}`,
            color: ERROR,
            borderRadius: 4,
            padding: '6px 14px',
            fontFamily: MONO,
            fontSize: 12,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Deleting…' : 'Confirm'}
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

export default AgentsPicker;
