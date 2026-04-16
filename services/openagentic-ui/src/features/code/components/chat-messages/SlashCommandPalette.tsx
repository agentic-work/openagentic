/**
 * SlashCommandPalette — the `/` autocomplete dropdown.
 *
 * Rendered above the input box whenever the current input starts with
 * `/`. Arrow Up / Down navigate, Enter selects, Esc closes. Filter is
 * live as the user types. Matches openagentic's TUI slash-command
 * picker behavior (src/commands/*).
 *
 * The selection callback receives the command name without the
 * leading slash. The parent decides what to do with it (open a modal,
 * dispatch a backend action, insert boilerplate, etc.).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterSlashCommands,
  type SlashCommand,
  type SlashCommandPriority,
} from '../../slashCommands';

interface SlashCommandPaletteProps {
  /** Current input text (must start with `/` for palette to show). */
  input: string;
  /** Called when the user selects a command. Arg: command name (no slash). */
  onSelect: (name: string) => void;
  /** Called on Esc / click-away to dismiss. */
  onDismiss: () => void;
  /** Optional: limit number of visible results. Default 10. */
  limit?: number;
}

const PRIORITY_LABEL: Record<SlashCommandPriority, string> = {
  p0: '●',
  p1: '◐',
  p2: '○',
  p3: '·',
};

const PRIORITY_COLOR: Record<SlashCommandPriority, string> = {
  p0: 'var(--cm-accent, #58a6ff)',
  p1: 'var(--cm-success, #3fb950)',
  p2: '#d29922',
  p3: 'var(--cm-text-muted, #6e7681)',
};

export interface SlashCommandPaletteHandle {
  /** Advance selection by +1. Returns true if handled. */
  stepDown: () => boolean;
  /** Move selection by -1. Returns true if handled. */
  stepUp: () => boolean;
  /** Commit the currently highlighted command. Returns true if handled. */
  commit: () => boolean;
  /** True when the palette is visible and has candidates. */
  isOpen: boolean;
}

export const SlashCommandPalette = React.forwardRef<
  SlashCommandPaletteHandle,
  SlashCommandPaletteProps
>(function SlashCommandPalette({ input, onSelect, onDismiss, limit = 10 }, ref) {
  const isSlashMode = input.startsWith('/');
  const query = isSlashMode ? input.slice(1).split(/\s/)[0] : '';
  const candidates: SlashCommand[] = useMemo(
    () => (isSlashMode ? filterSlashCommands(query, limit) : []),
    [isSlashMode, query, limit],
  );

  const [selected, setSelected] = useState(0);

  // Reset selection when the candidate list changes.
  useEffect(() => {
    setSelected(0);
  }, [query, isSlashMode]);

  const isOpen = isSlashMode && candidates.length > 0;

  React.useImperativeHandle(
    ref,
    (): SlashCommandPaletteHandle => ({
      stepDown: () => {
        if (!isOpen) return false;
        setSelected((s) => (s + 1) % candidates.length);
        return true;
      },
      stepUp: () => {
        if (!isOpen) return false;
        setSelected((s) => (s - 1 + candidates.length) % candidates.length);
        return true;
      },
      commit: () => {
        if (!isOpen) return false;
        const c = candidates[selected];
        if (!c) return false;
        onSelect(c.name);
        return true;
      },
      isOpen,
    }),
    [isOpen, candidates, selected, onSelect],
  );

  const listRef = useRef<HTMLUListElement>(null);
  // Auto-scroll the highlighted row into view when selection moves.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const row = el.querySelector<HTMLLIElement>(`li[data-idx="${selected}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!isOpen) return null;

  return (
    <div
      className="mb-1.5 rounded-md overflow-hidden"
      style={{
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        fontSize: 12,
        backgroundColor: 'var(--cm-bg, #0d1117)',
        border: '1px solid var(--cm-border, #30363d)',
        boxShadow: '0 2px 16px rgba(0, 0, 0, 0.35)',
        maxHeight: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseLeave={() => {
        // Don't dismiss on mouse leave — the user might be reaching
        // back to the textarea to keep typing.
      }}
    >
      <ul
        ref={listRef}
        className="overflow-y-auto"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: 380,
        }}
      >
        {candidates.map((c, i) => {
          const isSel = i === selected;
          return (
            <li
              key={c.name}
              data-idx={i}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                // mouseDown (not click) so we beat the textarea blur.
                e.preventDefault();
                onSelect(c.name);
              }}
              style={{
                padding: '5px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'baseline',
                gap: '1ch',
                backgroundColor: isSel
                  ? 'var(--cm-bg-secondary, #161b22)'
                  : 'transparent',
                borderLeft: isSel
                  ? `2px solid var(--cm-accent, #58a6ff)`
                  : '2px solid transparent',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  color: PRIORITY_COLOR[c.priority],
                  width: '1ch',
                  display: 'inline-block',
                }}
                title={`priority ${c.priority}`}
              >
                {PRIORITY_LABEL[c.priority]}
              </span>
              <span style={{ color: 'var(--cm-accent, #58a6ff)', width: '18ch' }}>
                /{c.name}
                {c.args && (
                  <span style={{ color: 'var(--cm-text-muted, #6e7681)', marginLeft: '0.5ch' }}>
                    {c.args}
                  </span>
                )}
              </span>
              <span
                style={{
                  color: 'var(--cm-text, #e6edf3)',
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.description}
              </span>
              {c.aliases && c.aliases.length > 0 && (
                <span
                  style={{
                    color: 'var(--cm-text-muted, #6e7681)',
                    fontSize: 10,
                  }}
                >
                  alias: {c.aliases.join(', ')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div
        style={{
          padding: '4px 10px',
          borderTop: '1px solid var(--cm-border, #30363d)',
          color: 'var(--cm-text-muted, #6e7681)',
          fontSize: 10,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          ↑↓ navigate · ⏎ run · esc close
        </span>
        <span>
          {candidates.length} match{candidates.length === 1 ? '' : 'es'}
        </span>
      </div>
    </div>
  );
});

export default SlashCommandPalette;
