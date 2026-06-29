import React, { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

/**
 * TopBar — thin main-area header.
 *
 * Layout: LIVE indicator on the left, env tag in the center, clock on the
 * right. The Admin AI Assistant input bar that previously lived in the
 * top-bar moved to a bottom-anchored `<AdminAgentDock />` (mounted at the
 * shell level) — users disliked the placement next to the LIVE indicator.
 */
export function TopBar({
  env,
}: {
  user?: { initials: string }
  env?: string
}) {
  const [now, setNow] = useState<string>(() => new Date().toLocaleTimeString())
  useEffect(() => {
    const h = setInterval(() => setNow(new Date().toLocaleTimeString()), 30_000)
    return () => clearInterval(h)
  }, [])

  return (
    <header className="flex items-center px-5 h-[44px] bg-bg-0 border-b border-ln-2 text-xs gap-3 font-ui">
      <span className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--ok)' }}>
        <span aria-hidden className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: 'var(--ok)', boxShadow: '0 0 6px var(--ok)' }} />
        <span>LIVE</span>
      </span>
      {env && (
        <span className="text-fg-3 font-mono text-[11px]">
          {env}
        </span>
      )}
      <div className="flex items-center gap-2 text-[11px] text-fg-3 font-mono ml-auto">
        <Clock size={11} className="opacity-50" />
        <span>{now}</span>
      </div>
    </header>
  )
}
