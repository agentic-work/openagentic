import React, { useEffect, useState } from 'react';
import { SlashCommandModal } from './SlashCommandModal';

// Kept in sync with CodeModeLayoutV2 CM_THEMES by convention. If that
// list grows, update here too. Dot colors mirror the primary accent.
const THEMES = [
  { id: 'default', label: 'Default', dot: '#58a6ff' },
  { id: 'catppuccin-latte', label: 'Latte', dot: '#1e66f5' },
  { id: 'catppuccin-frappe', label: 'Frappé', dot: '#8caaee' },
  { id: 'catppuccin-mocha', label: 'Mocha', dot: '#cba6f7' },
  { id: 'tokyo-night', label: 'Tokyo Night', dot: '#7aa2f7' },
  { id: 'dracula', label: 'Dracula', dot: '#bd93f9' },
  { id: 'terminal-green', label: 'Terminal Green', dot: '#00ff41' },
] as const;

export interface ThemePickerProps {
  onClose: () => void;
}

/**
 * Applies a CodeMode theme by writing localStorage and dispatching a
 * 'storage' event so the ThemeSelectorPill in TerminalHeaderBar
 * re-reads and updates its DOM. We don't directly mutate the var set
 * here — the existing layout code owns that side-effect — we just
 * trigger it via the localStorage change.
 */
function applyTheme(id: string) {
  try {
    localStorage.setItem('cm-theme', id);
  } catch {
    /* quota */
  }
  // Notify other listeners in the same tab. The TerminalHeaderBar's
  // ThemeSelectorPill listens for 'storage' cross-tab, and we also
  // dispatch a custom event so same-tab listeners can react.
  window.dispatchEvent(
    new CustomEvent('codemode:theme-change', { detail: { id } }),
  );
  // Directly apply to the .code-mode element for same-tab immediacy
  // — the layout's useEffect on `theme` won't fire from a different
  // component writing localStorage, so we trigger the cascade by
  // setting data-cm-theme here. The layout's effect will overwrite on
  // next render if needed.
  const el = document.querySelector<HTMLElement>('.code-mode');
  if (el) {
    if (id === 'default') {
      el.removeAttribute('data-cm-theme');
    } else {
      el.setAttribute('data-cm-theme', id);
    }
  }
}

function getCurrent(): string {
  try {
    return localStorage.getItem('cm-theme') || 'default';
  } catch {
    return 'default';
  }
}

export const ThemePicker: React.FC<ThemePickerProps> = ({ onClose }) => {
  const [selected, setSelected] = useState<number>(() => {
    const cur = getCurrent();
    const i = THEMES.findIndex((t) => t.id === cur);
    return i >= 0 ? i : 0;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => (s + 1) % THEMES.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => (s - 1 + THEMES.length) % THEMES.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        applyTheme(THEMES[selected].id);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [selected, onClose]);

  // Live preview: apply on hover / selection change, revert on cancel.
  const [initialTheme] = useState<string>(() => getCurrent());
  useEffect(() => {
    applyTheme(THEMES[selected].id);
  }, [selected]);
  useEffect(() => {
    // On unmount without an explicit Enter, revert to the initial
    // theme so hovering through options doesn't leave the user on the
    // wrong one after Esc.
    return () => {
      // Only revert if the user pressed Esc (not Enter) — when Enter
      // fires we call onClose which unmounts, but we want the committed
      // theme to stick. Track whether commit happened via a ref.
      if (!committedRef.current) {
        applyTheme(initialTheme);
      }
    };
  }, [initialTheme]);

  const committedRef = React.useRef(false);
  const commit = (id: string) => {
    committedRef.current = true;
    applyTheme(id);
    onClose();
  };

  return (
    <SlashCommandModal
      title="/theme"
      subtitle="Choose a CodeMode color theme (live-previewed while you navigate)"
      onClose={onClose}
    >
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
        {THEMES.map((t, i) => {
          const isSel = i === selected;
          return (
            <li
              key={t.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => commit(t.id)}
              style={{
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '1ch',
                cursor: 'pointer',
                borderRadius: 4,
                backgroundColor: isSel ? 'var(--cm-bg-secondary, #161b22)' : 'transparent',
                borderLeft: isSel
                  ? `2px solid var(--cm-accent, #58a6ff)`
                  : '2px solid transparent',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: t.dot,
                  boxShadow: `0 0 6px ${t.dot}`,
                  flex: '0 0 auto',
                }}
              />
              <span style={{ flex: 1, color: 'var(--cm-text, #e6edf3)' }}>{t.label}</span>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)', fontSize: 11 }}>
                {t.id}
              </span>
            </li>
          );
        })}
      </ul>
    </SlashCommandModal>
  );
};

export default ThemePicker;
