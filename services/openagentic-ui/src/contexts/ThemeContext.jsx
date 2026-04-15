/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

  // Apply accent color to CSS variables
  const applyAccentColor = (accent) => {
    const root = document.documentElement;
    root.style.setProperty('--user-accent-primary', accent.primary);
    root.style.setProperty('--user-accent-secondary', accent.secondary);
    root.style.setProperty('--user-accent-color', accent.primary);

    // Save to localStorage
    localStorage.setItem('ac-accent-color', JSON.stringify(accent));
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

    // Apply theme class to body
    document.body.className = `${themeName}-theme`;
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