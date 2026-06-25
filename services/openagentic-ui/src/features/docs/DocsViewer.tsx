/**
 * DocsViewer — Full documentation experience overlay
 *
 * Two-panel layout: Sidebar + Content (with optional chat slide-in)
 * Opens as full-screen overlay at z-[1100], no routes
 */

import React, { useEffect, Suspense, useMemo, useCallback } from 'react';
import { useDocsStore } from '@/stores/useDocsStore';
import { DocsSidebar } from './components/DocsSidebar';
import SharedAgentPanel from '@/features/chat/components/SharedAgentPanel';
import { apiEndpoint } from '@/utils/api';
import { DocsCloseIcon } from './components/DocsIcons';
import { DocsPageRenderer, hasPageComponent } from './components/DocsPageRenderer';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

// Lazy-load the old manifest renderer as fallback for reference pages
const DocsContentLegacy = React.lazy(() =>
  import('./components/DocsContent').then(m => ({ default: m.DocsContent }))
);

interface DocsViewerProps {
  isOpen: boolean;
  onClose: () => void;
  initialPath?: string;
  theme?: 'light' | 'dark';
}

export const DocsViewer: React.FC<DocsViewerProps> = ({
  isOpen,
  onClose,
  initialPath,
  theme = 'dark',
}) => {
  const {
    index,
    isLoading,
    isChatOpen,
    currentDomain,
    currentSectionId,
    loadIndex,
    navigateTo,
    toggleChat,
  } = useDocsStore();

  // docs:// deep-link target from the shared agent panel is `domain/section`
  // (the `docs://` prefix already stripped by the panel). Split + navigate.
  const handleDocsNavigate = useCallback(
    (target: string) => {
      const parts = target.split('/');
      if (parts[0]) navigateTo(parts[0], parts[1]);
    },
    [navigateTo],
  );

  // Load index on mount + auto-navigate to welcome
  useEffect(() => {
    if (isOpen) {
      if (!index) loadIndex();
      if (!currentDomain) navigateTo('welcome');
    }
  }, [isOpen, index, currentDomain, loadIndex, navigateTo]);

  // Handle initial path
  useEffect(() => {
    if (isOpen && initialPath) {
      const parts = initialPath.replace(/^\//, '').split('/');
      if (parts[0]) navigateTo(parts[0], parts[1]);
    }
  }, [isOpen, initialPath, navigateTo]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Determine if current page has a dedicated component
  const usePageRenderer = useMemo(
    () => currentDomain ? hasPageComponent(currentDomain) : false,
    [currentDomain],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex flex-col"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {/* Minimal header — wordmark + version pill + Ask AI / close. The atlas.png
          hero lives INSIDE the landing block (DocsContent.tsx) per design. */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b"
        style={{
          borderColor: 'var(--glass-border)',
          background: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <OpenAgenticWordmark size={16} animate />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Documentation
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full whitespace-nowrap truncate" style={{
            backgroundColor: 'var(--ctl-surf)',
            border: '1px solid var(--glass-border)',
            color: 'var(--color-textMuted)',
          }}>
            v{index?.version || '1.0.0'}
            {index?.codename ? ` · ${index.codename}` : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* "Ask AI" button removed — the documentation agent sidebar is
              already open in this surface, so the button was redundant. */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors hover:bg-[var(--ctl-surf-hover)]"
            style={{ color: 'var(--color-textMuted)' }}
            title="Close documentation (Esc)"
          >
            <DocsCloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">
        <DocsSidebar />

        {/* Content area — page component or legacy manifest renderer */}
        <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-background)' }}>
          {usePageRenderer ? (
            <DocsPageRenderer />
          ) : (
            <Suspense fallback={
              <div className="flex items-center justify-center py-20">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: 'var(--color-textMuted)' }} />
              </div>
            }>
              <DocsContentLegacy />
            </Suspense>
          )}
        </div>

      </div>

      {/* Docs agent — the SHARED left slide-out agent panel (chat-grade
          renderer, live SSE off the main chat pipeline). POSTs directly to
          /api/docs/chat and preserves docs:// link navigation. */}
      <SharedAgentPanel
        open={isChatOpen}
        onOpenChange={(next) => {
          if (next !== isChatOpen) toggleChat();
        }}
        endpoint={apiEndpoint('/docs/chat')}
        title="Docs Agent"
        placeholder="Ask about OpenAgentic…"
        suggestions={DOCS_SUGGESTIONS}
        onNavigate={handleDocsNavigate}
        buildContext={() => ({ currentPageId: currentDomain || 'overview' })}
      />
    </div>
  );
};

/** Starter suggestion chips for the docs agent. */
const DOCS_SUGGESTIONS = [
  'What can OpenAgentic do?',
  'How do agents work?',
  'What MCP tools are available?',
];
