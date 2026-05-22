import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';

// ── Types ───────────────────────────────────────────────────────────

/**
 * Model entry shape returned by the daemon's `list_models` RPC. Mirrors
 * `ModelPickerEntry` in openagentic/src/entrypoints/daemonRequestHandlers.ts.
 * Keep the schemas in sync — the wire shape is the contract between the
 * browser and the daemon.
 */
export interface ModelEntry {
  id: string;
  /** Human-friendly label, when the registry supplies one. */
  name?: string;
  /** Provider tag (e.g. "OpenAI", "Anthropic"). */
  provider?: string;
  /** True for the model the daemon will dispatch the next turn against. */
  currentlyActive: boolean;
  /** True for the registry-default (admin pick), independent of activeness. */
  isDefault?: boolean;
}

interface ListModelsResult {
  models: ModelEntry[];
  /** id of the model the daemon would dispatch against right now. */
  currentId?: string;
}

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
}

// ── Design tokens (match SkillsPicker / PluginsPicker / PermissionDialog) ──

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const SELECTED_BG = 'rgba(88, 166, 255, 0.12)'; // accent-tinted highlight

// ── Component ───────────────────────────────────────────────────────

export const ModelPicker: React.FC<ModelPickerProps> = ({ open, onClose }) => {
  // Skip the context lookup entirely while closed so test harnesses
  // that mount the chat view without a DaemonRPCContext provider don't
  // explode. This component only ever needs the RPC surface when
  // `open=true` — fetchModels is gated by the same.
  if (!open) return null;
  return <ModelPickerOpen onClose={onClose} />;
};

const ModelPickerOpen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { call } = useDaemonRPCContext();

  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Set-model state: which id is currently being switched to (so we can
  // render a "Switching to <id>…" indicator near the row), and any
  // inline error from a failed switch.
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Cancel flag so a stale resolved promise doesn't clobber state if
  // the picker closes before the daemon answers.
  const requestSeqRef = useRef(0);

  const fetchModels = useCallback(() => {
    setModels(null);
    setError(null);
    setSelectedIdx(0);
    setSwitchingId(null);
    setSwitchError(null);
    const seq = ++requestSeqRef.current;
    call<ListModelsResult>('list_models')
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        setModels(res?.models ?? []);
        setCurrentId(res?.currentId);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      });
  }, [call]);

  // Kick off list_models when the picker mounts. Mount happens on each
  // close→open transition because the outer `ModelPicker` returns null
  // for `open=false`, which unmounts this inner component entirely.
  useEffect(() => {
    fetchModels();
    return () => {
      // Bump the seq so an in-flight resolve from a previous open
      // doesn't update state after unmount.
      requestSeqRef.current++;
    };
  }, [fetchModels]);

  // Keep selectedIdx in range when the data changes (e.g. retry).
  useEffect(() => {
    if (!models) return;
    if (selectedIdx >= models.length) {
      setSelectedIdx(models.length === 0 ? 0 : models.length - 1);
    }
  }, [models, selectedIdx]);

  // ── Activate (click / Enter / Space) ─────────────────────────────
  // Triggers the model swap via `set_model`. On success, close the
  // picker via the onClose callback. On failure, surface the error
  // inline and leave the picker open so the user can pick again.
  const activateModel = useCallback(
    (id: string) => {
      if (switchingId === id) return; // already in flight for this id
      setSwitchingId(id);
      setSwitchError(null);
      const seq = ++requestSeqRef.current;
      call<{ ok: true; id: string }>('set_model', { id })
        .then(() => {
          if (seq !== requestSeqRef.current) return;
          setSwitchingId(null);
          // Close ONLY on success — the chat continues uninterrupted;
          // next user message uses the new model.
          onClose();
        })
        .catch((err: unknown) => {
          if (seq !== requestSeqRef.current) return;
          setSwitchingId(null);
          const msg = err instanceof Error ? err.message : String(err);
          setSwitchError(msg);
        });
    },
    [call, onClose, switchingId],
  );

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
        const max = models?.length ?? 0;
        if (max === 0) return;
        setSelectedIdx((i) => Math.min(max - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const row = models?.[selectedIdx];
        if (!row) return;
        activateModel(row.id);
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose, models, selectedIdx, activateModel]);

  const overlay = (
    <div
      data-testid="model-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Model picker"
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
          data-testid="model-picker-header"
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${BORDER}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            gap: '0.7ch',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7ch' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Models</span>
            {models && (
              <span style={{ fontSize: 11, color: DIM }}>
                {models.length} available
              </span>
            )}
            {currentId && (
              <span style={{ fontSize: 11, color: DIM }}>
                · current: <span style={{ color: ACCENT }}>{currentId}</span>
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
            <ErrorState message={error} onRetry={fetchModels} />
          ) : models === null ? (
            <LoadingState />
          ) : models.length === 0 ? (
            <EmptyState />
          ) : (
            models.map((m, idx) => (
              <ModelRow
                key={m.id}
                idx={idx}
                model={m}
                selected={idx === selectedIdx}
                switching={switchingId === m.id}
                onMouseEnter={() => setSelectedIdx(idx)}
                onActivate={() => {
                  setSelectedIdx(idx);
                  activateModel(m.id);
                }}
              />
            ))
          )}
          {switchError !== null && (
            <div
              role="alert"
              style={{
                marginTop: 12,
                padding: '8px 10px',
                border: `1px solid ${ERROR}`,
                borderRadius: 4,
                color: ERROR,
                fontSize: 11,
                wordBreak: 'break-word',
                fontFamily: MONO,
              }}
            >
              {switchError}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: '8px 16px',
            color: DIM,
            fontSize: 11,
            flexShrink: 0,
            fontFamily: MONO,
          }}
        >
          ↑↓ navigate · Enter to switch · Esc to close
        </div>
      </div>
    </div>
  );

  // SSR guard — the chat view only mounts in the browser, but be safe.
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
};

// ── Model row ──────────────────────────────────────────────────────

interface ModelRowProps {
  idx: number;
  model: ModelEntry;
  selected: boolean;
  switching: boolean;
  onMouseEnter: () => void;
  onActivate: () => void;
}

const ModelRow: React.FC<ModelRowProps> = ({
  idx,
  model,
  selected,
  switching,
  onMouseEnter,
  onActivate,
}) => {
  const glyph = model.currentlyActive ? '●' : '◯';
  const glyphColor = model.currentlyActive ? ACCENT : DIM;
  return (
    <div
      data-testid={`model-row-${idx}`}
      data-selected={selected ? 'true' : 'false'}
      data-active={model.currentlyActive ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      style={{
        padding: '6px 10px',
        borderRadius: 4,
        backgroundColor: selected ? SELECTED_BG : 'transparent',
        borderLeft: selected ? `2px solid ${ACCENT}` : '2px solid transparent',
        marginBottom: 1,
        cursor: 'pointer',
      }}
      onMouseEnter={onMouseEnter}
      onClick={onActivate}
      onKeyDown={(e) => {
        // Native Enter/Space when the row itself has focus (e.g. user
        // tabbed in). Stop propagation so the global picker keydown
        // handler doesn't double-fire on Space.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.7ch',
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        <span aria-hidden="true" style={{ color: glyphColor }}>
          {glyph}
        </span>
        <span
          style={{
            color: selected ? ACCENT : TEXT,
            fontWeight: selected ? 600 : 500,
          }}
        >
          {model.id}
        </span>
        {model.provider && (
          <>
            <span style={{ color: DIM }}>·</span>
            <span style={{ color: DIM }}>{model.provider}</span>
          </>
        )}
        {model.isDefault && !model.currentlyActive && (
          <span style={{ color: DIM, fontSize: 10 }}>[admin-default]</span>
        )}
      </div>
      {model.name && model.name !== model.id && (
        <div
          style={{
            fontSize: 11,
            color: DIM,
            marginTop: 2,
            marginLeft: '2.4ch',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {model.name}
        </div>
      )}
      {switching && (
        <div
          style={{
            fontSize: 11,
            color: ACCENT,
            marginTop: 2,
            marginLeft: '2.4ch',
            fontFamily: MONO,
          }}
          aria-live="polite"
        >
          Switching to {model.id}…
        </div>
      )}
    </div>
  );
};

// ── Sub-renderers ──────────────────────────────────────────────────

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
    <span>Loading models…</span>
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
    <div style={{ marginBottom: 6 }}>No models registered for this session.</div>
    <div style={{ fontSize: 11 }}>
      Tip: ask an admin to register codemode models in the platform registry.
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

export default ModelPicker;
