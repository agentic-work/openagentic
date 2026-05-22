import React from 'react'
import { useTheme, Theme, Accent } from '../hooks/useTheme'

export interface ThemePanelProps {
  open: boolean
  onClose: () => void
  /** Optional: pass theme state from a parent useTheme() to share state */
  theme?: Theme
  accent?: Accent
  setTheme?: (t: Theme) => void
  setAccent?: (a: Accent) => void
}

// Accent-picker swatches: each color is a fixed identity (the user picks an
// accent and the theme switches to a palette built from it). These are NOT
// theme-driven by definition — they're the source palette the theme picks
// FROM. Equivalent to chart palettes / brand-icon colors.
/* eslint-disable admin-tokens/no-hardcoded-admin-color */
const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: 'gcp',     label: 'GCP blue',       color: '#4285f4' },
  { id: 'green',   label: 'Mission green',  color: '#5cf08f' },
  { id: 'teal',    label: 'Editorial teal', color: '#5eead4' },
  { id: 'amber',   label: 'Warm amber',     color: '#f6c560' },
  { id: 'violet',  label: 'Violet',         color: '#c792ea' },
  { id: 'magenta', label: 'Magenta',        color: '#f472b6' },
]
/* eslint-enable admin-tokens/no-hardcoded-admin-color */

const VAR_GROUPS: { group: string; keys: string[] }[] = [
  { group: 'background', keys: ['--bg-0','--bg-1','--bg-2','--bg-3','--bg-4','--bg-5'] },
  { group: 'foreground', keys: ['--fg-0','--fg-1','--fg-2','--fg-3','--fg-4'] },
  { group: 'line',       keys: ['--ln-1','--ln-2','--ln-3'] },
  { group: 'accent',     keys: ['--pri','--pri-2','--pri-3','--ok','--warn','--err','--info','--hot'] },
]

export function ThemePanel({
  open,
  onClose,
  theme: themeProp,
  accent: accentProp,
  setTheme: setThemeProp,
  setAccent: setAccentProp,
}: ThemePanelProps) {
  const ownTheme = useTheme()
  const theme = themeProp ?? ownTheme.theme
  const accent = accentProp ?? ownTheme.accent
  const setTheme = setThemeProp ?? ownTheme.setTheme
  const setAccent = setAccentProp ?? ownTheme.setAccent
  if (!open) return null

  const resolveVar = (k: string) => {
    try { return getComputedStyle(document.body).getPropertyValue(k).trim() } catch { return '' }
  }

  return (
    <div
      className="fixed top-[44px] right-3 w-[380px] max-h-[calc(100vh-60px)] bg-bg-1 border border-ln-3 rounded-md shadow-2xl z-50 flex flex-col overflow-hidden"
      data-testid="theme-panel"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ln-2 bg-bg-0">
        <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase text-fg-1">&#9656; theme · css variables</span>
        <button onClick={onClose} className="text-fg-3 text-[11px] px-2 py-0.5 border border-ln-2 rounded">ESC</button>
      </div>
      <div className="overflow-y-auto px-4 py-4">
        <div className="mb-4">
          <div className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-fg-3 mb-2">mode</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['dark','light'] as Theme[]).map(m => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                className={[
                  'px-3 py-2.5 rounded text-xs font-semibold border',
                  theme === m
                    ? 'border-pri bg-bg-2 text-fg-0'
                    : 'border-ln-2 bg-bg-2 text-fg-2 hover:border-ln-3 hover:text-fg-0',
                ].join(' ')}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-fg-3 mb-2">accent</div>
          <div className="grid grid-cols-6 gap-1.5">
            {ACCENTS.map(a => (
              <button
                key={a.id}
                data-testid={`accent-${a.id}`}
                title={a.label}
                aria-label={a.label}
                onClick={() => setAccent(a.id)}
                className={[
                  'aspect-square rounded border-2 transition-transform',
                  accent === a.id ? 'border-fg-0' : 'border-transparent hover:-translate-y-px',
                ].join(' ')}
                style={{ background: a.color }}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-fg-3 mb-2">:root · live values</div>
          <div className="border border-ln-2 rounded overflow-hidden font-mono text-[11px]">
            {VAR_GROUPS.map(sec => (
              <React.Fragment key={sec.group}>
                <div className="px-3 py-1 bg-bg-0 border-b border-ln-2 text-fg-3 font-bold tracking-[0.14em] uppercase text-[10px]">
                  {sec.group}
                </div>
                {sec.keys.map(k => (
                  <div
                    key={k}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-1 bg-bg-2 border-b border-ln-1 last:border-b-0 hover:bg-bg-3"
                  >
                    <span className="text-fg-2">{k}</span>
                    <span
                      className="w-3 h-3 rounded-[2px] shadow-[inset_0_0_0_1px_var(--line-3)]"
                      style={{ background: resolveVar(k) }}
                    />
                    <span className="text-fg-0 tabular-nums text-[10px]">{resolveVar(k)}</span>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
