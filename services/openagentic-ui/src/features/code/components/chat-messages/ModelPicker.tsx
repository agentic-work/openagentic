/**
 * ModelPicker — `/model` slash command UI.
 *
 * Fetches the available models from /api/chat/models (already an
 * existing endpoint) and lets the user pick one. Selection is stored
 * in localStorage under `codemode:model:<sessionId>` and applied to
 * the next turn by passing `model: <id>` to sendMessage.
 *
 * Like ThemePicker, keyboard-driven (↑↓/Enter/Esc) and accessible.
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useEffect, useState } from 'react';
import { SlashCommandModal } from './SlashCommandModal';

interface ModelEntry {
  id: string;
  label: string;
  provider?: string;
  isDefault?: boolean;
}

export interface ModelPickerProps {
  sessionId: string | null;
  /** Currently-active model (from system init event). */
  currentModel?: string;
  /** Called when the user commits a selection. */
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  sessionId,
  currentModel,
  onSelect,
  onClose,
}) => {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch available models. Endpoint: /api/chat/models
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        // curated=true restricts to models explicitly in model_config
        // routing hints (chatModel / defaultModel / additionalModels[...])
        // so the codemode picker matches the admin Model Registry view
        // instead of dumping every auto-discovered upstream catalog entry.
        const r = await fetch('/api/chat/models?curated=true', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // The endpoint returns { models: [{ id, label?, provider? }, ...] }
        // — coerce shapes so a slightly different schema still loads.
        const raw = (data?.models ?? data?.availableModels ?? data ?? []) as unknown;
        if (!Array.isArray(raw)) throw new Error('models endpoint returned non-array');
        const list: ModelEntry[] = raw
          .map((m: any): ModelEntry | null => {
            const id = m?.id ?? m?.name ?? m?.model;
            if (typeof id !== 'string') return null;
            return {
              id,
              label: m?.label ?? m?.displayName ?? id,
              provider: m?.provider ?? m?.providerId,
              isDefault: m?.isDefault === true,
            };
          })
          .filter((x): x is ModelEntry => x !== null);
        if (cancelled) return;
        setModels(list);
        // Highlight the current model if present, otherwise the first
        // default, otherwise index 0.
        const curIdx = list.findIndex((m) => m.id === currentModel);
        if (curIdx >= 0) setSelected(curIdx);
        else {
          const defIdx = list.findIndex((m) => m.isDefault);
          if (defIdx >= 0) setSelected(defIdx);
        }
      } catch (err: any) {
        if (cancelled) return;
        setFetchError(err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentModel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (models.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => (s + 1) % models.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => (s - 1 + models.length) % models.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const m = models[selected];
        if (m) {
          onSelect(m.id);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [models, selected, onSelect, onClose]);

  return (
    <SlashCommandModal
      title="/model"
      subtitle={
        currentModel
          ? `Current: ${currentModel} — pick a new model for the next turn`
          : 'Pick a model for the next turn'
      }
      onClose={onClose}
    >
      {loading && (
        <div style={{ padding: 12, color: 'var(--cm-text-muted, #8b949e)', fontSize: 12 }}>
          loading available models…
        </div>
      )}
      {fetchError && (
        <div
          style={{
            padding: 12,
            color: 'var(--cm-error, #f85149)',
            fontSize: 12,
          }}
        >
          ⚠ could not fetch /api/chat/models: {fetchError}
        </div>
      )}
      {!loading && !fetchError && models.length === 0 && (
        <div style={{ padding: 12, color: 'var(--cm-text-muted, #8b949e)', fontSize: 12 }}>
          no models configured
        </div>
      )}
      {!loading && models.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            fontSize: 13,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {models.map((m, i) => {
            const isSel = i === selected;
            const isCurrent = m.id === currentModel;
            return (
              <li
                key={m.id}
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  onSelect(m.id);
                  onClose();
                }}
                style={{
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '1ch',
                  cursor: 'pointer',
                  borderRadius: 4,
                  backgroundColor: isSel
                    ? 'var(--cm-bg-secondary, #161b22)'
                    : 'transparent',
                  borderLeft: isSel
                    ? `2px solid var(--cm-accent, #58a6ff)`
                    : '2px solid transparent',
                }}
              >
                <span
                  style={{
                    width: '1ch',
                    color: isCurrent
                      ? 'var(--cm-success, #3fb950)'
                      : 'transparent',
                  }}
                >
                  ●
                </span>
                <span style={{ color: 'var(--cm-accent, #58a6ff)', flex: '0 0 auto' }}>
                  {m.label}
                </span>
                {m.provider && (
                  <span
                    style={{
                      color: 'var(--cm-text-muted, #8b949e)',
                      fontSize: 11,
                    }}
                  >
                    ({m.provider})
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {m.isDefault && (
                  <span
                    style={{
                      color: '#d29922',
                      fontSize: 10,
                      padding: '1px 6px',
                      border: '1px solid #d29922',
                      borderRadius: 2,
                    }}
                  >
                    default
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SlashCommandModal>
  );
};

export default ModelPicker;
