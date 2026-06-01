import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export type Accent = 'orange' | 'gcp' | 'green' | 'teal' | 'amber' | 'violet' | 'magenta'
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

// ONE-SOT migration: the hardcoded LEGACY_COLOR_TOKENS map (a 4th copy of the
// dark/light palette, hand-synced with ThemeContext) is DELETED. The canonical
// --color-* tokens now live ONLY in src/styles/theme.css, keyed on
// [data-theme], so flipping the attribute repaints every surface — no inline
// setProperty of palette values needed. This hook now only toggles
// [data-theme] (+ the legacy .dark/.light class some shared chat components
// still read off of).
function applyThemeClass(theme: Theme) {
  const root = document.documentElement
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
// Accent token. Anything we don't recognise falls back to the brand orange.
function mapAccentObjectToToken(obj: any): Accent | null {
  if (!obj || typeof obj !== 'object') return null
  const name: string | undefined = obj.name
  if (!name) return null
  switch (name.toLowerCase()) {
    // Brand default — signal orange (#FF5722) has its OWN token now; it must
    // NOT collapse into the stale legacy 'amber' (#ffb547).
    case 'orange':
      return 'orange'
    case 'blue':
    case 'gcp':
      return 'gcp'
    case 'green':
      return 'green'
    case 'teal':
      return 'teal'
    case 'amber':
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
    const valid: readonly Accent[] = ['orange', 'gcp', 'green', 'teal', 'amber', 'violet', 'magenta']
    if (awp && (valid as readonly string[]).includes(awp)) return awp as Accent
  } catch { /* ignore */ }
  // Missing/unknown stored accent → brand signal orange (#FF5722), NOT the
  // old blue/amber default.
  return 'orange'
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
  // The canonical --color-* tokens flip purely off [data-theme] (theme.css
  // owns them now), so we just set the attribute on <html> + <body> and the
  // whole surface — DashboardOverview cards included — repaints.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
    try {
      localStorage.setItem(OpenAgentic_THEME_KEY, theme)
      // Don't clobber 'system' if the user picked it — only mirror dark/light.
      const ac = localStorage.getItem(AC_THEME_KEY)
      if (ac !== 'system') localStorage.setItem(AC_THEME_KEY, theme)
    } catch { /* ignore */ }
    applyThemeClass(theme)
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
