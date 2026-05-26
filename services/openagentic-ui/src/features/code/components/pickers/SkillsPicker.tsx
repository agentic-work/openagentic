import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';

// ── Types ───────────────────────────────────────────────────────────

/**
 * Skill entry shape returned by the daemon's `list_skills` RPC. Mirrors
 * the daemon-side `SkillEntry` (see codemode-native-react-pickers-slice1.md).
 * Some sources never appear in practice but we type the union exhaustively
 * so the grouping switch is safe.
 */
export interface SkillEntry {
  name: string;
  description?: string;
  // Mirrors openagentic's `LoadedFrom` union from `loadSkillsDir.ts`. Keep
  // this open-ended (string fallback) — the daemon also emits the bare
  // 'skills' tag when it can't tell project- vs user- vs policy- scoped
  // skills apart, and any new source value should fall into the Other
  // bucket rather than being silently dropped.
  source:
    | 'policySettings'
    | 'userSettings'
    | 'projectSettings'
    | 'plugin'
    | 'mcp'
    | 'bundled'
    | 'skills'
    | 'commands_DEPRECATED'
    | (string & {});
  path?: string;
  hasUserSpecifiedDescription?: boolean;
  whenToUse?: string;
}

interface ListSkillsResult {
  skills: SkillEntry[];
}

interface SkillsPickerProps {
  open: boolean;
  onClose: () => void;
}

// ── Design tokens (match PermissionDialog / RichModals) ────────────

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BG_DEEP = 'var(--cm-bg, #0d1117)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const SELECTED_BG = 'rgba(88, 166, 255, 0.12)'; // accent-tinted highlight

// ── Source grouping (match SkillsModal in RichModals.tsx) ──────────

const SOURCE_LABELS: Record<string, string> = {
  projectSettings: 'Project Skills',
  userSettings: 'User Skills',
  policySettings: 'Managed Skills',
  plugin: 'Plugin Skills',
  mcp: 'MCP Skills',
  bundled: 'Built-in',
  skills: 'Skills',
  commands_DEPRECATED: 'Other',
};

const SOURCE_ORDER: string[] = [
  'projectSettings',
  'userSettings',
  'policySettings',
  'skills',
  'plugin',
  'mcp',
  'bundled',
  'commands_DEPRECATED',
];

// Any source the daemon emits that isn't in SOURCE_ORDER falls into this
// bucket (rendered last with the source value as the literal label) so we
// never drop rows silently — the bug that surfaced in Slice 1 chat-dev
// verification when the daemon shipped `source:'skills'` but the picker's
// allowlist didn't include it.
const FALLBACK_GROUP_LABEL = (src: string) => SOURCE_LABELS[src] ?? src;

// ── Component ───────────────────────────────────────────────────────

export const SkillsPicker: React.FC<SkillsPickerProps> = ({ open, onClose }) => {
  // Skip the context lookup entirely while closed so test harnesses
  // that mount the chat view without a DaemonRPCContext provider don't
  // explode. This component only ever needs the RPC surface when
  // `open=true` — fetchSkills is gated by the same.
  if (!open) return null;
  return <SkillsPickerOpen onClose={onClose} />;
};

const SkillsPickerOpen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { call } = useDaemonRPCContext();
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Cancel flag so a stale resolved promise doesn't clobber state if
  // the picker closes before the daemon answers.
  const requestSeqRef = useRef(0);

  const fetchSkills = useCallback(() => {
    setSkills(null);
    setError(null);
    setSelectedIdx(0);
    const seq = ++requestSeqRef.current;
    call<ListSkillsResult>('list_skills')
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setSkills(res?.skills ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
  }, [call]);

  // Kick off list_skills when the picker mounts. Mount happens on each
  // close→open transition because the outer `SkillsPicker` returns null
  // for `open=false`, which unmounts this inner component entirely.
  useEffect(() => {
    fetchSkills();
    return () => {
      // Bump the seq so an in-flight resolve from a previous open
      // doesn't update state after unmount.
      requestSeqRef.current++;
    };
  }, [fetchSkills]);

  // Flat ordered list mirroring the rendered DOM order — used for
  // arrow-key navigation. Recomputed when skills change.
  const orderedSkills = useMemo<SkillEntry[]>(() => {
    if (!skills) return [];
    const buckets = new Map<string, SkillEntry[]>();
    for (const s of skills) {
      const src = s.source ?? 'commands_DEPRECATED';
      const bucket = buckets.get(src);
      if (bucket) bucket.push(s);
      else buckets.set(src, [s]);
    }
    const out: SkillEntry[] = [];
    for (const src of SOURCE_ORDER) {
      const bucket = buckets.get(src);
      if (!bucket) continue;
      bucket.sort((a, b) => a.name.localeCompare(b.name));
      out.push(...bucket);
      buckets.delete(src);
    }
    // Any sources not in SOURCE_ORDER append at the end (alphabetised
    // by source key for stability) rather than being dropped.
    for (const src of Array.from(buckets.keys()).sort()) {
      const bucket = buckets.get(src)!;
      bucket.sort((a, b) => a.name.localeCompare(b.name));
      out.push(...bucket);
    }
    return out;
  }, [skills]);

  // Keep selectedIdx in range when the data changes (e.g. retry).
  useEffect(() => {
    if (selectedIdx >= orderedSkills.length) {
      setSelectedIdx(orderedSkills.length === 0 ? 0 : orderedSkills.length - 1);
    }
  }, [orderedSkills.length, selectedIdx]);

  // Keyboard handlers — attached for the lifetime of this open instance.
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
        setSelectedIdx((i) => Math.min(orderedSkills.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        // Slice 1 defers a per-skill detail view to a later slice —
        // for now Enter just dismisses. The selectedIdx / orderedSkills
        // wiring is in place for when we add a details panel.
        e.preventDefault();
        onClose();
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, orderedSkills.length]);

  // ── Render groups for the current skills snapshot. We group again
  // here (rather than reusing orderedSkills) so the section headers
  // can interleave with their rows in DOM order. The flat
  // orderedSkills is the navigation source of truth — same skill
  // ordering, just without the headers.
  const grouped: { source: string; rows: SkillEntry[] }[] = [];
  if (skills) {
    const buckets = new Map<string, SkillEntry[]>();
    for (const s of skills) {
      const src = s.source ?? 'commands_DEPRECATED';
      const bucket = buckets.get(src);
      if (bucket) bucket.push(s);
      else buckets.set(src, [s]);
    }
    for (const src of SOURCE_ORDER) {
      const bucket = buckets.get(src);
      if (!bucket || bucket.length === 0) continue;
      bucket.sort((a, b) => a.name.localeCompare(b.name));
      grouped.push({ source: src, rows: bucket });
      buckets.delete(src);
    }
    // Append any unrecognised sources rather than dropping them.
    for (const src of Array.from(buckets.keys()).sort()) {
      const bucket = buckets.get(src)!;
      bucket.sort((a, b) => a.name.localeCompare(b.name));
      grouped.push({ source: src, rows: bucket });
    }
  }

  // Map skill name → flat index for highlight lookups during render.
  const flatIndex = new Map<string, number>();
  orderedSkills.forEach((s, i) => flatIndex.set(s.name, i));

  const overlay = (
    <div
      data-testid="skills-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Skills picker"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50, // matches --cm-z-modal in codeMode.css
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
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Skills</span>
            {skills && (
              <span style={{ fontSize: 11, color: DIM }}>
                {skills.length} available
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
            <ErrorState message={error} onRetry={fetchSkills} />
          ) : skills === null ? (
            <LoadingState />
          ) : skills.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {grouped.map(({ source, rows }) => (
                <section key={source} style={{ marginBottom: 8 }}>
                  <SectionHeader label={FALLBACK_GROUP_LABEL(source)} count={rows.length} />
                  {rows.map((s) => {
                    const idx = flatIndex.get(s.name) ?? -1;
                    const selected = idx === selectedIdx;
                    return (
                      <div
                        key={s.name}
                        data-testid={`skill-row-${idx}`}
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
                            {s.name}
                          </span>
                        </div>
                        {s.description && (
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
                            {s.description}
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
    <span>Loading skills…</span>
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
    <div style={{ marginBottom: 6 }}>No skills found.</div>
    <div style={{ fontSize: 11 }}>
      Tip: install one with <code style={{ color: ACCENT }}>/plugin install</code>
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

export default SkillsPicker;
