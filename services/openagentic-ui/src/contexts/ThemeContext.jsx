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
  { name: 'Dark Blue', primary: '#1E40AF', secondary: '#3B82F6' },    // Default - Professional blue
  { name: 'Green', primary: '#16A34A', secondary: '#22C55E' },        // True green - no teal/emerald
  { name: 'Purple', primary: '#7C3AED', secondary: '#A855F7' },       // True purple - not violet
  { name: 'Orange', primary: '#EA580C', secondary: '#F97316' },       // True orange - not amber
];

export const themes = {
  dark: {
    // Primary colors - Apple Blue default
    primary: 'var(--user-accent-primary, #0A84FF)',
    secondary: 'var(--user-accent-secondary, #64D2FF)',
    accent: 'var(--user-accent-color, #F97316)',
    success: '#22C55E',       // True Green - no yellow tint
    warning: '#F97316',       // True Orange - not amber
    error: '#FF453A',         // Apple Red

    // Dark theme backgrounds - solid, macOS-style
    background: '#000000',
    surface: '#1C1C1E',
    surfaceHover: '#2C2C2E',

    // Text hierarchy - Apple dark mode
    text: '#FFFFFF',
    textSecondary: '#EBEBF5',
    textMuted: '#8E8E93',
    textDisabled: '#636366',

    // Borders - subtle
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.15)',

    // Effects - no blur by default
    shadow: '0 2px 8px rgba(0, 0, 0, 0.3)',

    // NO purple-blue gradient - use solid color
    gradientPrimary: 'var(--user-accent-primary, #0A84FF)',
    gradientSecondary: 'var(--user-accent-secondary, #64D2FF)',
    gradientDark: 'linear-gradient(180deg, #000000 0%, #1C1C1E 100%)',

    // Status colors - Apple palette
    statusHealthy: '#22C55E',
    statusWarning: '#F97316',
    statusError: '#FF453A',
    statusUnknown: '#8E8E93',
  },
  light: {
    // Light theme - Apple Blue default
    primary: 'var(--user-accent-primary, #007AFF)',  // Apple Blue for light mode
    secondary: 'var(--user-accent-secondary, #5AC8FA)',
    accent: 'var(--user-accent-color, #EA580C)',
    success: '#16A34A',       // True Green for light - no yellow tint
    warning: '#EA580C',       // True Orange for light - not amber
    error: '#FF3B30',         // Apple Red for light

    // Clean white backgrounds - macOS-style
    background: '#FFFFFF',
    surface: '#F2F2F7',
    surfaceHover: '#E5E5EA',

    // Text hierarchy - Apple light mode
    text: '#000000',
    textSecondary: '#3C3C43',
    textMuted: '#8E8E93',
    textDisabled: '#AEAEB2',

    border: 'rgba(0, 0, 0, 0.08)',
    borderHover: 'rgba(0, 0, 0, 0.15)',

    shadow: '0 2px 8px rgba(0, 0, 0, 0.1)',

    // NO purple-blue gradient - use solid color
    gradientPrimary: 'var(--user-accent-primary, #007AFF)',
    gradientSecondary: 'var(--user-accent-secondary, #5AC8FA)',
    gradientDark: 'linear-gradient(180deg, #FFFFFF 0%, #F2F2F7 100%)',

    statusHealthy: '#16A34A',
    statusWarning: '#EA580C',
    statusError: '#FF3B30',
    statusUnknown: '#8E8E93',
  }
};

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
      const saved = localStorage.getItem('ac-accent-color');
      return saved ? JSON.parse(saved) : accentColors[0]; // Default to Dark Blue
    }
    return accentColors[0];
  });
  // Background effect: always 'subtle' (zero GPU, static gradients)
  const [backgroundEffect] = useState('subtle');

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
  // 2026-04-30 — see docs/superpowers/specs/2026-04-30-chatmode-ux-parity-punchlist.md.
  const applyAccentColor = (accent) => {
    const root = document.documentElement;
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
      'Green': 'green',
      'Teal': 'teal',
      'Amber': 'amber',
      'Orange': 'amber',
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

  // Apply theme to CSS variables
  const applyTheme = (themeName) => {
    const root = document.documentElement;

    // Set data attribute for CSS-variable-based themes and styling hooks
    root.setAttribute('data-theme', themeName);

    if (cssOnlyThemes.includes(themeName)) {
      // CSS-only themes: clear any inline style overrides so CSS selectors take effect
      // These themes define all variables via [data-theme="..."] selectors
      const themeConfig = themes['dark']; // Use dark as base to know which vars to clear
      Object.keys(themeConfig).forEach((key) => {
        root.style.removeProperty(`--color-${key}`);
      });

      // All CSS-only themes use dark base for Tailwind
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      const themeConfig = themes[themeName];

      // Apply all theme variables as inline styles
      Object.entries(themeConfig).forEach(([key, value]) => {
        const cssVarName = `--color-${key}`;
        root.style.setProperty(cssVarName, value);
      });

      // Add/remove 'dark' class for Tailwind dark mode
      if (themeName === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.remove('dark');
        root.classList.add('light');
      }
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
    applyTheme(actualTheme);
    localStorage.setItem('ac-theme', theme);
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
    themes,
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

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};