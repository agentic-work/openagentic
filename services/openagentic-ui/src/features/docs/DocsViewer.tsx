/**
 * DocsViewer — Full documentation experience overlay
 *
 * Two-panel layout: Sidebar + Content (with optional chat slide-in)
 * Opens as full-screen overlay at z-[1100], no routes
 */

import React, { useEffect, Suspense, useMemo, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';
import { DocsSidebar } from './components/DocsSidebar';
import DocsChatPanel from './components/DocsChatPanel';
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
  } = useDocsStore();

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

  // Resizable chat panel — uses direct DOM style during drag to avoid 60+ renders/sec,
  // commits to React state only on mouseup so framer-motion doesn't thrash animations.
  const [chatWidth, setChatWidth] = useState(480);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const currentWidth = useRef(480);
  const rafId = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = currentWidth.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const delta = dragStartX.current - e.clientX;
        const newWidth = Math.min(Math.max(dragStartWidth.current + delta, 320), 800);
        currentWidth.current = newWidth;
        if (chatPanelRef.current) {
          chatPanelRef.current.style.width = `${newWidth}px`;
        }
      });
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        cancelAnimationFrame(rafId.current);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setChatWidth(currentWidth.current);
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      cancelAnimationFrame(rafId.current);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

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

        {/* Chat panel (resizable) */}
        <AnimatePresence>
          {isChatOpen && (
            <motion.div
              ref={chatPanelRef}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: chatWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="flex-shrink-0 overflow-hidden relative"
            >
              {/* Drag handle */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat panel"
                tabIndex={0}
                onMouseDown={handleMouseDown}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    const step = e.key === 'ArrowLeft' ? 24 : -24;
                    const newWidth = Math.min(Math.max(currentWidth.current + step, 320), 800);
                    currentWidth.current = newWidth;
                    setChatWidth(newWidth);
                  }
                }}
                className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize group"
                style={{ backgroundColor: 'transparent' }}
              >
                <div
                  className="absolute inset-y-0 left-0 w-[3px] transition-colors duration-150 group-hover:bg-[var(--color-primary)]"
                  style={{ backgroundColor: 'var(--color-border)' }}
                />
              </div>
              <DocsChatPanel
                currentDomain={currentDomain}
                currentSectionId={currentSectionId}
                onNavigate={navigateTo}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
