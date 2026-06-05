import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AdminAIPanel, type Suggestion } from './AdminAI'

/**
 * AdminAgentDock — top-bar-anchored Admin AI surface.
 *
 * Pill is anchored to the top-right of the admin shell (similar to the
 * GCP / AWS / Anthropic console AI assistant placement). Two states:
 *
 *   1. Collapsed (default): a small pill in the top bar with a pulsing
 *      accent dot. ⌘K from anywhere expands it.
 *
 *   2. Expanded: chat-style input panel anchored at the bottom (so the
 *      input stays close to the bottom of the viewport where the user's
 *      hands are). Reuses `<AdminAIPanel placement="bottom-dock" />`.
 *      Click outside or Esc collapses.
 *
 * Tokens only — `--ap-*` (with `--*` fallback). No hex literals.
 */
export interface AdminAgentDockProps {
  onAsk: (question: string) => Promise<string>
  suggestions: Suggestion[]
  greeting?: React.ReactNode
  /**
   * Optional controlled-open API. When `open` + `onOpenChange` are
   * supplied, the parent owns the open state and the in-component pill
   * is hidden (the parent is expected to render its own trigger, e.g.
   * the v3 TopBar's "admin agent" pill). When omitted, the dock keeps
   * its prior self-managed pill behavior. Sev-1 #932.
   */
  open?: boolean
  onOpenChange?: (next: boolean) => void
}

export function AdminAgentDock({
  onAsk,
  suggestions,
  greeting,
  open: controlledOpen,
  onOpenChange,
}: AdminAgentDockProps) {
  const isControlled = controlledOpen !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = isControlled ? !!controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next)
    } else {
      setUncontrolledOpen(next)
      onOpenChange?.(next)
    }
  }
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Global ⌘K / Ctrl-K opens the dock from anywhere; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isControlled, onOpenChange])

  // Click-outside closes. We attach to mousedown so the focus from a
  // pill-click doesn't immediately self-close the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const root = panelRef.current
      if (!root) return
      if (root.contains(e.target as Node)) return
      setOpen(false)
    }
    // Use capture to run before child handlers / on next tick so the
    // initial expand click doesn't bubble in and immediately close.
    const t = window.setTimeout(() => {
      window.addEventListener('mousedown', onDown)
    }, 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('mousedown', onDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isControlled, onOpenChange])

  // When controlled by the parent, suppress the in-component pill — the
  // parent renders its own trigger (e.g. the TopBar's "admin agent" pill).
  const showPill = !isControlled

  return (
    <>
      {showPill && !open && (
        <motion.button
          key="pill"
          type="button"
          data-testid="admin-agent-dock-pill"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: -8 }}
          animate={{
            opacity: [0.92, 1, 0.92],
            y: 0,
            scale: [1, 1.02, 1],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          whileHover={{ opacity: 1, scale: 1.04 }}
          className="font-mono"
          style={{
            // Sev-1 #932 — anchor the launcher pill to the BOTTOM-RIGHT
            // of the admin shell so it reads as a floating chat-widget
            // affordance (Intercom/GCP style). Previously pinned at
            // top: 14 which conflicted with the v3 topbar and made the
            // pill ambiguous with the topbar's own "admin agent" pill.
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 80,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 28,
            padding: '0 12px',
            borderRadius: 999,
            background: 'var(--glass-bg)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ap-fg-0, var(--fg-0))',
            fontSize: 12,
            cursor: 'pointer',
            boxShadow: '0 0 18px var(--ap-accent-soft, var(--accent-soft, transparent))',
            outline: 'none',
          }}
          aria-label="Open Admin Agent (Cmd-K)"
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--ap-accent, var(--accent))',
              boxShadow: '0 0 6px var(--ap-accent, var(--accent))',
            }}
          />
          <span>Admin Agent</span>
          <kbd
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid var(--glass-border)',
              background: 'var(--ctl-surf)',
              color: 'var(--ap-fg-3, var(--fg-3))',
            }}
          >
            ⌘K
          </kbd>
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel-shell"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div ref={panelRef}>
              <AdminAIPanel
                open
                onClose={() => setOpen(false)}
                onAsk={onAsk}
                suggestions={suggestions}
                greeting={greeting}
                placement="bottom-dock"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
