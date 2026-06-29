/**
 * Phase B · primitive — `<Pill>` 5-tone status badge with icon prefix.
 *
 * The Pill replaces ad-hoc `<span>healthy</span>` rows across the admin
 * shell with a single typed component. 5 tones map 1:1 to the locked
 * status palette (--ok / --warn / --err / --info / --fg-3-as-idle).
 * Each tone carries an icon prefix that doubles as a screen-reader
 * cue and as console punctuation — `✓ ⚠ ✕ ⓘ ◌`.
 *
 * Design intent (frontend-design skill, applied within the project's
 * Inter / JetBrains lock):
 *   - Icon-as-punctuation, not Material Symbols. The five glyphs read
 *     as terminal output, not SaaS chrome.
 *   - Hairline 1px border, no shadow, sharp corners. Reads as
 *     industrial telemetry, not pill-shaped status badge.
 *   - Mono font on the body so width is predictable across rows.
 *   - Tone-colored text + icon, neutral background — accent stays the
 *     ONLY saturated color in the layout.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pill, type PillTone } from '../atoms'

const TONE_GLYPHS: Record<PillTone, string> = {
  ok: '✓',
  warn: '⚠',
  err: '✕',
  info: 'ⓘ',
  idle: '◌',
}

const ALL_TONES: PillTone[] = ['ok', 'warn', 'err', 'info', 'idle']

describe('Pill — 5-tone status badge with icon prefix', () => {
  it('renders the body text', () => {
    render(<Pill tone="ok">healthy</Pill>)
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })

  it.each(ALL_TONES)('tone "%s" applies aw-pill--%s class', (tone) => {
    const { container } = render(<Pill tone={tone}>row</Pill>)
    const el = container.querySelector('.aw-pill')
    expect(el).not.toBeNull()
    expect(el?.classList.contains(`aw-pill--${tone}`)).toBe(true)
  })

  it.each(ALL_TONES)('tone "%s" emits the correct icon glyph', (tone) => {
    const { container } = render(<Pill tone={tone}>row</Pill>)
    const icon = container.querySelector('.aw-pill__icon')
    expect(icon).not.toBeNull()
    expect(icon?.textContent).toBe(TONE_GLYPHS[tone])
  })

  it('icon precedes the body text in the DOM (so it reads as a prefix)', () => {
    const { container } = render(<Pill tone="ok">healthy</Pill>)
    const pill = container.querySelector('.aw-pill')!
    const children = [...pill.children]
    expect(children[0].classList.contains('aw-pill__icon')).toBe(true)
  })

  it('exposes the tone via aria-label so screen readers get a hint', () => {
    const { container } = render(<Pill tone="warn">latency high</Pill>)
    const el = container.querySelector('.aw-pill')
    expect(el?.getAttribute('aria-label')).toBe('warn: latency high')
  })

  it('omits the icon when iconless prop is true (compact row use)', () => {
    const { container } = render(<Pill tone="ok" iconless>healthy</Pill>)
    expect(container.querySelector('.aw-pill__icon')).toBeNull()
    expect(container.querySelector('.aw-pill')?.textContent).toBe('healthy')
  })

  it('uses no inline color literals — tone is class-driven only', () => {
    const { container } = render(<Pill tone="err">offline</Pill>)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(container.innerHTML).not.toMatch(/style=/)
  })
})
