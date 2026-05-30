/**
 * DocsSidebar — Left navigation for the documentation system.
 *
 * Uses the page-based navigation registry (DocsPageRenderer) instead of
 * generated manifest domains. Shows categories with page links,
 * search, role-aware filtering, and Settings & More at the bottom.
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';
import { useAuth } from '@/app/providers/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUIVisibilityStore } from '@/stores/useUIVisibilityStore';
import SettingsMenu from '@/features/chat/components/SettingsMenu';
import {
  DocsSearchIcon,
  DocsShieldIcon,
  DocsChevronIcon,
  getDocsIcon,
} from './DocsIcons';
import { docsNavigation, type DocsNavCategory, type DocsNavPage } from './DocsPageRenderer';

export const DocsSidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const isAdmin = user?.isAdmin || user?.is_admin || false;
  const { theme } = useTheme();
  const openUI = useUIVisibilityStore(s => s.open);
  const closeUI = useUIVisibilityStore(s => s.close);

  const {
    currentDomain,
    navigateTo,
  } = useDocsStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(['getting-started'])
  );

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // Filter pages based on role and search
  const filteredNav = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return docsNavigation
      .map(cat => ({
        ...cat,
        pages: cat.pages.filter(page => {
          // Role filter
          if (page.adminOnly && !isAdmin) return false;
          // Search filter
          if (q) {
            return (
              page.title.toLowerCase().includes(q) ||
              page.description.toLowerCase().includes(q) ||
              cat.title.toLowerCase().includes(q)
            );
          }
          return true;
        }),
      }))
      .filter(cat => cat.pages.length > 0);
  }, [searchQuery, isAdmin]);

  return (
    <div
      className="w-[260px] flex-shrink-0 border-r h-full flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {/* Search */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 pl-8 rounded-md text-sm outline-none"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
          <div className="absolute left-2.5 top-2.5">
            <DocsSearchIcon size={14} />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-hide">
        {filteredNav.length === 0 && searchQuery && (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--color-textMuted)' }}>
            No results for "{searchQuery}"
          </div>
        )}

        <nav className="space-y-0.5">
          {filteredNav.map((cat) => {
            const isExpanded = expandedCategories.has(cat.id);
            const CatIcon = getDocsIcon(cat.icon);

            return (
              <div key={cat.id}>
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors text-left mt-2"
                  style={{ color: 'var(--color-textMuted)' }}
                >
                  <DocsChevronIcon size={10} direction={isExpanded ? 'down' : 'right'} />
                  <CatIcon size={13} />
                  <span className="flex-1">{cat.title}</span>
                </button>

                {/* Pages */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="ml-1 space-y-px mt-0.5">
                        {cat.pages.map((page) => {
                          const isActive = currentDomain === page.id;

                          return (
                            <button
                              key={page.id}
                              onClick={() => navigateTo(page.id)}
                              className="w-full flex items-start gap-2 px-3 py-2 rounded-md text-[13px] transition-all text-left group"
                              style={{
                                backgroundColor: isActive ? 'var(--color-primary)' : 'transparent',
                                color: isActive ? 'white' : 'var(--color-text)',
                                fontWeight: isActive ? 500 : 400,
                              }}
                              onMouseEnter={(e) => {
                                if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{page.title}</span>
                                  {page.adminOnly && (
                                    <DocsShieldIcon size={10} />
                                  )}
                                </div>
                                {!isActive && (
                                  <div
                                    className="text-[11px] truncate mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ color: 'var(--color-textMuted)' }}
                                  >
                                    {page.description}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Settings & More — pinned to bottom */}
      <div
        className="flex-shrink-0 border-t px-2 py-2"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <SettingsMenu
          isExpanded={true}
          currentTheme={theme || 'dark'}
          userName={user?.displayName || user?.name || 'User'}
          userEmail={user?.email}
          isAdmin={isAdmin}
          onLogout={() => { closeUI('showDocsViewer'); logout?.(); }}
          onAdminPanelClick={() => { closeUI('showDocsViewer'); openUI('showAdminPortal'); }}
        />
      </div>
    </div>
  );
};
