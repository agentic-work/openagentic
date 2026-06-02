/**
 * Chat Sidebar Component
 * Navigation sidebar for session management and user controls
 * Features: Session list, new chat creation, session deletion, user menu, theme toggle
 * Handles: Session filtering/search, collapsible sidebar, mobile responsiveness
 * @see docs/chat/sidebar-navigation.md
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Edit3, MoreHorizontal, Trash2, Settings, User, LogOut, HelpCircle, Shield, PanelLeft, PanelRight, Search, Sun, Moon, MessageSquare, Workflow } from '@/shared/icons';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/app/providers/AuthContext';
import { getDocsUrl } from '@/utils/api';
import { useTheme } from '@/contexts/ThemeContext';
import { useConfirm } from '@/shared/hooks/useConfirm';
import SettingsMenu from './SettingsMenu';
import { CompanyLogo } from '@/components/CompanyLogo';
import { VersionBadge } from '@/components/VersionBadge';
import { FlowsSidebar } from '@/features/workflows/components/FlowsSidebar';
import type { WorkflowTemplateItem } from '@/features/workflows/utils/workflowTemplates';
import type { AgentTreeNode } from './v2/AgentTree';

/**
 * Format timestamp for display with relative time for recent updates
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs < 60000) { // Less than 1 minute
    return 'Just now';
  } else if (diffMs < 3600000) { // Less than 1 hour
    const minutes = Math.floor(diffMs / 60000);
    return `${minutes}m ago`;
  } else if (diffHours < 24) { // Less than 24 hours
    const hours = Math.floor(diffHours);
    return `${hours}h ago`;
  } else if (diffDays < 7) { // Less than 7 days
    const days = Math.floor(diffDays);
    return `${days}d ago`;
  } else if (date.getFullYear() === now.getFullYear()) { // Same year
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else { // Different year
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

interface ChatSession {
  id: string;
  title: string;
  messageCount?: number;
  updatedAt?: string | Date;
}

// App mode type for Chat/Flows switching
type AppMode = 'chat' | 'flows';

interface ChatSidebarProps {
  currentTheme?: 'light' | 'dark';
  sessions: ChatSession[];
  currentSessionId: string | null;
  showDeleteConfirm: string | null;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onNewSession: () => void;
  onShowDeleteConfirm: (sessionId: string | null) => void;
  onSettingsClick?: () => void;
  userName?: string;
  userEmail?: string;
  isAdmin?: boolean;
  onAdminPanelClick?: () => void;
  onLogout?: () => void;
  onHelpClick?: () => void;
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onThemeToggle?: () => void;
  // App mode toggle (Chat/Flows)
  appMode?: AppMode;
  onAppModeChange?: (mode: AppMode) => void;
  canUseFlows?: boolean;
  /** Pixels to push the sidebar in from the left edge — used when the
   *  Flows workspace nav rail is mounted to its left. */
  leftOffsetPx?: number;
  /**
   * Phase 19 — Sub-agent tree for the active chat session. Mock 04:~830
   * "Agent tree · this chat". Empty array hides the section.
   */
  agentTreeNodes?: AgentTreeNode[];
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  currentTheme: propTheme, // Use prop theme if provided, otherwise use internal state
  sessions,
  currentSessionId,
  showDeleteConfirm,
  isExpanded: propIsExpanded,
  onExpandedChange,
  onSessionSelect,
  onSessionDelete,
  onNewSession,
  onShowDeleteConfirm,
  onSettingsClick,
  userName = 'User',
  userEmail,
  isAdmin = false,
  onAdminPanelClick,
  onLogout,
  onHelpClick,
  onThemeChange,
  onThemeToggle,
  // App mode props
  appMode = 'chat',
  onAppModeChange,
  canUseFlows = false,
  leftOffsetPx = 0,
  agentTreeNodes,
}) => {
  // Use prop for isExpanded if provided, otherwise use local state
  const [localIsExpanded, setLocalIsExpanded] = useState(true);
  const isExpanded = propIsExpanded !== undefined ? propIsExpanded : localIsExpanded;
  const setIsExpanded = onExpandedChange || setLocalIsExpanded;
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBox, setShowSearchBox] = useState(false);
  const navigate = useNavigate();
  
  // Refs for floating menus positioning
  const currentThemeButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Get auth context for token
  const { getAccessToken, user } = useAuth();
  const confirm = useConfirm();
  const userId = user?.id || '';

  // Use the new theme context
  const { resolvedTheme, changeTheme } = useTheme();

  // Use the resolved theme
  const currentTheme = resolvedTheme;

  // Handle theme toggle - simple light/dark toggle
  const toggleTheme = useCallback(() => {
    changeTheme(currentTheme === 'dark' ? 'light' : 'dark');

    // Call legacy callbacks if provided
    if (typeof onThemeChange === 'function') {
      onThemeChange(currentTheme === 'dark' ? 'light' : 'dark');
    }
    if (typeof onThemeToggle === 'function') {
      onThemeToggle();
    }
  }, [currentTheme, changeTheme, onThemeChange, onThemeToggle]);

  // REMOVED DOM manipulation - ThemeContext handles this properly

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Close profile menu if clicking outside
      if (showProfileMenu) {
        const isInsideSettingsButton = settingsButtonRef.current?.contains(target);
        const isInsideProfileMenu = profileMenuRef.current?.contains(target);
        if (!isInsideSettingsButton && !isInsideProfileMenu) {
          setShowProfileMenu(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileMenu]);
  
  // Filter and sort sessions based on search query (with safety check)
  // Sort by updatedAt date with most recent first
  const filteredSessions = Array.isArray(sessions) 
    ? sessions
        .filter(session => 
          session.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => {
          // Sort by updatedAt date, most recent first
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA; // Descending order (most recent first)
        })
    : [];

  return (
    <>
      {/* Single Unified Sidebar */}
      <motion.div
        initial={{ width: 64 }}
        animate={{ width: isExpanded ? 280 : 64 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300, duration: 0.3 }}
        className="fixed top-0 h-full z-[1000] flex flex-col py-3 pl-3 pr-1"
        style={{ left: leftOffsetPx }}
      >
        {/* Terminal Glass (elevated) — frosted floating sidebar panel. The
            living orange aurora (mounted by the App shell) blurs THROUGH this
            surface for real depth. .rise = the staggered load-in cascade. */}
        <div className="glass rise rise-d1 h-full flex flex-col relative">
        {/* Header Section with Logo, Search and Toggle */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-rule">
          {/* Panel Toggle Button - Proper sidebar icon */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsExpanded(!isExpanded)}
            className="glass-btn glass-btn-ghost text-fg-muted p-2"
            title={isExpanded ? "Close Sidebar" : "Open Sidebar"}
          >
            <motion.div
              animate={{
                x: isExpanded ? 0 : 2,
              }}
              transition={{
                duration: 0.2,
                ease: "easeOut"
              }}
            >
              {isExpanded ? <PanelLeft size={20} /> : <PanelRight size={20} />}
            </motion.div>
          </motion.button>

          {/* Company Logo - Full when expanded, icon when collapsed */}
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.div
                key="full-logo"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex-1 flex justify-center mx-2"
              >
                <CompanyLogo variant="compact" width={160} height={32} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Search Icon - Only visible when expanded */}
          {isExpanded && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowSearchBox(!showSearchBox)}
              className="glass-btn glass-btn-ghost text-fg-muted p-2"
              title="Search Chats"
            >
              <Search size={20} />
            </motion.button>
          )}
        </div>

        {/* Expandable Search Box */}
        <AnimatePresence>
          {showSearchBox && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden px-3 pb-3 border-b border-rule"
            >
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-fg-subtle" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  className="glass-field pl-9 pr-3 py-2 text-sm"
                  autoFocus
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode Toggle (Chat/Flows) - Show if user can use flows */}
        {canUseFlows && onAppModeChange && (() => {
          // Calculate available modes for dynamic slider positioning
          const modes: AppMode[] = ['chat'];
          if (canUseFlows) modes.push('flows');
          const modeCount = modes.length;
          const activeIndex = modes.indexOf(appMode);
          const widthPercent = 100 / modeCount;

          return (
            <div className="px-3 py-2 border-b border-rule">
              {/* Terminal Glass segmented control: frosted track + a lifted
                  frosted active indicator (matches .tab.on in the reference). */}
              <div className={`
                relative flex items-center p-1 glass-surface glass-surface-subtle rounded-[var(--ctl-radius)]
                ${isExpanded ? '' : 'flex-col'}
              `}>
                {/* Sliding indicator — lifted frosted pane with edge highlight */}
                <motion.div
                  className={`
                    absolute rounded-[var(--ctl-radius-sm)] glass-tab-active
                    ${isExpanded ? 'top-1 bottom-1' : 'left-1 right-1'}
                  `}
                  initial={false}
                  animate={isExpanded ? {
                    left: `calc(${activeIndex * widthPercent}% + 4px)`,
                    right: `calc(${(modeCount - activeIndex - 1) * widthPercent}% + 4px)`,
                  } : {
                    top: `calc(${activeIndex * widthPercent}% + 4px)`,
                    bottom: `calc(${(modeCount - activeIndex - 1) * widthPercent}% + 4px)`,
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 30,
                  }}
                />

                {/* Chat mode button - always shown */}
                <button
                  onClick={() => onAppModeChange('chat')}
                  className={`
                    relative z-10 flex items-center gap-1.5 rounded-[var(--ctl-radius-sm)] transition-colors duration-200
                    ${isExpanded ? 'flex-1 px-3 py-1.5 justify-center' : 'p-2'}
                    ${appMode === 'chat'
                      ? 'text-fg'
                      : 'text-fg-subtle hover:text-fg-muted'
                    }
                  `}
                  title="Chat Mode"
                >
                  <MessageSquare size={isExpanded ? 14 : 16} />
                  {isExpanded && <span className="text-xs font-semibold">Chat</span>}
                </button>

                {/* Flows mode button - shown if canUseFlows */}
                {canUseFlows && (
                  <button
                    onClick={() => onAppModeChange('flows')}
                    className={`
                      relative z-10 flex items-center gap-1.5 rounded-[var(--ctl-radius-sm)] transition-colors duration-200
                      ${isExpanded ? 'flex-1 px-3 py-1.5 justify-center' : 'p-2'}
                      ${appMode === 'flows'
                        ? 'text-fg'
                        : 'text-fg-subtle hover:text-fg-muted'
                      }
                    `}
                    title="Flows Mode - Visual Workflow Builder"
                  >
                    <Workflow size={isExpanded ? 14 : 16} />
                    {isExpanded && <span className="text-xs font-semibold">Flows</span>}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Content Area - Different based on mode */}
        {appMode === 'flows' && canUseFlows ? (
          /* FLOWS MODE: Show workflow sidebar with agents, workflows, templates
             Wrapped in flex-1 min-h-0 to constrain height so Settings stays at bottom */
          <div className="flex-1 min-h-0 overflow-hidden">
            <FlowsSidebar
              isExpanded={isExpanded}
              theme={currentTheme}
              onOpenWorkflow={(id) => window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: id } }))}
              onOpenExecution={(wfId, execId) => window.dispatchEvent(new CustomEvent('openWorkflowExecution', { detail: { workflowId: wfId, executionId: execId } }))}
              onCreateNew={() => window.dispatchEvent(new CustomEvent('createNewWorkflow'))}
              onUseTemplate={(tpl: WorkflowTemplateItem) => {
                window.dispatchEvent(new CustomEvent('useWorkflowTemplate', { detail: { template: tpl } }));
              }}
              onOpenConfig={(section) => window.dispatchEvent(new CustomEvent('openFlowsConfig', { detail: { section } }))}
            />
          </div>
        ) : (
          /* CHAT MODE: Show new chat button and sessions */
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {/* New Chat Button */}
            <div className="px-3 mb-2 mt-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={(e) => {
                  // Prevent double-clicking
                  const button = e.currentTarget;
                  if (button.dataset.disabled === 'true') return;

                  button.dataset.disabled = 'true';
                  onNewSession();

                  // Re-enable after 500ms
                  setTimeout(() => {
                    button.dataset.disabled = 'false';
                  }, 500);
                }}
                className={`glass-newchat flex items-center gap-3 px-3 py-2.5 ${
                  isExpanded ? 'w-full justify-start' : 'justify-center'
                }`}
                title={!isExpanded ? 'New Chat' : undefined}
              >
                <Edit3 size={20} className="flex-shrink-0" />
                <AnimatePresence>
                  {isExpanded && (
                    <motion.span
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="text-sm font-semibold whitespace-nowrap"
                    >
                      New chat
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>

            {/* 2026-05-07 — RIPPED Phase-19 sidebar Agent-tree panel.
                User feedback: orchestrator/agent state belongs INLINE
                where it happens (mock 10 SubAgentCard at Task-call position),
                not in a sidebar list nobody scans. Sub-agents now render
                inline via the assistant message stream; this duplicate
                sidebar copy was UX clutter. The `agentTreeNodes` prop is
                still accepted for backwards-compat with callers, but
                deliberately not rendered here. */}

            {/* Recent Section */}
        <div className="flex flex-col">
          {filteredSessions.length > 0 && (
            <>
              {/* Recent Header - Only visible when expanded */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-6 py-2 flex items-center justify-between"
                  >
                    <h3 className="eyebrow text-fg-subtle">
                      {searchQuery ? `Found ${filteredSessions.length}` : 'Recent'}
                    </h3>
                    {sessions.length > 0 && !searchQuery && (
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={async () => {
                          const confirmDelete = await confirm(`Delete all ${sessions.length} chat sessions? This cannot be undone.`, { variant: 'danger', title: 'Delete All Sessions' });
                          if (confirmDelete) {
                            sessions.forEach(session => onSessionDelete(session.id));
                          }
                        }}
                        className="text-[10px] font-semibold px-2 py-1 rounded-[var(--ctl-radius-sm)] border border-rule text-err transition-all flex items-center gap-1"
                        style={{
                          backgroundColor: 'transparent'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--callout-error-bg)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title="Delete all sessions"
                      >
                        <Trash2 size={12} />
                        Delete All
                      </motion.button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="px-3">
                {filteredSessions.map((session, index) => {
                  // v0.6.7 mockup §I — TODAY / YESTERDAY / LAST 7 DAYS /
                  // OLDER section headers between sessions. We insert the
                  // label before the first session in each group; the group
                  // key is derived from updatedAt. Sessions without a
                  // timestamp fall into "OLDER".
                  const getGroup = (s: typeof session): string => {
                    if (!s.updatedAt) return 'OLDER';
                    const ts = new Date(s.updatedAt).getTime();
                    const now = Date.now();
                    const dayMs = 86400000;
                    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
                    if (ts >= startOfToday.getTime()) return 'TODAY';
                    if (ts >= startOfToday.getTime() - dayMs) return 'YESTERDAY';
                    if (ts >= now - 7 * dayMs) return 'LAST 7 DAYS';
                    return 'OLDER';
                  };
                  const thisGroup = getGroup(session);
                  const prevGroup = index > 0 ? getGroup(filteredSessions[index - 1]) : null;
                  const showHeader = isExpanded && !searchQuery && thisGroup !== prevGroup;
                  return (<React.Fragment key={`frag-${session.id}-${index}`}>
                  {showHeader && (
                    <div className="eyebrow px-1 pt-3 pb-1 text-fg-subtle">
                      {thisGroup}
                    </div>
                  )}
                  <div key={`${session.id}-${index}`} className="relative mb-1">
                    <motion.div
                      className={`group flex items-center gap-2 px-3 py-2.5 rounded-[var(--ctl-radius)] border cursor-pointer transition-[background,border-color,box-shadow] duration-150 ${
                        currentSessionId === session.id
                          ? 'glass-row-active text-fg'
                          : 'text-fg-muted border-transparent hover:text-fg glass-row-hover'
                      }`}
                      onClick={() => onSessionSelect(session.id)}
                    >
                      {!isExpanded ? (
                        // Collapsed view - enhanced indicator with tooltip and animation
                        <div className="flex items-center justify-center w-full relative group">
                          <motion.div
                            className={`w-3 h-3 rounded-full border transition-all duration-200 ${
                              currentSessionId === session.id
                                ? 'bg-accent border-accent shadow-[0_0_10px_var(--accent-glow)]'
                                : 'bg-surface-2 border-rule hover:border-accent'
                            }`}
                            whileHover={{ scale: 1.3 }}
                            whileTap={{ scale: 0.9 }}
                            title={session.title || 'New Chat'}
                          />
                          {/* Active session pulse effect */}
                          {currentSessionId === session.id && (
                            <motion.div
                              className="absolute w-6 h-6 rounded-full border border-accent opacity-30"
                              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}
                          {/* Tooltip on hover */}
                          <div className="glass-surface glass-surface-strong absolute left-full ml-2 px-2.5 py-1.5 text-fg text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                            {session.title || 'New Chat'}
                            {session.messageCount !== undefined && (
                              <div className="text-fg-subtle">
                                {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Active session indicator dot */}
                          <div className="flex-shrink-0 mr-3">
                            <motion.div
                              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                                currentSessionId === session.id
                                  ? 'bg-accent shadow-[0_0_8px_var(--accent-glow)]'
                                  : 'bg-fg-subtle'
                              }`}
                              animate={currentSessionId === session.id ? {
                                scale: [1, 1.2, 1],
                                opacity: [1, 0.7, 1]
                              } : {}}
                              transition={currentSessionId === session.id ? {
                                duration: 2,
                                repeat: Infinity
                              } : {}}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className={`text-sm truncate font-medium ${
                              currentSessionId === session.id
                                ? 'text-fg'
                                : 'text-fg-muted'
                            }`}>
                              {session.title || 'New Chat'}
                            </div>
                            <div className="text-xs mt-0.5 flex items-center gap-2 text-fg-subtle">
                              <span>
                                {session.messageCount !== undefined ? session.messageCount : 0} {(session.messageCount || 0) === 1 ? 'message' : 'messages'}
                              </span>
                              {session.updatedAt && (
                                <span>•</span>
                              )}
                              {session.updatedAt && (
                                <span>
                                  {formatTimestamp(typeof session.updatedAt === 'string' ? session.updatedAt : session.updatedAt instanceof Date ? session.updatedAt.toISOString() : String(session.updatedAt))}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Delete button - direct access */}
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onShowDeleteConfirm(session.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-[var(--ctl-radius-sm)] hover:bg-err/20 hover:text-err transition-all text-fg-subtle"
                            title="Delete session"
                          >
                            <Trash2 size={14} />
                          </motion.button>
                        </>
                      )}
                    </motion.div>

                    {/* Delete Confirmation - Positioned to the right */}
                    <AnimatePresence>
                      {showDeleteConfirm === session.id && (
                        <motion.div
                          initial={{ opacity: 0, x: 10, scale: 0.9 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: 10, scale: 0.9 }}
                          className="glass-surface glass-surface-strong absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 z-20 p-2"
                        >
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSessionDelete(session.id);
                              onShowDeleteConfirm(null);
                            }}
                            className="glass-btn glass-btn-danger px-3 py-1.5 text-[10px] font-semibold"
                          >
                            Delete
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onShowDeleteConfirm(null);
                            }}
                            className="glass-btn glass-btn-secondary px-3 py-1.5 text-[10px] font-semibold"
                          >
                            Cancel
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  </React.Fragment>);
                })}
              </div>
            </>
          )}
        </div>

            {/* Memory + Tool Usage panels removed 2026-04-20 per user
                feedback — they cluttered the sidebar and the info they
                surfaced is available from the admin console. Keep imports
                out so the bundle drops them. */}
          </div>
        )}

        {/* Bottom Section - Version + Settings (pinned to bottom) */}
        <div className="relative border-t border-rule mt-auto shrink-0">

          {/* Version Badge */}
          {isExpanded && (
            <div className="px-3 pt-3 pb-0">
              <VersionBadge />
            </div>
          )}

          {/* Settings Menu */}
          <div className="px-3 py-4">
            <SettingsMenu
              isExpanded={isExpanded}
              currentTheme={currentTheme}
              userName={userName}
              userEmail={userEmail}
              isAdmin={isAdmin}
              onLogout={onLogout}
              onHelpClick={onHelpClick || (() => window.open(getDocsUrl(), '_blank'))}
              onAdminPanelClick={onAdminPanelClick}
            />
          </div>
        </div>
        </div>
      </motion.div>
    </>
  );
};

export default ChatSidebar;