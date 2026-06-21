import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SharedMarkdownRenderer } from '@/features/chat/components/MessageContent/SharedMarkdownRenderer'
import { useTheme } from '@/contexts/ThemeContext'
import { allSidebarIds } from '@/features/admin/shell-v2/sidebar-items'
import { onKeyActivate } from '@/utils/a11y'

/**
 * AdminAIBar / AdminAIPanel — the in-product AI assistant per
 * STANDARDS.md §13. The bar lives in the TopBar, persistent on every
 * admin page. Clicking or focusing it (or hitting ⌘K) opens the panel.
 *
 * The panel is a thin wrapper: it owns presentation + the suggestion
 * list, and delegates "ask the AI" to a caller-supplied `onAsk` async
 * function that returns a string. In production that hits a backend
 * route; in unit tests we pass a mock.
 *
 * Theme-aware: --bg-1, --bg-2, --line-2/3, --accent, --ok, --fg-0/2/3.
 */
export function AdminAIBar({
  onOpen,
  placeholder = 'Ask Admin AI · find a setting · explain a page · walk me through…',
}: {
  onOpen: () => void
  placeholder?: string
}) {
  return (
    <div className="relative flex-1" style={{ maxWidth: 520 }}>
      <input
        type="text"
        readOnly
        placeholder={placeholder}
        onFocus={onOpen}
        onClick={onOpen}
        className="bg-bg-2 text-fg-0 font-mono w-full rounded border border-ln-2 py-[6px] pl-7 pr-12 text-[11px]"
        style={{ outline: 'none' }}
      />
      <span
        aria-hidden
        className="font-mono absolute left-2 top-1/2 -translate-y-1/2 text-[11px]"
        style={{ color: 'var(--ap-accent, var(--accent))' }}
      >
        ⌘
      </span>
      <span
        aria-hidden
        className="font-mono absolute right-2 top-1/2 -translate-y-1/2 rounded border border-ln-2 bg-bg-1 px-1 py-[1px] text-[9px] text-fg-3"
      >
        ⌘ K
      </span>
    </div>
  )
}

export interface Suggestion {
  q: string
  /** Optional small icon glyph or emoji. */
  icon?: React.ReactNode
}

export interface ChatMessage {
  who: 'you' | 'ai'
  text: React.ReactNode
}

/**
 * Floating AI panel. Open/close controlled by parent.
 *
 * `placement` controls anchoring:
 *   - `'center-top'` (default): legacy center-top modal with full-viewport
 *      backdrop. Click-outside closes via the backdrop.
 *   - `'bottom-dock'`: floats at the bottom of the viewport as a chat-mode
 *      style input toolbar. No backdrop (the dock owns its own outer
 *      surface), so click-outside is delegated to the dock.
 *
 * `onAsk` returns the answer text; if it returns ReactNode-compatible
 * markup (string), it's rendered with line-breaks preserved. For richer
 * answers, pass back an HTML-as-string and we'll render via
 * dangerouslySetInnerHTML — caller is responsible for sanitizing.
 */
export function AdminAIPanel({
  open,
  onClose,
  onAsk,
  suggestions,
  greeting,
  placement = 'center-top',
}: {
  open: boolean
  onClose: () => void
  onAsk: (question: string) => Promise<string>
  suggestions: Suggestion[]
  greeting?: React.ReactNode
  placement?: 'center-top' | 'bottom-dock'
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // ThemeProvider is always mounted above the admin shell in production; tests
  // for this panel mock the context (see __tests__/AdminAgentDock.test.tsx).
  const { theme } = useTheme()
  const resolvedTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark'
  // Memoized set of valid admin slugs — used to recognize bare `#slug` markdown
  // anchors emitted by the agent (system prompt: `[Open <label>](#<slug>)`).
  const validSlugs = useMemo(() => new Set(allSidebarIds()), [])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const ask = async (q: string) => {
    if (!q.trim() || busy) return
    setMessages((m) => [...m, { who: 'you', text: q }])
    setBusy(true)
    try {
      const text = await onAsk(q)
      setMessages((m) => [...m, { who: 'ai', text }])
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { who: 'ai', text: `(I hit an error: ${e?.message ?? 'unknown'}. Try again or rephrase.)` },
      ])
    } finally {
      setBusy(false)
    }
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const v = (e.target as HTMLInputElement).value
      ;(e.target as HTMLInputElement).value = ''
      ask(v)
    }
  }

  if (!open) return null

  // Shared inner body — header, input row, transcript/suggestions.
  const body = (
    <>
      <div className="text-fg-2 font-mono flex items-center gap-3 border-b border-ln-2 px-4 py-3 text-[11px]">
        <span
          aria-hidden
          className="inline-block h-[6px] w-[6px] rounded-full"
          style={{
            background: 'var(--ap-ok, var(--ok))',
            boxShadow: '0 0 6px var(--ap-ok, var(--ok))',
          }}
        />
        <b className="text-fg-0">Admin AI Assistant</b>
        <span className="text-fg-3">· read-only · uses your auth scope · audit-logged</span>
        <span className="ml-auto text-fg-3 text-[10px]">
          <kbd className="bg-bg-2 mr-1 rounded border border-ln-2 px-1 py-[1px]">↵</kbd>ask{' '}
          <kbd className="bg-bg-2 mx-1 rounded border border-ln-2 px-1 py-[1px]">esc</kbd>close
        </span>
      </div>

      {/* Transcript / suggestions. With CSS `order`, the input row swaps
          above (center-top) or below (bottom-dock) this transcript. */}
      <div
        className="flex-1 overflow-y-auto p-4"
        style={placement === 'bottom-dock' ? { order: 2 } : { order: 3 }}
        onClickCapture={(e) => {
          // Intercept anchor clicks inside the AI response so links to admin
          // sections deep-link into the shell instead of opening a new tab
          // or navigating away. Recognized forms (case-insensitive):
          //   /admin/<slug>           — full app path
          //   /#/admin/<slug>         — hashbang variant
          //   #admin/<slug>           — anchor-only variant
          //   admin:<slug>            — pseudo-scheme
          //   openagentic-admin:<slug>
          // We dispatch a window event the shell listens for and prevent the
          // default browser navigation. Anything that doesn't parse as an
          // admin slug falls through to normal _blank behavior.
          const target = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null
          if (!target) return
          const raw = (target.getAttribute('href') || '').trim()
          if (!raw) return
          let slug: string | null = null
          // Form 1: explicit admin path/scheme — `/admin/<slug>`, `#admin/<slug>`,
          // `admin:<slug>`, `openagentic-admin:<slug>`, `/#/admin/<slug>`.
          const explicit = raw.match(/^(?:openagentic-admin:|admin:|\/?#\/?admin\/|\/admin\/|#admin\/)([a-z][a-z0-9-]*)(?:[\/?#].*)?$/i)
          if (explicit) slug = explicit[1].toLowerCase()
          // Form 2: bare `#<slug>` — the system prompt's canonical
          // `[Open <label>](#<slug>)` form. Only accept it when the slug is
          // one of the known sidebar entries; otherwise fall through to
          // normal browser behavior (a real in-doc anchor).
          if (!slug) {
            const bare = raw.match(/^#([a-z][a-z0-9-]*)$/i)
            if (bare && validSlugs.has(bare[1].toLowerCase())) {
              slug = bare[1].toLowerCase()
            }
          }
          if (!slug) return
          e.preventDefault()
          e.stopPropagation()
          window.dispatchEvent(new CustomEvent('openagentic-admin:navigate', { detail: { slug } }))
          // Close the panel so the user lands on the destination page.
          onClose()
        }}
      >
        {messages.length === 0 && (
          <>
            {greeting && <div className="text-fg-2 mb-4 text-[12px]">{greeting}</div>}
            <div className="font-mono text-fg-3 mb-2 text-[10px] uppercase tracking-[0.12em]">
              Suggested questions
            </div>
            {suggestions.map((s) => (
              <button
                key={s.q}
                type="button"
                onClick={() => ask(s.q)}
                className="bg-bg-2 hover:bg-bg-3 text-fg-2 hover:text-fg-0 font-mono mb-2 flex w-full items-center gap-3 rounded border border-ln-2 px-3 py-[10px] text-left text-[12px]"
              >
                <span style={{ color: 'var(--ap-accent, var(--accent))' }} className="min-w-[16px]">
                  {s.icon ?? '?'}
                </span>
                <span className="flex-1">{s.q}</span>
                <span className="text-fg-3">→</span>
              </button>
            ))}
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className="mb-3 border-b border-ln-1 pb-3">
            {m.who === 'you' ? (
              <div className="font-mono text-[12px]" style={{ color: 'var(--ap-accent, var(--accent))' }}>
                <span className="text-fg-3">you · </span>
                {m.text}
              </div>
            ) : (
              <div>
                <div
                  className="font-mono mb-2 text-[10px] tracking-[0.06em]"
                  style={{ color: 'var(--ap-ok, var(--ok))' }}
                >
                  ADMIN-AI
                </div>
                <div className="text-fg-0 text-[13px] leading-6">
                  {typeof m.text === 'string' ? (
                    <SharedMarkdownRenderer content={m.text} theme={resolvedTheme} />
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className="flex items-center gap-3 px-4 py-3"
        style={
          placement === 'bottom-dock'
            // Input row pinned at the bottom of the dock (order:3 below transcript).
            ? { order: 3, borderTop: '1px solid var(--ap-ln-2, var(--line-2))' }
            // Center-top: input directly under header (order:2 above transcript).
            : { order: 2, borderBottom: '1px solid var(--ap-ln-2, var(--line-2))' }
        }
      >
        <span aria-hidden style={{ color: 'var(--ap-accent, var(--accent))' }} className="font-mono text-base">
          →
        </span>
        <input
          ref={inputRef}
          type="text"
          placeholder={busy ? 'thinking…' : 'Find a setting · explain a page · walk me through…'}
          disabled={busy}
          onKeyDown={onInputKey}
          className="text-fg-0 font-mono flex-1 bg-transparent text-[14px] outline-none"
        />
      </div>
    </>
  )

  // Bottom-dock variant: render the panel directly (no backdrop) at the
  // bottom of the viewport. The dock owner handles click-outside.
  //
  // Sev-1 #932 — bounded frame per user direction ("limited frame
  // height/width to allow users to chat with it about admin console
  // stuff"). 480px × 600px caps keep this looking like a floating
  // chat widget, not a full-page takeover. Anchored bottom-right so
  // it pairs with the top-header trigger and stays out of the way
  // of the main content scroll.
  if (placement === 'bottom-dock') {
    return (
      <div
        role="dialog"
        aria-label="Admin AI Assistant"
        className="glass flex flex-col"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 'min(480px, calc(100vw - 48px))',
          height: 'min(600px, calc(100vh - 96px))',
          maxWidth: '480px',
          maxHeight: '600px',
          zIndex: 90,
        }}
      >
        {body}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[90]"
      style={{ background: 'color-mix(in srgb, var(--color-shadow) 60%, transparent)' }}
      role="button"
      tabIndex={0}
      aria-label="Close"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={onKeyActivate(() => onClose())}
      data-testid="ai-mask"
    >
      <div
        role="dialog"
        aria-label="Admin AI Assistant"
        className="glass absolute left-1/2 flex flex-col"
        style={{
          top: 60,
          transform: 'translateX(-50%)',
          width: 720,
          maxWidth: '90vw',
          maxHeight: '70vh',
        }}
      >
        {body}
      </div>
    </div>
  )
}
