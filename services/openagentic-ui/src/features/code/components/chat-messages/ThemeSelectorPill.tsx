import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const CM_THEMES = [
  { id: 'default', label: 'Default', dot: '#33FF33' },
  { id: 'catppuccin-latte', label: 'Latte', dot: '#dc8a78' },
  { id: 'catppuccin-frappe', label: 'Frappé', dot: '#eebebe' },
  { id: 'catppuccin-mocha', label: 'Mocha', dot: '#cba6f7' },
  { id: 'tokyo-night', label: 'Tokyo Night', dot: '#7aa2f7' },
  { id: 'dracula', label: 'Dracula', dot: '#bd93f9' },
  { id: 'terminal-green', label: 'Terminal', dot: '#00ff41' },
] as const;

export type CMThemeId = typeof CM_THEMES[number]['id'];

function getStoredCMTheme(): CMThemeId {
  try {
    return (localStorage.getItem('cm-theme') as CMThemeId) || 'default';
  } catch {
    return 'default';
  }
}

// Palette → CSS var definitions. Mirrors the set in CodeModeLayout
// so both entry points apply the same vars to the `.code-mode` root.
const THEME_VARS: Record<string, Record<string, string>> = {
  'catppuccin-latte': {
    '--cm-bg': '#eff1f5', '--cm-bg-secondary': '#e6e9ef', '--cm-bg-tertiary': '#ccd0da',
    '--cm-text': '#4c4f69', '--cm-text-secondary': '#5c5f77', '--cm-text-muted': '#9ca0b0',
    '--cm-accent': '#1e66f5', '--cm-success': '#40a02b', '--cm-warning': '#df8e1d',
    '--cm-error': '#d20f39', '--cm-info': '#04a5e5', '--cm-border': '#bcc0cc',
    '--cm-prompt': '#8839ef', '--cm-muted': '#9ca0b0', '--cm-surface': '#dce0e8',
  },
  'catppuccin-frappe': {
    '--cm-bg': '#303446', '--cm-bg-secondary': '#292c3c', '--cm-bg-tertiary': '#414559',
    '--cm-text': '#c6d0f5', '--cm-text-secondary': '#b5bfe2', '--cm-text-muted': '#737994',
    '--cm-accent': '#8caaee', '--cm-success': '#a6d189', '--cm-warning': '#e5c890',
    '--cm-error': '#e78284', '--cm-info': '#85c1dc', '--cm-border': '#51576d',
    '--cm-prompt': '#ca9ee6', '--cm-muted': '#737994', '--cm-surface': '#414559',
  },
  'catppuccin-mocha': {
    '--cm-bg': '#1e1e2e', '--cm-bg-secondary': '#181825', '--cm-bg-tertiary': '#313244',
    '--cm-text': '#cdd6f4', '--cm-text-secondary': '#bac2de', '--cm-text-muted': '#6c7086',
    '--cm-accent': '#89b4fa', '--cm-success': '#a6e3a1', '--cm-warning': '#f9e2af',
    '--cm-error': '#f38ba8', '--cm-info': '#89dceb', '--cm-border': '#45475a',
    '--cm-prompt': '#cba6f7', '--cm-muted': '#6c7086', '--cm-surface': '#313244',
  },
  'tokyo-night': {
    '--cm-bg': '#1a1b26', '--cm-bg-secondary': '#16161e', '--cm-bg-tertiary': '#24283b',
    '--cm-text': '#c0caf5', '--cm-text-secondary': '#a9b1d6', '--cm-text-muted': '#565f89',
    '--cm-accent': '#7aa2f7', '--cm-success': '#9ece6a', '--cm-warning': '#e0af68',
    '--cm-error': '#f7768e', '--cm-info': '#7dcfff', '--cm-border': '#3b4261',
    '--cm-prompt': '#bb9af7', '--cm-muted': '#565f89', '--cm-surface': '#24283b',
  },
  'dracula': {
    '--cm-bg': '#282a36', '--cm-bg-secondary': '#21222c', '--cm-bg-tertiary': '#343746',
    '--cm-text': '#f8f8f2', '--cm-text-secondary': '#bfbfbf', '--cm-text-muted': '#6272a4',
    '--cm-accent': '#bd93f9', '--cm-success': '#50fa7b', '--cm-warning': '#f1fa8c',
    '--cm-error': '#ff5555', '--cm-info': '#8be9fd', '--cm-border': '#44475a',
    '--cm-prompt': '#ff79c6', '--cm-muted': '#6272a4', '--cm-surface': '#343746',
  },
  'terminal-green': {
    '--cm-bg': '#0a0a0a', '--cm-bg-secondary': '#111111', '--cm-bg-tertiary': '#050505',
    '--cm-text': '#00ff41', '--cm-text-secondary': '#00cc33', '--cm-text-muted': '#007722',
    '--cm-accent': '#00ff41', '--cm-success': '#00ff41', '--cm-warning': '#ffaa00',
    '--cm-error': '#ff3333', '--cm-info': '#00aaff', '--cm-border': '#003311',
    '--cm-prompt': '#00ff41', '--cm-muted': '#007722', '--cm-surface': '#1a1a1a',
  },
};

const ALL_CM_VAR_KEYS = Object.keys(THEME_VARS['catppuccin-mocha']);

export function applyCMThemeVars(el: HTMLElement, id: string) {
  ALL_CM_VAR_KEYS.forEach((k) => el.style.removeProperty(k));
  if (id !== 'default' && THEME_VARS[id]) {
    el.setAttribute('data-cm-theme', id);
    Object.entries(THEME_VARS[id]).forEach(([k, v]) => el.style.setProperty(k, v));
  } else {
    el.removeAttribute('data-cm-theme');
  }
}

/**
 * CRT mode — opt-in scanlines / phosphor glow / glitch overlay for
 * the codemode chat column. Pure CSS effect (see codeMode-crt.css);
 * this helper just toggles `body.cm-crt` and persists the choice to
 * localStorage. The actual overlay element is rendered by the
 * ThemeSelectorPill component when active so it unmounts cleanly when
 * the user turns CRT off.
 *
 * Performance: ALL CRT animations run on transform+opacity only and
 * fire from CSS animation-delay (no rAF / setInterval). Toggling has
 * no perf cost beyond a single class-list mutation.
 */
const CRT_STORAGE_KEY = 'cm-crt-mode';

export function getStoredCRTMode(): boolean {
  try {
    return localStorage.getItem(CRT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function applyCRTMode(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) {
    document.body.classList.add('cm-crt');
  } else {
    document.body.classList.remove('cm-crt');
  }
  try {
    localStorage.setItem(CRT_STORAGE_KEY, on ? 'true' : 'false');
  } catch {
    /* quota — body class still toggled, just won't persist */
  }
}

export const ThemeSelectorPill: React.FC = () => {
  const [theme, setTheme] = useState<CMThemeId>(getStoredCMTheme);
  const [open, setOpen] = useState(false);
  const [crt, setCrt] = useState<boolean>(getStoredCRTMode);
  const [menuPos, setMenuPos] = useState<
    { top: number; left: number; placement: 'below' | 'above' } | null
  >(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const current = CM_THEMES.find((t) => t.id === theme) || CM_THEMES[0];

  const apply = useCallback((id: CMThemeId) => {
    setTheme(id);
    setOpen(false);
    try {
      localStorage.setItem('cm-theme', id);
    } catch {
      /* ignore */
    }
    const el = document.querySelector('.code-mode') as HTMLElement;
    if (el) applyCMThemeVars(el, id);
  }, []);

  const toggleCRT = useCallback(() => {
    setCrt((prev) => {
      const next = !prev;
      applyCRTMode(next);
      return next;
    });
  }, []);

  // Apply on mount + whenever `theme` changes. If the /theme slash
  // command writes to localStorage while this pill is open, we'll
  // still re-apply on next render thanks to the theme state read on
  // mount (single source of truth: the dropdown item the user picks).
  useEffect(() => {
    const el = document.querySelector('.code-mode') as HTMLElement;
    if (el) applyCMThemeVars(el, theme);
  }, [theme]);

  // Apply CRT mode on mount and any time the toggle flips. We read
  // localStorage in the initial useState so a reload restores the
  // choice without flicker; this effect ensures the body class stays
  // in sync if `crt` state ever diverges (e.g. cross-tab listener
  // could be added later — currently only the toggle mutates state).
  useEffect(() => {
    applyCRTMode(crt);
    return () => {
      // Don't remove the class on unmount — the user might be
      // navigating between routes within the SPA and the CRT
      // preference should outlive any single mount of this pill.
    };
  }, [crt]);

  // Position the portaled dropdown beneath the trigger button. We
  // portal to document.body to escape any parent overflow:hidden
  // clipping. Recompute on open + on window resize/scroll so it
  // stays anchored while the user interacts.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      if (!buttonRef.current) return;
      const r = buttonRef.current.getBoundingClientRect();
      // Live theme list is ~7 items × 28px + 8px padding ≈ 200px tall.
      // Open ABOVE the trigger when the trigger sits in the bottom half
      // of the viewport (composer toolbar is anchored to the bottom of
      // the codemode panel, so opening downward clips the list).
      const MENU_H = 220;
      const spaceBelow = window.innerHeight - r.bottom;
      const placement: 'below' | 'above' =
        spaceBelow < MENU_H && r.top > MENU_H ? 'above' : 'below';
      const top = placement === 'above' ? r.top - 4 - MENU_H : r.bottom + 4;
      setMenuPos({ top, left: r.left, placement });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on outside click — the portaled menu lives outside our DOM
  // subtree so we can't rely on blur; listen for body mousedowns.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const menu = document.querySelector('[data-cm-theme-menu]');
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        data-testid="cm-theme-selector-pill"
        onClick={() => setOpen(!open)}
        title={`Theme: ${current.label} — also available via /theme`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5ch',
          padding: '2px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'inherit',
          color: 'var(--cm-text-muted, #8b949e)',
          background: 'transparent',
          border: '1px solid var(--cm-border, #30363d)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: current.dot,
            display: 'inline-block',
          }}
        />
        <span>{current.label}</span>
      </button>
      {open && menuPos && createPortal(
        <div
          data-cm-theme-menu
          data-placement={menuPos.placement}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 50,
            background: 'var(--cm-bg-secondary, rgba(30,30,30,0.95))',
            border: '1px solid var(--cm-border, rgba(255,255,255,0.1))',
            backdropFilter: 'blur(12px)',
            borderRadius: 6,
            overflowY: 'auto',
            padding: '4px 0',
            minWidth: 160,
            maxHeight: '220px',
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
            fontFamily:
              'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
          }}
        >
          {CM_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => apply(t.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6ch',
                padding: '6px 12px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: t.id === theme ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: t.id === theme ? 'var(--cm-text, #fff)' : 'var(--cm-text-muted, #999)',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (t.id !== theme) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                if (t.id !== theme) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: t.dot,
                  flexShrink: 0,
                }}
              />
              <span>{t.label}</span>
              {t.id === theme && (
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>active</span>
              )}
            </button>
          ))}
          {/* CRT mode toggle — sits at the bottom of the theme list as
              a separator+toggle. Layers on top of whatever palette the
              user has selected (it's an aesthetic OVERLAY, not a theme
              swap). Persists separately under `cm-crt-mode`. */}
          <div
            style={{
              borderTop: '1px solid var(--cm-border, rgba(255,255,255,0.1))',
              margin: '4px 0 0',
              padding: '4px 0',
            }}
          >
            <button
              data-testid="cm-crt-toggle"
              onClick={toggleCRT}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6ch',
                padding: '6px 12px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: crt ? 'rgba(0,255,65,0.08)' : 'transparent',
                color: crt ? '#00ff41' : 'var(--cm-text-muted, #999)',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!crt) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                if (!crt) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: crt ? '#00ff41' : 'transparent',
                  border: '1px solid #00ff41',
                  boxShadow: crt ? '0 0 6px #00ff41' : 'none',
                  flexShrink: 0,
                }}
              />
              <span>CRT</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>
                {crt ? 'on' : 'off'}
              </span>
            </button>
          </div>
        </div>,
        document.body,
      )}
      {/* Overlay element — rendered ONLY when CRT is on. The visual
          effect (scanlines, vignette, roll, RGB-flicker) is fully
          driven by CSS in codeMode-crt.css; this div is the marker
          the stylesheet attaches to. `pointer-events:none` on the
          rule keeps it click-through; we also set it inline as a
          belt-and-suspenders against any rule getting overridden. */}
      {crt && createPortal(
        <div
          data-cm-crt-overlay
          aria-hidden
          style={{ pointerEvents: 'none', position: 'fixed', inset: 0 }}
        />,
        document.body,
      )}
    </>
  );
};
