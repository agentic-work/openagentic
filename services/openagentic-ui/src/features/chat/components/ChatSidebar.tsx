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
import { Menu, Edit3, MoreHorizontal, Trash2, Settings, User, LogOut, HelpCircle, Shield, PanelLeft, PanelRight, Search, Sun, Moon, Terminal, MessageSquare, Workflow } from '@/shared/icons';
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
import { MemoryPanel } from './MemoryPanel';
import { ToolUsagePanel } from './ToolUsagePanel';
import { CodeSessionsPanel } from './CodeSessionsPanel';

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

// App mode type for Chat/Code/Flows switching
type AppMode = 'chat' | 'code' | 'flows';

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
  // App mode toggle (Chat/Code/Flows)
  appMode?: AppMode;
  onAppModeChange?: (mode: AppMode) => void;
  canUseCodeMode?: boolean;
  canUseFlows?: boolean;
  // Code mode session ID for file browser
  codeSessionId?: string | null;
  // Code mode session select callback
  onCodeSessionSelect?: (session: { id: string; model?: string | null; workspacePath?: string | null }) => void;
  // Code mode new session callback
  onCodeNewSession?: () => void;
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
  canUseCodeMode = false,
  canUseFlows = false,
  // Code mode session ID for file browser
  codeSessionId,
  // Code mode session callbacks
  onCodeSessionSelect,
  onCodeNewSession,
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

  // (Workspace files sidebar removed — CodeMode uses VS Code editor panel directly)

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
        animate={{ width: isExpanded ? 320 : 64 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300, duration: 0.3 }}
        className="fixed left-0 top-0 h-full z-[1000] flex flex-col m-2 ml-0 mr-0"
      >
        <div className="h-full flex flex-col relative sidebar-glass">
        {/* Header Section with Logo, Search and Toggle */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-[var(--color-border)]">
          {/* Panel Toggle Button - Proper sidebar icon */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsExpanded(!isExpanded)}
            className="button-glass p-2 rounded-lg"
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
              className="button-glass p-2 rounded-lg text-secondary"
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
              className="overflow-hidden px-3 pb-3 border-b"
              style={{ borderColor: 'rgb(var(--border-primary))' }}
            >
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2" style={{ color: 'rgb(var(--text-muted))' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg transition-all focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'rgb(var(--bg-tertiary))',
                    color: 'rgb(var(--text-primary))',
                    borderColor: 'rgb(var(--border-primary))'
                  }}
                  autoFocus
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode Toggle (Chat/Code/Flows) - Show if user can use code mode or flows */}
        {(canUseCodeMode || canUseFlows) && onAppModeChange && (() => {
          // Calculate available modes for dynamic slider positioning
          const modes: AppMode[] = ['chat'];
          if (canUseCodeMode) modes.push('code');
          if (canUseFlows) modes.push('flows');
          const modeCount = modes.length;
          const activeIndex = modes.indexOf(appMode);
          const widthPercent = 100 / modeCount;

          return (
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
              <div className={`
                relative flex items-center p-0.5 rounded-lg
                bg-[var(--color-surface)] border border-[var(--color-border)]
                ${isExpanded ? '' : 'flex-col'}
              `}>
                {/* Sliding background indicator - uses user accent color */}
                <motion.div
                  className={`
                    absolute rounded-md
                    ${isExpanded ? 'top-0.5 bottom-0.5' : 'left-0.5 right-0.5'}
                  `}
                  style={{ backgroundColor: 'var(--user-accent-primary, var(--color-primary))' }}
                  initial={false}
                  animate={isExpanded ? {
                    left: `calc(${activeIndex * widthPercent}% + 2px)`,
                    right: `calc(${(modeCount - activeIndex - 1) * widthPercent}% + 2px)`,
                  } : {
                    top: `calc(${activeIndex * widthPercent}% + 2px)`,
                    bottom: `calc(${(modeCount - activeIndex - 1) * widthPercent}% + 2px)`,
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
                    relative z-10 flex items-center gap-1.5 rounded-md transition-colors duration-200
                    ${isExpanded ? 'flex-1 px-3 py-1.5 justify-center' : 'p-2'}
                    ${appMode === 'chat'
                      ? 'text-white'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }
                  `}
                  title="Chat Mode"
                >
                  <MessageSquare size={isExpanded ? 14 : 16} />
                  {isExpanded && <span className="text-sm font-medium">Chat</span>}
                </button>

                {/* Code mode button - shown if canUseCodeMode */}
                {canUseCodeMode && (
                  <button
                    onClick={() => onAppModeChange('code')}
                    className={`
                      relative z-10 flex items-center gap-1.5 rounded-md transition-colors duration-200
                      ${isExpanded ? 'flex-1 px-3 py-1.5 justify-center' : 'p-2'}
                      ${appMode === 'code'
                        ? 'text-white'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      }
                    `}
                    title="Code Mode"
                  >
                    <Terminal size={isExpanded ? 14 : 16} />
                    {isExpanded && <span className="text-sm font-medium">Code</span>}
                  </button>
                )}

                {/* Flows mode button - shown if canUseFlows */}
                {canUseFlows && (
                  <button
                    onClick={() => onAppModeChange('flows')}
                    className={`
                      relative z-10 flex items-center gap-1.5 rounded-md transition-colors duration-200
                      ${isExpanded ? 'flex-1 px-3 py-1.5 justify-center' : 'p-2'}
                      ${appMode === 'flows'
                        ? 'text-white'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                      }
                    `}
                    title="Flows Mode - Visual Workflow Builder"
                  >
                    <Workflow size={isExpanded ? 14 : 16} />
                    {isExpanded && <span className="text-sm font-medium">Flows</span>}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Content Area - Different based on mode */}
        {appMode === 'code' && canUseCodeMode ? (
          /* CODE MODE: single continuous session with auto-compaction.
             Sessions list removed — claude.ai/code shows one session. */
          <div className="flex-1" />
        ) : appMode === 'flows' && canUseFlows ? (
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
                className={`button-glass flex items-center gap-3 p-2 rounded-lg text-secondary ${
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
                      className="font-medium whitespace-nowrap"
                    >
                      New Chat
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>

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
                    <h3 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'rgb(var(--text-muted))' }}>
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
                        className="text-xs px-2 py-1 rounded transition-all flex items-center gap-1"
                        style={{
                          color: 'var(--color-error)',
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
                {filteredSessions.map((session, index) => (
                  <div key={`${session.id}-${index}`} className="relative mb-1">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors hover:bg-theme-bg-secondary ${
                        currentSessionId === session.id
                          ? 'bg-theme-bg-secondary text-theme-text-primary'
                          : 'text-theme-text-secondary hover:text-theme-text-primary'
                      }`}
                      onClick={() => onSessionSelect(session.id)}
                    >
                      {!isExpanded ? (
                        // Collapsed view - enhanced indicator with tooltip and animation
                        <div className="flex items-center justify-center w-full relative group">
                          <motion.div
                            className={`w-3 h-3 rounded-full border-2 transition-all duration-200 ${
                              currentSessionId === session.id
                                ? 'bg-theme-accent border-theme-accent shadow-lg'
                                : 'bg-theme-bg-tertiary border-theme-border-primary hover:border-theme-accent hover:bg-theme-accent/20'
                            }`}
                            whileHover={{ scale: 1.3 }}
                            whileTap={{ scale: 0.9 }}
                            title={session.title || 'New Chat'}
                          />
                          {/* Active session pulse effect */}
                          {currentSessionId === session.id && (
                            <motion.div
                              className="absolute w-6 h-6 rounded-full border-2 border-theme-accent opacity-30"
                              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}
                          {/* Tooltip on hover */}
                          <div className="absolute left-full ml-2 px-2 py-1 bg-theme-bg-primary text-theme-text-primary text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                            {session.title || 'New Chat'}
                            {session.messageCount !== undefined && (
                              <div className="text-theme-text-muted">
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
                                  ? 'bg-theme-accent shadow-lg'
                                  : 'bg-theme-bg-muted'
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
                                ? 'text-theme-accent'
                                : 'text-theme-text-primary'
                            }`}>
                              {session.title || 'New Chat'}
                            </div>
                            <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'rgb(var(--text-muted))' }}>
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
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-error/20 hover:text-error transition-all text-theme-text-muted"
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
                          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 rounded-lg z-20 bg-theme-bg-primary p-2 shadow-lg border border-theme-border-primary"
                        >
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSessionDelete(session.id);
                              onShowDeleteConfirm(null);
                            }}
                            className="px-3 py-1.5 text-xs bg-error rounded-md hover:bg-error/80 transition-colors font-medium"
                            style={{ color: 'var(--color-text)' }}
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
                            className="px-3 py-1.5 text-xs rounded-md transition-colors font-medium bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-tertiary"
                          >
                            Cancel
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

            {/* Memory Panel - shows what the AI remembers */}
            <MemoryPanel isExpanded={isExpanded} theme={currentTheme} />

            {/* Tool Usage Panel - shows personal MCP tool analytics */}
            <ToolUsagePanel isExpanded={isExpanded} theme={currentTheme} />
          </div>
        )}

        {/* Bottom Section - Version + Settings (pinned to bottom) */}
        <div className="relative border-t mt-auto shrink-0" style={{ borderColor: 'var(--color-border)' }}>

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