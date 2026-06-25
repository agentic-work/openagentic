/**
 * ThemeContext - Central theming system for OpenAgentic
 *
 * Architecture:
 * - CSS variables (index.css) are the source of truth for colors
 * - ThemeContext reads/writes CSS variables and provides React integration
 * - Tailwind config maps semantic names to CSS variables
 *
 * Usage:
 * ```jsx
 * const { theme, resolvedTheme, changeTheme, accentColor, backgroundEffect } = useTheme();
 * ```
 *
 * @module ThemeContext
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/** @type {React.Context<ThemeContextValue|undefined>} */
const ThemeContext = createContext();

/**
 * Accent color presets - 4 professional options (Dark Blue is default)
 * @typedef {Object} AccentColor
 * @property {string} name - Display name for the color
 * @property {string} primary - Primary color hex value
 * @property {string} secondary - Secondary/lighter color hex value
 */
export const accentColors = [
  { name: 'Emerald', primary: '#34D399', secondary: '#6EE7B7' },      // Default — openagentics.io brand green
  { name: 'Blue', primary: '#1E40AF', secondary: '#3B82F6' },         // Professional blue
  { name: 'Orange', primary: '#FF5722', secondary: '#FFB87E' },       // Signal orange
  { name: 'Purple', primary: '#7C3AED', secondary: '#A855F7' },       // True purple
];

/**
 * Pick a WCAG-legible text color to sit ON a filled accent swatch. The brand
 * default on-accent is ink (#0E0D0B), which is fine for the light/warm accents
 * (orange/emerald/amber) but unreadable on dark accent fills (Blue #1E40AF,
 * Purple #7C3AED). We compute the accent's sRGB relative luminance and return
 * cream for dark accents / ink for light ones, so any accent — including a
 * user-supplied hex — keeps its filled buttons & avatar text readable.
 * Non-hex inputs (rgb()/var()/named) fall back to ink, matching the prior
 * behavior. Brand tokens: ink #0E0D0B, cream #F4EFE6.
 */
export function onAccentFor(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return '#0E0D0B';
  const n = parseInt(m[1], 16);
  const toLin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * toLin((n >> 16) & 255) +
    0.7152 * toLin((n >> 8) & 255) +
    0.0722 * toLin(n & 255);
  // Contrast vs cream(#F4EFE6, L≈0.86) vs ink(#0E0D0B, L≈0.0045): pick whichever
  // yields the higher ratio. The crossover sits near L≈0.0645.
  const ratioCream = (0.862 + 0.05) / (lum + 0.05);
  const ratioInk = (lum + 0.05) / (0.0045 + 0.05);
  return ratioCream > ratioInk ? '#F4EFE6' : '#0E0D0B';
}

/**
 * Legacy `--color-<key>` names that OLDER builds wrote inline on
 * document.documentElement (via the now-deleted `themes={dark,light}` JS
 * palette). theme.css is the SOLE source of truth for the palette now — it
 * defines every token and flips them off `[data-theme]`. This list exists only
 * so `applyTheme` can DEFENSIVELY clear any stale inline residue a returning
 * user might still carry, letting theme.css's values win. It is NOT a palette
 * (no color values) — just the key names to strip.
 */
const LEGACY_INLINE_COLOR_KEYS = [
  'primary', 'secondary', 'accent', 'success', 'warning', 'error',
  'background', 'surface', 'surfaceHover',
  'text', 'textSecondary', 'textMuted', 'textDisabled',
  'border', 'borderHover', 'shadow',
  'gradientPrimary', 'gradientSecondary', 'gradientDark',
  'statusHealthy', 'statusWarning', 'statusError', 'statusUnknown',
];

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Initialize from localStorage or default to 'dark'
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ac-theme') || 'dark';
    }
    return 'dark';
  });
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  const [accentColor, setAccentColor] = useState(() => {
    // Initialize accent color from localStorage
    if (typeof window !== 'undefined') {
      // One-time migration to the openagentic signal-orange brand default.
      // Returning users carry the old "Dark Blue" default from the previous
      // (agenticwork-derived) build; reset it once so the OSS build shows its own
      // visual identity. Explicit non-default accents are preserved.
      try {
        // oa-brand-3: also clear the stale legacy 'amber' admin token that the
        // old Orange→amber mapping wrote to localStorage['openagentic-accent']
        // (and data-accent), which forced --color-accent to #ffb547 over the
        // brand signal. applyAccentColor re-derives the correct token on mount.
        const VER = 'oa-brand-4';
        if (localStorage.getItem('oa-theme-version') !== VER) {
          const cur = JSON.parse(localStorage.getItem('ac-accent-color') || 'null');
          // Migrate older defaults — the agenticwork "Dark Blue" AND the interim
          // signal-orange — to the openagentics.io brand green (accentColors[0]).
          // Explicit non-default accent picks are preserved.
          const isOldDefault = !cur || cur.name === 'Dark Blue' || cur.name === 'Orange' ||
            ['#1E40AF', '#0A84FF', '#007AFF', '#3B82F6', '#FF5722'].includes(cur.primary);
          if (isOldDefault) localStorage.setItem('ac-accent-color', JSON.stringify(accentColors[0]));
          // Drop a stale 'amber' admin token left by the previous Orange→amber
          // mapping so it can't override the brand signal on first paint.
          if (localStorage.getItem('openagentic-accent') === 'amber') {
            localStorage.removeItem('openagentic-accent');
          }
          localStorage.setItem('oa-theme-version', VER);
        }
      } catch { /* ignore */ }
      const saved = localStorage.getItem('ac-accent-color');
      return saved ? JSON.parse(saved) : accentColors[0]; // Default: signal orange
    }
    return accentColors[0];
  });
  // Background effect: 'subtle' (zero-GPU static gradients) or 'off'. Restored
  // from localStorage so the user's choice survives reloads, matching the
  // setBackgroundEffect persistence below.
  const [backgroundEffect, setBackgroundEffectState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ac-background-effect');
      return saved === 'off' || saved === 'subtle' ? saved : 'subtle';
    }
    return 'subtle';
  });

  // Backwards compatibility alias
  const backgroundAnimations = backgroundEffect !== 'off';

  // Function to get system theme preference
  const getSystemTheme = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  };

  // Apply accent color to CSS variables.
  //
  // Chatmode-v2 (mocks/UX/01-cloud-ops.html design system) reads
  // --user-accent-primary directly for the solid accent, plus
  // --user-accent-soft (alpha 0.14) and --user-accent-line (alpha 0.32)
  // for tinted backgrounds and 1px borders on inline cards. Without these
  // soft+line derivations, the accent dropdown only repaints chrome and
  // leaves chatmode tool cards stuck on the canonical purple. Caught
  // 2026-04-30 — the design notes.
  const applyAccentColor = (accent) => {
    const root = document.documentElement;
    // CANONICAL single accent driver (theme.css SOT). --color-accent and its
    // soft/line tints all derive from --user-accent via color-mix, so this one
    // write repaints accent everywhere.
    root.style.setProperty('--user-accent', accent.primary);

    // On-accent text contrast: theme.css defaults --color-on-accent to brand ink
    // (#0E0D0B), which is correct for the orange/emerald/amber accents but FAILS
    // WCAG on the DARK accent fills (e.g. Blue #1E40AF = 2.2:1, Purple #7C3AED =
    // 3.4:1 against ink). Compute the readable on-accent color from the accent's
    // relative luminance so filled buttons/avatars stay legible for ANY accent
    // (incl. custom hexes). Light accent → ink; dark accent → cream.
    root.style.setProperty('--color-on-accent', onAccentFor(accent.primary));
    // Legacy accent vars (still read by 900+ files) — kept during Phase 0.
    root.style.setProperty('--user-accent-primary', accent.primary);
    root.style.setProperty('--user-accent-secondary', accent.secondary);
    root.style.setProperty('--user-accent-color', accent.primary);

    // Derive --user-accent-soft / --user-accent-line for chatmode-v2.
    // We pass through CSS color-mix() so any input form (#hex, rgb(),
    // hsl(), oklch(), or already-themed CSS var) yields a correctly
    // tinted alpha — no hand-rolled regex parsing of the picker value.
    // Falls back gracefully on browsers without color-mix (Safari < 16.4)
    // because the .cm-v2 declarations carry literal-rgba defaults.
    root.style.setProperty(
      '--user-accent-soft',
      `color-mix(in srgb, ${accent.primary} 14%, transparent)`
    );
    root.style.setProperty(
      '--user-accent-line',
      `color-mix(in srgb, ${accent.primary} 32%, transparent)`
    );
    root.style.setProperty(
      '--user-accent-soft-light',
      `color-mix(in srgb, ${accent.primary} 10%, transparent)`
    );

    // 2026-05-13 fix: admin v3 paints --accent / --accent-dim / --accent-glow
    // from html[data-accent="<token>"] selectors in admin-v2-accents.css.
    // We write the token here too so changing the accent in this menu also
    // repaints the admin shell live (was previously broken — admin's own
    // useTheme hook only re-read on `storage` event, which doesn't fire on
    // same-tab writes). Map our accentColors[] names → admin tokens; unknown
    // names fall through with the user-accent-* CSS vars still set.
    const nameToAdminToken = {
      'Dark Blue': 'gcp',
      'Blue': 'gcp',
      // Brand default — openagentics.io emerald; admin 'green' token is the closest
      // preset for the data-accent fallback (the inline --user-accent #34D399 wins anyway).
      'Emerald': 'green',
      'Green': 'green',
      'Teal': 'teal',
      'Amber': 'amber',
      // Brand default — route the signal-orange accent to its OWN admin token
      // (= #FF5722) instead of the stale legacy 'amber' (#ffb547). Mapping
      // Orange→amber previously forced html[data-accent="amber"] to win over
      // --user-accent and painted the whole app amber.
      'Orange': 'orange',
      'Violet': 'violet',
      'Purple': 'violet',
      'Magenta': 'magenta',
      'Pink': 'magenta',
    };
    const token = nameToAdminToken[accent.name];
    if (token) {
      root.dataset.accent = token;
      document.body.dataset.accent = token;
      try { localStorage.setItem('openagentic-accent', token); } catch { /* ignore */ }
    }

    // Save to localStorage
    localStorage.setItem('ac-accent-color', JSON.stringify(accent));

    // Same-tab notify: admin shell's useTheme listens for `storage` (which
    // does NOT fire same-tab) and `focus` — so changing accent from the chat
    // dropdown while admin is open silently failed before. Dispatch a manual
    // storage event so admin re-reads accent immediately.
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'ac-accent-color',
        newValue: JSON.stringify(accent),
      }));
    } catch { /* older browsers: best-effort */ }
  };

  // CSS-only themes are now scoped to code mode only (.code-mode[data-cm-theme])
  // Global themes are just 'dark' and 'light'
  const cssOnlyThemes = [];

  // Apply theme. The SINGLE switch: theme.css owns every --color-* and flips
  // them off [data-theme]. ThemeContext therefore only sets the attribute —
  // it no longer writes a full --color-* object inline (that was the old
  // duplicate palette; theme.css is now the SOT). The .dark/.light class is
  // kept solely because a few third-party components key off it; it drives no
  // first-party CSS anymore.
  const applyTheme = (themeName) => {
    const root = document.documentElement;

    // Set data attribute — the canonical theme switch.
    root.setAttribute('data-theme', themeName);
    // Mirror onto <body> too: the admin v3 useTheme hook anchors some legacy
    // selectors on body[data-theme] (admin-overhaul.css), and writing it here
    // means a same-tab theme toggle from the chat/admin Settings menu repaints
    // body-scoped rules instantly — no reload.
    document.body.setAttribute('data-theme', themeName);

    // Defensive cleanup: remove any stale inline --color-* overrides written by
    // OLDER builds (the deleted themes={dark,light} JS palette used to write
    // these inline). theme.css is now the SOT and flips every token off
    // [data-theme]; this just clears legacy inline residue so those values win.
    LEGACY_INLINE_COLOR_KEYS.forEach((key) => {
      root.style.removeProperty(`--color-${key}`);
    });

    if (themeName === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }

    // Preserve any existing body classes (tailwind, plugins) and replace
    // only the legacy theme-class marker. The class is kept because a few
    // third-party components (not in this repo) key off it, but it no
    // longer drives any CSS rules — body bg reads var(--bg-0) directly
    // from the tokenized theme.
    const classes = document.body.className
      .split(/\s+/)
      .filter((c) => c && !c.endsWith('-theme'));
    classes.push(`${themeName}-theme`);
    document.body.className = classes.join(' ');

    // Same-tab notify (mirrors applyAccentColor). The admin v3 useTheme hook
    // re-reads theme/accent only on `storage` (which does NOT fire same-tab)
    // and `focus` — so toggling the theme from the chat/admin Settings menu
    // while an admin surface is mounted previously needed a reload/blur to
    // repaint. Dispatch a manual storage event so admin re-syncs instantly.
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'ac-theme',
        newValue: themeName,
      }));
    } catch { /* older browsers: best-effort */ }
  };

  // Apply theme and accent color immediately on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('ac-theme') || 'dark';
    let actualTheme = savedTheme;

    if (savedTheme === 'system') {
      actualTheme = getSystemTheme();
    }

    setTheme(savedTheme);
    setResolvedTheme(actualTheme);
    applyTheme(actualTheme);

    // Apply saved accent color
    applyAccentColor(accentColor);
  }, []);

  // Handle theme changes
  useEffect(() => {
    let actualTheme = theme;

    if (theme === 'system') {
      actualTheme = getSystemTheme();

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        const newTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newTheme);
        applyTheme(newTheme);
      };

      mediaQuery.addEventListener('change', handleChange);

      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    setResolvedTheme(actualTheme);
    // Persist BEFORE applyTheme so the synthetic `ac-theme` storage event that
    // applyTheme dispatches finds the fresh value when admin's useTheme calls
    // readTheme(). We store the user's choice verbatim (`theme`, which may be
    // 'system') so the 'system' sentinel survives; applyTheme paints the
    // RESOLVED dark/light onto [data-theme].
    localStorage.setItem('ac-theme', theme);
    applyTheme(actualTheme);
  }, [theme]);

  // Report theme/accent preferences to API for analytics (fire-and-forget)
  const reportPreference = (prefs) => {
    try {
      fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            theme: prefs.theme,
            accentColor: prefs.accentColor,
            lastThemeChange: new Date().toISOString(),
          }
        }),
      }).catch(() => {}); // Silent — analytics only
    } catch {}
  };

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
    reportPreference({ theme: newTheme });
  };

  const changeAccentColor = (newAccent) => {
    setAccentColor(newAccent);
    applyAccentColor(newAccent);
    reportPreference({ accentColor: newAccent.name });
  };

  // Set background effect: 'off' | 'subtle'
  const setBackgroundEffect = (effect) => {
    const validEffects = ['off', 'subtle'];
    const newEffect = validEffects.includes(effect) ? effect : 'subtle';
    setBackgroundEffectState(newEffect);
    localStorage.setItem('ac-background-effect', newEffect);
  };

  // Toggle background effect: off <-> subtle
  const toggleBackgroundAnimations = () => {
    const newEffect = backgroundEffect === 'off' ? 'subtle' : 'off';
    setBackgroundEffect(newEffect);
  };

  const value = {
    theme,
    resolvedTheme,
    changeTheme,
    accentColor,
    accentColors,
    changeAccentColor,
    backgroundAnimations, // Backwards compat: true if effect !== 'off'
    backgroundEffect,     // 'off' | 'subtle'
    setBackgroundEffect,  // Setter function
    toggleBackgroundAnimations, // Toggle off <-> subtle
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node,
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};