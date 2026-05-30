import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type Accent = 'gcp' | 'green' | 'teal' | 'amber' | 'violet' | 'magenta'
export type Density = 'compact' | 'cozy' | 'comfortable'

const AC_DENSITY_KEY = 'ac-density'

// Canonical theme + accent storage is the chat-app's `ac-*` keys (App.tsx).
// `openagentic-*` keys were our v2-only fork; we now read/write both so the global
// "Theme" / "Accent Color" picker (shared between chat shell and admin v2)
// keeps both surfaces in sync. New writes target `ac-*`; legacy `openagentic-*` is
// kept as a fallback for users with stale storage.
const AC_THEME_KEY = 'ac-theme'
const AC_ACCENT_KEY = 'ac-accent-color'
const OpenAgentic_THEME_KEY = 'openagentic-theme'
const OpenAgentic_ACCENT_KEY = 'openagentic-accent'

// Bridge — when the admin theme picker flips dark↔light, also rewrite
// the legacy `--color-*` inline tokens that ThemeContext.applyTheme set
// on app boot. Without this, those inline values stay stuck at the
// initial theme and any DashboardOverview / chat surface that reads
// var(--color-surface) refuses to switch with the rest of the admin
// chrome. Values must mirror `themes.dark` / `themes.light` in
// contexts/ThemeContext.jsx — keep them in sync.
const LEGACY_COLOR_TOKENS: Record<Theme, Record<string, string>> = {
  dark: {
    primary: 'var(--user-accent-primary, #0A84FF)',
    secondary: 'var(--user-accent-secondary, #64D2FF)',
    accent: 'var(--user-accent-color, #F97316)',
    success: '#22C55E',
    warning: '#F97316',
    error: '#FF453A',
    background: '#000000',
    surface: '#1C1C1E',
    surfaceHover: '#2C2C2E',
    surfaceSecondary: '#2C2C2E',
    surfaceTertiary: '#3A3A3C',
    text: '#FFFFFF',
    textSecondary: '#EBEBF5',
    textMuted: '#8E8E93',
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.15)',
    shadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
  },
  light: {
    primary: 'var(--user-accent-primary, #007AFF)',
    secondary: 'var(--user-accent-secondary, #5AC8FA)',
    accent: 'var(--user-accent-color, #EA580C)',
    success: '#16A34A',
    warning: '#EA580C',
    error: '#FF3B30',
    background: '#FFFFFF',
    surface: '#F2F2F7',
    surfaceHover: '#E5E5EA',
    surfaceSecondary: '#E5E5EA',
    surfaceTertiary: '#D1D1D6',
    text: '#000000',
    textSecondary: '#3C3C43',
    textMuted: '#8E8E93',
    border: 'rgba(0, 0, 0, 0.08)',
    borderHover: 'rgba(0, 0, 0, 0.15)',
    shadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
}

function applyLegacyColorTokens(theme: Theme) {
  const root = document.documentElement
  const tokens = LEGACY_COLOR_TOKENS[theme]
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--color-${key}`, value)
  }
  // Tailwind dark-mode marker — some shared chat components key off the class
  if (theme === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.remove('dark')
    root.classList.add('light')
  }
}

function readTheme(): Theme {
  try {
    // Prefer ac-theme (canonical). 'system' maps to OS preference.
    const ac = localStorage.getItem(AC_THEME_KEY)
    if (ac === 'dark' || ac === 'light') return ac
    if (ac === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    const awp = localStorage.getItem(OpenAgentic_THEME_KEY)
    if (awp === 'dark' || awp === 'light') return awp
  } catch { /* ignore */ }
  return 'dark'
}

// Map an `ac-accent-color` object (`{name,primary,secondary}`) to our internal
// Accent token. Anything we don't recognise falls back to gcp (blue).
function mapAccentObjectToToken(obj: any): Accent | null {
  if (!obj || typeof obj !== 'object') return null
  const name: string | undefined = obj.name
  if (!name) return null
  switch (name.toLowerCase()) {
    case 'blue':
    case 'gcp':
      return 'gcp'
    case 'green':
      return 'green'
    case 'teal':
      return 'teal'
    case 'amber':
    case 'orange':
      return 'amber'
    case 'violet':
    case 'purple':
      return 'violet'
    case 'magenta':
    case 'pink':
      return 'magenta'
    default:
      return null
  }
}

function readAccent(): Accent {
  try {
    const acRaw = localStorage.getItem(AC_ACCENT_KEY)
    if (acRaw) {
      const parsed = JSON.parse(acRaw)
      const token = mapAccentObjectToToken(parsed)
      if (token) return token
    }
    const awp = localStorage.getItem(OpenAgentic_ACCENT_KEY)
    const valid: readonly Accent[] = ['gcp', 'green', 'teal', 'amber', 'violet', 'magenta']
    if (awp && (valid as readonly string[]).includes(awp)) return awp as Accent
  } catch { /* ignore */ }
  return 'gcp'
}

function readDensity(): Density {
  try {
    const v = localStorage.getItem(AC_DENSITY_KEY)
    if (v === 'compact' || v === 'cozy' || v === 'comfortable') return v
  } catch { /* ignore */ }
  // B'-8 (2026-05-07): default density flipped from 'cozy' to 'compact'.
  // Cozy was the previous default and got named as "too far apart /
  // cognitively draining" by the user. Compact reduces every spacing
  // token by ~30% (row 24px / col-pad 8px / gap 4-8-12) — the GCP
  // Console-grade target for ops pages. Operators who prefer a less
  // dense view flip via the topbar density tabs; their explicit
  // choice persists to localStorage and overrides this default.
  return 'compact'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readTheme())
  const [accent, setAccentState] = useState<Accent>(() => readAccent())
  const [density, setDensityState] = useState<Density>(() => readDensity())

  // Reflect + persist on every change (and on first mount).
  // CRITICAL: write to documentElement (html) — admin-v2-accents.css and
  // mockup-v067.css both anchor selectors on `html[data-theme=...]` /
  // `html[data-accent=...]` / `html[data-density=...]`. Body-only writes
  // are silently ignored by those rules. We keep body in sync for any
  // legacy CSS that targets `body[data-theme=...]` (admin-overhaul, etc).
  //
  // ALSO mirror the legacy --color-* tokens that ThemeContext.applyTheme
  // writes as INLINE styles. Without this bridge, switching the admin
  // theme picker only flips data-theme — the inline --color-surface /
  // --color-background / --color-text values stay stuck at whatever
  // ThemeContext set on app boot, so DashboardOverview cards (which
  // read var(--color-surface), not --bg-1) refuse to switch theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
    try {
      localStorage.setItem(OpenAgentic_THEME_KEY, theme)
      // Don't clobber 'system' if the user picked it — only mirror dark/light.
      const ac = localStorage.getItem(AC_THEME_KEY)
      if (ac !== 'system') localStorage.setItem(AC_THEME_KEY, theme)
    } catch { /* ignore */ }
    applyLegacyColorTokens(theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.accent = accent
    document.body.dataset.accent = accent
    try { localStorage.setItem(OpenAgentic_ACCENT_KEY, accent) } catch { /* ignore */ }
  }, [accent])

  useEffect(() => {
    document.documentElement.dataset.density = density
    try { localStorage.setItem(AC_DENSITY_KEY, density) } catch { /* ignore */ }
  }, [density])

  // Keep in sync when the chat-app side updates ac-theme / ac-accent-color
  // (e.g. user toggles theme from the global Settings menu while in admin v2).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AC_THEME_KEY || e.key === OpenAgentic_THEME_KEY) setThemeState(readTheme())
      if (e.key === AC_ACCENT_KEY || e.key === OpenAgentic_ACCENT_KEY) setAccentState(readAccent())
      if (e.key === AC_DENSITY_KEY) setDensityState(readDensity())
    }
    window.addEventListener('storage', onStorage)
    // Also re-read on focus — same-tab writes don't fire `storage`.
    const onFocus = () => {
      setThemeState(readTheme())
      setAccentState(readAccent())
      setDensityState(readDensity())
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return {
    theme,
    accent,
    density,
    setTheme: useCallback((t: Theme) => setThemeState(t), []),
    setAccent: useCallback((a: Accent) => setAccentState(a), []),
    setDensity: useCallback((d: Density) => setDensityState(d), []),
  }
}
