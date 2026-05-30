import React from 'react'

export type LogSeverity = 'info' | 'ok' | 'warn' | 'err'

export interface LogRowProps {
  severity: LogSeverity
  timestamp: string
  source: string
  /** When true, renders source in accent colour (used for admin-facing actors). */
  sourceAccent?: boolean
  /** Message body. May be a string or rich React (code blocks, bold actors). */
  message: React.ReactNode
  meta?: React.ReactNode
}

/**
 * LogRow — single row of an audit/event/error stream. Five-column grid:
 * [severity-dot] [timestamp] [source] [message] [meta]. All five Archetype-D
 * pages must use this; no bespoke log layouts.
 */
export function LogRow({ severity, timestamp, source, sourceAccent, message, meta }: LogRowProps) {
  return (
    <div
      data-severity={severity}
      style={{
        display: 'grid',
        gridTemplateColumns: '12px 90px 110px 1fr auto',
        gap: 10,
        padding: '6px 14px',
        borderBottom: '1px solid var(--ap-ln-1, var(--ln-1))',
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        alignItems: 'center',
        color: 'var(--ap-fg-1, var(--fg-1))',
      }}
    >
      <span
        aria-hidden="true"
        data-severity={severity}
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: SEV_COLOR[severity],
          alignSelf: 'center',
        }}
      />
      <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>{timestamp}</span>
      <span
        data-source-accent={sourceAccent ? 'true' : undefined}
        style={{
          color: sourceAccent ? 'var(--ap-accent, var(--accent))' : 'var(--ap-fg-2, var(--fg-2))',
        }}
      >
        {source}
      </span>
      <span>{message}</span>
      {meta != null && <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>{meta}</span>}
    </div>
  )
}

const SEV_COLOR: Record<LogSeverity, string> = {
  info: 'var(--ap-info, var(--info))',
  ok:   'var(--ap-ok, var(--ok))',
  warn: 'var(--ap-warn, var(--warn))',
  err:  'var(--ap-err, var(--err))',
}
