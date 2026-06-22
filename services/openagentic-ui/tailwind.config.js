/** @type {import('tailwindcss').Config} */
//
// TRANSITIONAL legacy bridge (Phase 0 of the ONE-SOT theme migration).
//
// The authoritative token source is now src/styles/theme.css (Tailwind v4
// `@theme`). This JS config is loaded by theme.css via `@config` ONLY to keep
// the existing 900+ files' legacy utility names (bg-surface, text-text-secondary,
// bg-bg-1, border-line-1, bg-pri, …) resolving to the canonical vars during the
// migration. Every `colors:` entry below points at a `var(--color-*)` that
// theme.css defines and flips per [data-theme]; no literal palette lives here.
// The v4 engine needs no `safelist` (removed) — utilities are scanned from
// content + reachable via @config. This whole color block is deleted once the
// call sites are codemodded to the new utilities.
export default {
  darkMode: ['selector', '[data-theme="dark"]'], // single switch: [data-theme]
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware CSS variables
        background: 'var(--color-background)',
        'surface': {
          DEFAULT: 'var(--color-surface)',
          primary: 'var(--color-surface)',
          secondary: 'var(--color-surfaceSecondary, var(--color-surfaceHover))',
          tertiary: 'var(--color-surfaceTertiary, var(--color-surface))',
          hover: 'var(--color-surfaceHover)',
        },
        // Semantic 'bg' colors (alias for surface - used as bg-bg-*)
        'bg': {
          DEFAULT: 'var(--color-background)',
          primary: 'var(--color-background)',
          secondary: 'var(--color-surface)',
          tertiary: 'var(--color-surfaceSecondary)',
          hover: 'var(--color-surfaceHover)',
        },
        'text': {
          DEFAULT: 'var(--color-text)',
          primary: 'var(--text-primary, var(--color-text))',
          secondary: 'var(--text-secondary, var(--color-textSecondary))',
          tertiary: 'var(--text-tertiary, var(--color-textMuted))',
          muted: 'var(--text-muted, var(--color-textMuted))',
        },
        'border': {
          DEFAULT: 'var(--color-border)',
          primary: 'var(--color-border)',
          hover: 'var(--color-borderHover)',
        },
        // All literal fallbacks dropped — the vars they fell back from are
        // ALWAYS defined in theme.css (LAYER-3), so the hexes/rgbas were dead
        // AND escaped the no-hardcoding guard (which now scans this file). Each
        // entry reads a canonical var(--color-*) so the [data-theme] override
        // wins at runtime.
        'primary': {
          500: 'var(--color-primary)',
          600: 'var(--color-primary)',
        },
        glass: {
          light: 'var(--glass-surf-1)',
          DEFAULT: 'var(--glass-surf-2)',
          dark: 'var(--glass-page-bg)',
        },
        blue: {
          glow: 'var(--color-primary)',
          deep: 'var(--color-primary)',
          dark: 'var(--color-primary)',
        },
        // Semantic status colors — read the canonical tokens.
        success: {
          DEFAULT: 'var(--color-success)',
          light: 'var(--color-success)',
          bg: 'var(--callout-success-bg)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          light: 'var(--color-error)',
          bg: 'var(--callout-error-bg)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          light: 'var(--color-warning)',
          bg: 'var(--callout-warning-bg)',
        },
        info: {
          DEFAULT: 'var(--accent-info)',
          light: 'var(--accent-info)',
          bg: 'var(--callout-info-bg)',
        },
        // Accent color (user-selectable)
        accent: {
          DEFAULT: 'var(--color-primary)',
          primary: 'var(--user-accent-primary)',
          secondary: 'var(--user-accent-secondary)',
        },
        // admin-v2 Control Plane: v2 components use compact color names
        // that alias to the site's existing root CSS vars. The vars
        // (--accent, --line-1..3, --ok, --warn, --err, --info) are
        // declared by mockup-v067.css; this block only makes them
        // reachable via Tailwind utility classes like bg-pri, text-err,
        // border-ln-2. No parallel token system.
        pri: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent)',
          3: 'var(--accent)',
        },
        ln: {
          1: 'var(--line-1)',
          2: 'var(--line-2)',
          3: 'var(--line-3)',
        },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
        // Note: 'info' above is an object ({DEFAULT, light, bg}) — v2's
        // `bg-info`/`text-info` resolves to info.DEFAULT which is
        // var(--accent-info) — close enough to v2's mock --info.
        hot: 'var(--warn)',
        // Neutral grays using CSS vars
        muted: {
          DEFAULT: 'var(--color-textMuted)',
          light: 'var(--color-textMuted)',
          bg: 'var(--color-surfaceSecondary)',
        },
        // M3 Expressive tonal surface scale (task #160) — tint-based
        // elevation. Consume as `bg-surface-1`..`bg-surface-4`. The
        // existing `surface.*` object above still works for legacy
        // CSS-var references (surface / surface-primary / etc).
        'surface-0': 'var(--surface-0)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-4': 'var(--surface-4)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        // Reads the canonical glass surface gradient (theme.css --glass-bg).
        'glass-gradient': 'var(--glass-bg)',
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '64px',
      },
      animation: {
        'float': 'float 20s ease-in-out infinite',
        'glow': 'glow 4s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
      boxShadow: {
        // Read the canonical glass/accent shadow tokens (theme.css). The glow
        // now follows the user accent instead of a hardcoded Apple-blue.
        'glass': 'var(--glass-shadow)',
        'glow': '0 0 30px var(--glass-accent-glow)',
        'glow-blue': '0 0 30px var(--glass-accent-glow)',
        // M3 Expressive soft shadows (task #160) — low opacity, heavy blur.
        'soft-sm': 'var(--shadow-soft-sm)',
        'soft':    'var(--shadow-soft-md)',
        'soft-md': 'var(--shadow-soft-md)',
        'soft-lg': 'var(--shadow-soft-lg)',
        // Focus ring helper.
        'focus-ring': 'var(--focus-ring)',
      },
      borderRadius: {
        'glass': 'var(--glass-radius)',
        // M3 Expressive shape scale (task #160).
        'pill':     'var(--radius-btn-pill)',
        'btn':      'var(--radius-btn-soft)',
        'card':     'var(--radius-card)',
        'panel':    'var(--radius-panel)',
        'message':  'var(--radius-message)',
        'toast':    'var(--radius-toast)',
        'input':    'var(--radius-input)',
        'input-sm': 'var(--radius-input-sm)',
        'popover':  'var(--radius-popover)',
        'table':    'var(--radius-table)',
        'checkbox': 'var(--radius-checkbox)',
      },
      transitionTimingFunction: {
        // M3 Expressive motion curves (task #160).
        'emphasized': 'var(--ease-emphasized)',
        'standard':   'var(--ease-standard)',
        'decelerate': 'var(--ease-decelerate)',
        'accelerate': 'var(--ease-accelerate)',
      },
      transitionDuration: {
        'expressive': '200ms',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}
