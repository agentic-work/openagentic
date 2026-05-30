import React from 'react'

export type PillTone = 'ok' | 'warn' | 'err' | 'idle' | 'info'

export interface PillProps {
  tone: PillTone
  children: React.ReactNode
}

/**
 * Pill — short status badge. Five tones map to --ap-ok / --ap-warn / --ap-err
 * / neutral / --ap-info. The dot to the left of the label inherits the tone
 * colour. No hex literals; everything reads through tokens.
 */
export function Pill({ tone, children }: PillProps) {
  const palette = TONE_PALETTE[tone]
  return (
    <span
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        padding: '2px 8px',
        borderRadius: 2,
        background: palette.bg,
        color: palette.fg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
        }}
      />
      {children}
    </span>
  )
}

const TONE_PALETTE: Record<PillTone, { bg: string; fg: string }> = {
  ok:   { bg: 'var(--ap-ok-soft, var(--ok-soft))',   fg: 'var(--ap-ok, var(--ok))' },
  warn: { bg: 'var(--ap-warn-soft, var(--warn-soft))', fg: 'var(--ap-warn, var(--warn))' },
  err:  { bg: 'var(--ap-err-soft, var(--err-soft))',  fg: 'var(--ap-err, var(--err))' },
  idle: { bg: 'var(--ap-bg-2, var(--bg-2))',          fg: 'var(--ap-fg-2, var(--fg-2))' },
  info: { bg: 'var(--ap-info-soft, var(--info-soft))', fg: 'var(--ap-info, var(--info))' },
}
