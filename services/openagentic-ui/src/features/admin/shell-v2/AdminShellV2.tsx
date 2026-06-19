import React, { useEffect, useRef, useState } from 'react'
import { AdminQueryProvider } from '../hooks/useAdminQuery'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PageRouter } from './pageRouter'
import { ToastHost, AdminAgentDock, type AISuggestion } from '../primitives-v2'
import ErrorBoundary from '@/shared/components/ErrorBoundary'
import { useAdminAi } from '../hooks/useAdminAi'

const AI_SUGGESTIONS: AISuggestion[] = [
  { q: 'How do I add a model to the registry?', icon: '+' },
  { q: 'What does Tiered Function Calling do?', icon: '?' },
  { q: 'Where do I configure DLP rules?', icon: '→' },
  { q: 'Show me users approaching their token cap', icon: '@' },
  { q: 'Walk me through enabling a new provider', icon: '▶' },
]

export function AdminShellV2() {
  const [active, setActive] = useState<string>('overview')
  const sessionIdRef = useRef<string>(`admin-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const activeRef = useRef<string>(active)
  useEffect(() => { activeRef.current = active }, [active])

  // Listen for in-product navigation requests dispatched by the Admin Agent
  // (or any other component that wants to deep-link into a sidebar slug
  // without doing a real browser navigation). The dock's link interceptor
  // emits 'openagentic-admin:navigate' with { detail: { slug } }; we apply
  // it as setActive(slug). Slug validation lives at the dispatch site.
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<{ slug?: string }>).detail
      if (detail?.slug && typeof detail.slug === 'string') {
        setActive(detail.slug)
      }
    }
    window.addEventListener('openagentic-admin:navigate', onNav as EventListener)
    return () => window.removeEventListener('openagentic-admin:navigate', onNav as EventListener)
  }, [])

  // Real SSE-backed Admin AI. Replaces the 5-key client-side dictionary.
  // The handler streams content token-by-token; AdminAIPanel calls onAsk
  // and renders the awaited string, so we accumulate tokens into a single
  // resolved Promise here.
  // ⌘K open + Esc close are owned by `<AdminAgentDock />` (see below).
  const { sendMessage } = useAdminAi({
    onToken: () => { /* consumed via accumulator below */ },
    onDone: () => { /* resolved by sendOnce */ },
    onSuggestions: () => { /* not surfaced via AdminAIPanel.onAsk yet */ },
    onError: () => { /* surfaced via the panel's catch path */ },
  })

  const onAsk = async (question: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      let acc = ''
      sendMessage({
        message: question,
        sessionId: sessionIdRef.current,
        currentSection: activeRef.current,
        conversationHistory: [],
      })
      // The hook's onToken/onDone are bound at construction. We need a per-
      // call accumulator, so re-call sendMessage with local handlers via a
      // throwaway hook-like inline implementation. Easier path: rebuild the
      // request inline. (See ../hooks/useAdminAi.ts for the canonical impl.)
      void acc
      void reject
      // TEMPORARY: fall through to the inline fetch below
    })
  }

  // ---- Inline request because AdminAIPanel.onAsk wants Promise<string> ----
  const askOnce = async (question: string): Promise<string> => {
    const token = localStorage.getItem('auth_token')
    const res = await fetch('/api/admin/ai/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: question,
        sessionId: sessionIdRef.current,
        currentSection: activeRef.current,
        conversationHistory: [],
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }
    if (!res.body) throw new Error('No response body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let acc = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      let evt = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) evt = line.slice(7).trim()
        else if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6))
            if (evt === 'content' && parsed.content) acc += parsed.content
            if (evt === 'error') throw new Error(parsed.message || 'stream error')
          } catch {
            /* skip malformed */
          }
          evt = ''
        }
      }
    }
    return acc
  }

  // Renders [Open Page Name](#slug) markdown links inside answers as
  // clickable buttons that call setActive(slug). For v1 we keep the
  // panel rendering plain text; the user can still see the slug and
  // click it via the suggestion buttons. Future iteration: parse the
  // markdown and inject onClick handlers.
  void onAsk

  return (
    <AdminQueryProvider>
      <ToastHost>
        <div
          data-testid="admin-shell-v2"
          // `admin-portal` class scopes the --ap-* CSS variables (accent,
          // surfaces, success/warning, etc.) that v1 admin pages and the
          // shared primitive components depend on. Without it, anything
          // referencing var(--ap-accent) etc. resolves to empty (white-on-
          // white tabs, faded toggles, invisible badges in light theme).
          className="admin-portal h-screen grid grid-rows-[44px_1fr] grid-cols-[224px_1fr] bg-bg-0 text-fg-0"
        >
          <div className="col-span-2 row-start-1">
            <TopBar
              user={{ initials: 'MT' }}
              env="production"
            />
          </div>
          <div className="row-start-2 col-start-1 h-full overflow-hidden">
            <Sidebar active={active} onNavigate={setActive} />
          </div>
          <main className="row-start-2 col-start-2 overflow-auto">
            {/* Per-page error boundary — keyed by `active` so navigating to a
                new sidebar item resets the error state. Without this key, one
                broken page (e.g. KPI Dashboard) latches the boundary closed
                and every subsequent navigation shows the same error. */}
            <ErrorBoundary key={active}>
              <PageRouter active={active} />
            </ErrorBoundary>
          </main>
        </div>
        <AdminAgentDock onAsk={askOnce} suggestions={AI_SUGGESTIONS} />
      </ToastHost>
    </AdminQueryProvider>
  )
}
