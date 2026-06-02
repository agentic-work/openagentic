/**
 * Chat Input Toolbar Component - Gemini Style
 *
 * Separate toolbar component that sits below the main input area
 * Features:
 * - Left side: Plus button, MCP servers
 * - Right side: Model selector dropdown
 * - Glassmorphic styling for visibility
 * - React Portal for dropdown positioning
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight, X, PuzzleIcon, Layers, Sparkles, Search, CheckCircle, FileText, Smile, SearchCheck } from '@/shared/icons';
import { useGroundingStore } from '@/stores/useGroundingStore';
import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';
import { ExtendedThinkingToggleButton } from './ExtendedThinkingToggleButton';
import FileAttachmentThumbnails, { AttachmentFile } from './FileAttachmentThumbnails';
import { ModelSelectorDropdown as NewModelSelectorDropdown } from './ModelSelectorDropdown';
// RIPPED ToolsIndexedPill import (no longer rendered).
// Skills UI removed from chat toolbar - now admin-only in Pipeline Settings
import clsx from 'clsx';

// Personality interface (deprecated - use Skills system instead)
// Kept for backward compatibility with existing code
export interface Personality {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

// Deep Research Agent Modal with Architecture Diagram
const DeepResearchModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
          style={{ backgroundColor: 'color-mix(in srgb, var(--cm-text) 70%, transparent)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 25px 50px -12px color-mix(in srgb, var(--color-fg) 50%, transparent)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Accent header bar (brand signal-orange ramp). Was a rainbow
                chord — the brand identity rejects the rainbow, so this now
                rides the user accent. */}
            <div
              className="h-1.5"
              style={{
                background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-line), var(--color-accent))',
                backgroundSize: '200% 100%',
                animation: 'gradient-shift 4s ease infinite'
              }}
            />

            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="Close Deep Research Agent dialog"
              className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] z-10"
              style={{ color: 'var(--color-textMuted)' }}
            >
              <X size={18} aria-hidden="true" />
            </button>

            {/* Content */}
            <div className="p-6">
              {/* Header with brain icon */}
              <div className="flex items-center gap-4 mb-5">
                <div
                  className="relative p-3 rounded-xl"
                  style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--cm-accent) 15%, transparent), color-mix(in srgb, var(--color-primary) 15%, transparent), color-mix(in srgb, var(--cm-info) 15%, transparent))',
                    boxShadow: `0 0 30px color-mix(in srgb, var(--color-primary) 20%, transparent)`
                  }}
                >
                  <Sparkles
                    size={36}
                    style={{
                      color: 'var(--color-accent)'
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-xl font-bold"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      Deep Research Agent
                    </h2>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background: 'color-mix(in srgb, var(--cm-warning) 20%, transparent)',
                        color: 'var(--cm-warning)'
                      }}
                    >
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
                    Project GRAEAE - Autonomous multi-LLM research system
                  </p>
                </div>
              </div>

              {/* Architecture Diagram */}
              <div
                className="rounded-xl p-4 mb-5"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)'
                }}
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-textMuted)' }}>
                  8-Phase Research Pipeline
                </h4>

                {/* Visual Pipeline Flow - phase colors are data-driven, not theme colors */}
                {/* eslint-disable no-restricted-syntax */}
                <div className="flex items-center justify-between gap-1 mb-4 overflow-x-auto pb-2">
                  {[
                    { name: 'Plan', icon: '🎯', color: 'var(--cm-accent)' },
                    { name: 'Search', icon: '🔍', color: 'var(--cm-info)' },
                    { name: 'Retrieve', icon: '📥', color: 'var(--cm-info)' },
                    { name: 'Extract', icon: '⚙️', color: 'var(--cm-success)' },
                    { name: 'Validate', icon: '✓', color: 'var(--cm-success)' },
                    { name: 'Synthesize', icon: '🧠', color: 'var(--cm-warning)' },
                    { name: 'Report', icon: '📄', color: 'var(--cm-accent)' },
                    { name: 'Cache', icon: '💾', color: 'var(--cm-accent)' },
                  ].map((phase, i) => (
                    <motion.div
                      key={phase.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex flex-col items-center min-w-[60px]"
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-1"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${phase.color} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${phase.color} 25%, transparent)`
                        }}
                      >
                        {phase.icon}
                      </div>
                      <span className="text-[10px] font-medium" style={{ color: phase.color }}>
                        {phase.name}
                      </span>
                      {i < 7 && (
                        <div
                          className="absolute right-0 top-1/2 -translate-y-1/2 w-4"
                          style={{
                            background: `linear-gradient(90deg, ${phase.color}, transparent)`,
                            height: '1px'
                          }}
                        />
                      )}
                    </motion.div>
                  ))}
                </div>
                {/* eslint-enable no-restricted-syntax */}

                {/* Validation Stack */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-success) 10%, transparent)' }}>
                    <div className="text-sm">🔺</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Triangulate</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-info) 10%, transparent)' }}>
                    <div className="text-sm">🤝</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Consensus</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                    <div className="text-sm">📊</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Statistics</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-warning) 10%, transparent)' }}>
                    <div className="text-sm">🏛️</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Authority</div>
                  </div>
                </div>
              </div>

              {/* Key Features - Compact */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <Search size={14} style={{ color: 'var(--cm-info)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    5-10 parallel search angles
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <Layers size={14} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    5-tier LLM orchestration
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    4-layer fact validation
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <FileText size={14} style={{ color: 'var(--cm-accent)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    Export: MD, DOCX, PDF
                  </span>
                </div>
              </div>

              {/* Cost savings + Close */}
              <div className="flex items-center justify-between gap-4">
                <div
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg"
                  style={{
                    background: 'linear-gradient(90deg, color-mix(in srgb, var(--cm-success) 10%, transparent), color-mix(in srgb, var(--color-primary) 10%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--cm-success) 20%, transparent)'
                  }}
                >
                  <Sparkles size={14} style={{ color: 'var(--color-success)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                    ~40% cost reduction via intelligent routing
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90"
                  style={{
                    background: 'linear-gradient(90deg, var(--color-primary), var(--cm-info))',
                    color: 'var(--cm-bg)'
                  }}
                >
                  Got it
                </button>
              </div>
            </div>

            {/* CSS for gradient animation */}
            <style>{`
              @keyframes gradient-shift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
            `}</style>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// Model Selector uses the provider-grouped dropdown from ModelSelectorDropdown.tsx
const ModelSelectorDropdown = NewModelSelectorDropdown;

// Enhanced MCP Servers Dropdown Component
const MCPServersDropdown: React.FC<{
  servers: any[];
  onToggleServer?: (serverName: string) => void;
  enabledServers?: Set<string>;
  onClose?: () => void;
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  showModelBadges?: boolean;
  onToggleModelBadges?: () => void;
  isAdmin?: boolean;
}> = ({ servers, onToggleServer, enabledServers, onClose, showMCPIndicators = true, onToggleMCPIndicators, showModelBadges = true, onToggleModelBadges, isAdmin = false }) => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [enabledFunctions, setEnabledFunctions] = useState<Set<string>>(new Set());
  const [serverStates, setServerStates] = useState<Map<string, boolean>>(new Map());

  // Initialize server states and sync with parent enabled tools
  useEffect(() => {
    const states = new Map<string, boolean>();
    servers.forEach(server => {
      states.set(server.id, server.isConnected ?? true);
    });
    setServerStates(states);

    // Initialize enabled functions from parent enabled tools
    if (enabledServers) {
      const initialEnabledFunctions = new Set<string>();
      servers.forEach(server => {
        server.tools?.forEach((tool: any) => {
          const functionKey = `${server.id}.${tool.name}`;
          if (enabledServers.has(functionKey) || enabledServers.has(server.id)) {
            initialEnabledFunctions.add(functionKey);
          }
        });
      });
      setEnabledFunctions(initialEnabledFunctions);
    }
  }, [servers, enabledServers]);

  const toggleServerExpanded = (serverId: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverId)) {
      newExpanded.delete(serverId);
    } else {
      newExpanded.add(serverId);
    }
    setExpandedServers(newExpanded);
  };

  const toggleServer = (serverId: string) => {
    const newStates = new Map(serverStates);
    const currentState = newStates.get(serverId) ?? true;
    newStates.set(serverId, !currentState);
    setServerStates(newStates);

    // If disabling server, disable all its functions
    if (currentState) {
      const server = servers.find(s => s.id === serverId);
      if (server?.tools) {
        const newEnabled = new Set(enabledFunctions);
        server.tools.forEach((tool: any) => {
          newEnabled.delete(`${serverId}.${tool.name}`);
        });
        setEnabledFunctions(newEnabled);
      }
    }

    onToggleServer?.(serverId);
  };

  const toggleFunction = (serverId: string, functionName: string) => {
    const functionKey = `${serverId}.${functionName}`;
    const newEnabled = new Set(enabledFunctions);

    if (newEnabled.has(functionKey)) {
      newEnabled.delete(functionKey);
    } else {
      // Can only enable if server is enabled
      if (serverStates.get(serverId)) {
        newEnabled.add(functionKey);
      }
    }

    setEnabledFunctions(newEnabled);

    // Communicate with parent component
    if (onToggleServer) {
      onToggleServer(functionKey);
    }
  };

  // Build flat list of all tools as tags, grouped by server category
  const allTools = useMemo(() => {
    const tools: { name: string; server: string; serverName: string; connected: boolean }[] = [];
    for (const server of servers) {
      const connected = server.isConnected !== false;
      for (const tool of (server.tools || [])) {
        tools.push({ name: tool.name, server: server.id, serverName: server.name, connected });
      }
    }
    return tools;
  }, [servers]);

  // Group tools by server for display
  const serverGroups = useMemo(() => {
    const groups: Record<string, typeof allTools> = {};
    for (const tool of allTools) {
      if (!groups[tool.serverName]) groups[tool.serverName] = [];
      groups[tool.serverName].push(tool);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [allTools]);

  // Category colors matching the activity stream badges
  const getCatColor = (serverName: string): string => {
    const s = serverName.toLowerCase();
    if (s.includes('web')) return 'color-mix(in srgb, var(--cm-info) 15%, transparent)';
    if (s.includes('azure')) return 'color-mix(in srgb, var(--cm-accent) 15%, transparent)';
    if (s.includes('aws')) return 'color-mix(in srgb, var(--cm-warning) 15%, transparent)';
    if (s.includes('gcp') || s.includes('google')) return 'color-mix(in srgb, var(--cm-info) 15%, transparent)';
    if (s.includes('k8s') || s.includes('kubernetes')) return 'color-mix(in srgb, var(--cm-accent) 15%, transparent)';
    if (s.includes('github')) return 'color-mix(in srgb, var(--cm-text-muted) 15%, transparent)';
    if (s.includes('prometheus') || s.includes('loki')) return 'color-mix(in srgb, var(--cm-warning) 15%, transparent)';
    if (s.includes('admin')) return 'color-mix(in srgb, var(--cm-accent) 15%, transparent)';
    if (s.includes('diagram')) return 'color-mix(in srgb, var(--cm-success) 15%, transparent)';
    if (s.includes('memory')) return 'color-mix(in srgb, var(--cm-accent) 15%, transparent)';
    return 'color-mix(in srgb, var(--cm-text-muted) 12%, transparent)';
  };

  return (
    <div
      className="min-w-[320px] max-w-[520px] rounded-xl"
      style={{
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--color-shadow)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 relative" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {allTools.length} Tools Available
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
          {servers.filter((s: any) => s.isConnected !== false).length} servers connected — auto-selected by semantic search
        </div>

        {/* Admin Toggles */}
        {isAdmin && (onToggleMCPIndicators || onToggleModelBadges) && (
          <div className="flex gap-4 mt-2">
            {onToggleMCPIndicators && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: 'var(--color-textMuted)' }}>
                <input type="checkbox" checked={showMCPIndicators} onChange={onToggleMCPIndicators} className="rounded" style={{ width: 12, height: 12 }} />
                Tool calls
              </label>
            )}
            {onToggleModelBadges && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: 'var(--color-textMuted)' }}>
                <input type="checkbox" checked={showModelBadges} onChange={onToggleModelBadges} className="rounded" style={{ width: 12, height: 12 }} />
                Model badges
              </label>
            )}
          </div>
        )}

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close tools panel"
            className="absolute top-3 right-3 p-1 rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--color-err)_20%,transparent)]"
            style={{ color: 'var(--color-textMuted)' }}
            title="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Tools as tags grouped by server */}
      <div className="p-3 max-h-[400px] overflow-y-auto">
        {serverGroups.map(([serverName, tools]) => {
          const connected = tools[0]?.connected !== false;
          return (
            <div key={serverName} className="mb-3 last:mb-0">
              {/* Server label */}
              <div className="flex items-center gap-2 mb-1.5">
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: connected ? 'var(--cm-ok)' : 'var(--cm-err)',
                }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--color-textSecondary)' }}>
                  {serverName}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                  ({tools.length})
                </span>
              </div>
              {/* Tool tags */}
              <div className="flex flex-wrap gap-1 pl-4">
                {tools.map(tool => (
                  <span
                    key={`${tool.server}.${tool.name}`}
                    className="inline-block px-2 py-0.5 rounded-md text-xs font-mono"
                    style={{
                      background: getCatColor(serverName),
                      color: 'var(--color-text)',
                      fontSize: 10,
                      opacity: connected ? 1 : 0.5,
                      border: '1px solid transparent',
                    }}
                    title={tool.name}
                  >
                    {tool.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// PersonalitySelectorDropdown REMOVED - Replaced with SkillSelector component
// Skills system following Anthropic Agent Skills standard (https://github.com/anthropics/skills)

// Main Toolbar Component Props
interface ChatInputToolbarProps {
  availableMcpFunctions?: any;
  enabledTools?: Set<string>;
  onToggleTool?: (toolName: string) => void;
  onToggleBackgroundJobs?: () => void;
  onToggleWorkflows?: () => void;
  availableModels?: Array<{ id: string; name: string; description?: string; type?: string; }>;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  isAdmin: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  disabled?: boolean;
  tokenCount?: number;
  onToggleTokenUsage?: () => void;
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  // Model Badges toggle
  showModelBadges?: boolean;
  onToggleModelBadges?: () => void;
  // Thinking mode toggle
  isThinkingEnabled?: boolean;
  onThinkingToggle?: () => void;
  // Thinking budget (admin only)
  thinkingBudget?: number;
  onThinkingBudgetChange?: (budget: number) => void;
  modelSupportsThinking?: boolean;
  // LLM working indicator
  isStreaming?: boolean;
  // File attachments for thumbnail display
  attachments?: AttachmentFile[];
  onAttachmentRemove?: (fileId: string) => void;
  // Multi-model mode (disables model selector when enabled)
  isMultiModelEnabled?: boolean;
  // Admin Tool Inspector toggle
  onToggleToolInspector?: () => void;
  showToolInspector?: boolean;
}

/**
 * GroundingToggleButton — magnifying-glass+check glyph toggle that flips
 * the global useGroundingStore.enabled flag. ON = bright accent outline +
 * filled tint, OFF = muted secondary text token. Persists via localStorage
 * (zustand persist middleware). Theme tokens only — no hex literals
 * (CLAUDE.md rule 8b).
 */
const GroundingToggleButton: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const enabled = useGroundingStore((s) => s.enabled);
  const toggle = useGroundingStore((s) => s.toggle);
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={toggle}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      aria-label={
        enabled
          ? 'Web grounding on — answers verified against web sources'
          : 'Web grounding off — toggle on to fact-check responses'
      }
      data-testid="chat-grounding-toggle"
      data-grounding-enabled={enabled ? 'true' : 'false'}
      className={clsx(
        'p-2 rounded-lg transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        'hover:bg-theme-bg-secondary',
      )}
      style={{
        // ON state must land on the REAL accent (--color-accent, which follows
        // the user's picked accent). The prior terminal fallback was
        // --text-primary, but --cm-accent/--accent are legacy-scoped and
        // undefined in normal chat — so "on" resolved to the muted text color
        // and looked identical to "off". Land on --color-accent + a glow so the
        // lit state is unmistakable. Theme tokens only (CLAUDE.md rule 8b).
        color: enabled ? 'var(--cm-accent, var(--accent, var(--color-accent)))' : 'var(--text-secondary)',
        border: enabled
          ? '1px solid var(--cm-accent, var(--accent, var(--color-accent)))'
          : '1px solid transparent',
        backgroundColor: enabled
          ? 'color-mix(in srgb, var(--cm-accent, var(--accent, var(--color-accent))) 22%, transparent)'
          : 'transparent',
        boxShadow: enabled
          ? '0 0 13px -1px color-mix(in srgb, var(--cm-accent, var(--accent, var(--color-accent))) 55%, transparent)'
          : undefined,
      }}
      title={
        enabled
          ? 'Web grounding on — turning off skips the post-stream web_search verify pass'
          : 'Web grounding off — turn on to verify the next answer against web sources'
      }
    >
      <SearchCheck size={18} aria-hidden="true" />
    </motion.button>
  );
};

/**
 * FollowupChipsToggleButton — Sparkles glyph toggle that flips the global
 * useFollowupChipsStore.enabled flag. ON = bright accent outline + filled tint
 * (chips visible), OFF = muted secondary text token (chips suppressed).
 * Persists via localStorage (zustand persist middleware). Theme tokens only —
 * no hex literals (CLAUDE.md rule 8b). Initial state: ENABLED (user: "they
 * DO fucking rock"). Exported for test isolation.
 */
export const FollowupChipsToggleButton: React.FC<{ disabled?: boolean }> = ({ disabled }) => {
  const enabled = useFollowupChipsStore((s) => s.enabled);
  const toggle = useFollowupChipsStore((s) => s.toggle);
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={toggle}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      aria-label={
        enabled
          ? 'Follow-up suggestions on — assistant will suggest next prompts'
          : 'Follow-up suggestions off — assistant won\'t show follow-up chips'
      }
      data-testid="chat-followup-chips-toggle"
      data-enabled={enabled ? 'true' : 'false'}
      className={clsx(
        'p-2 rounded-lg transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        'hover:bg-theme-bg-secondary',
      )}
      style={{
        // Same lit-state fix as GroundingToggleButton: terminal fallback now
        // --color-accent (not --text-primary) so ON is the real accent + glow,
        // not a muted near-off color. Theme tokens only (CLAUDE.md rule 8b).
        color: enabled ? 'var(--cm-accent, var(--accent, var(--color-accent)))' : 'var(--text-secondary)',
        border: enabled
          ? '1px solid var(--cm-accent, var(--accent, var(--color-accent)))'
          : '1px solid transparent',
        backgroundColor: enabled
          ? 'color-mix(in srgb, var(--cm-accent, var(--accent, var(--color-accent))) 22%, transparent)'
          : 'transparent',
        boxShadow: enabled
          ? '0 0 13px -1px color-mix(in srgb, var(--cm-accent, var(--accent, var(--color-accent))) 55%, transparent)'
          : undefined,
      }}
      title={
        enabled
          ? 'Follow-up suggestions on — click to hide follow-up chips'
          : 'Follow-up suggestions off — click to show follow-up chips after answers'
      }
    >
      <Sparkles size={18} aria-hidden="true" />
    </motion.button>
  );
};

// Main Toolbar Component - Gemini Style
const ChatInputToolbar: React.FC<ChatInputToolbarProps> = ({
  availableMcpFunctions,
  enabledTools,
  onToggleTool,
  availableModels,
  selectedModel,
  onModelChange,
  isAdmin,
  fileInputRef,
  disabled,
  showMCPIndicators = true,
  onToggleMCPIndicators,
  // Model Badges toggle
  showModelBadges = true,
  onToggleModelBadges,
  // Thinking mode toggle
  isThinkingEnabled = true,
  onThinkingToggle,
  // Thinking budget (admin only)
  thinkingBudget = 8000,
  onThinkingBudgetChange,
  modelSupportsThinking = true,
  // LLM working indicator
  isStreaming = false,
  // File attachments
  attachments = [],
  onAttachmentRemove,
  // Multi-model mode
  isMultiModelEnabled = false,
  // Admin Tool Inspector
  onToggleToolInspector,
  showToolInspector = false,
}) => {
  // Local state management for dropdowns
  const [showModelSelector, setShowModelSelector] = useState(false);
  const modelSelectorButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;

      // Check if click is outside model selector
      if (showModelSelector) {
        const modelDropdown = target.closest('.model-selector-dropdown');
        const modelButton = target.closest('.model-selector-button');
        if (!modelDropdown && !modelButton) {
          setShowModelSelector(false);
        }
      }

      // Note: Skills dropdown handles its own click-outside behavior internally
    };

    if (showModelSelector) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModelSelector]);
  return (
    <div className="space-y-2">
      {/* File Attachment Thumbnails - shown above toolbar when files are attached */}
      {attachments && attachments.length > 0 && (
        <FileAttachmentThumbnails
          attachments={attachments}
          onRemove={onAttachmentRemove}
        />
      )}

      {/* Toolbar controls */}
      <div className="flex items-center justify-between">
        {/* Left side - Tools and utilities */}
        <div className="flex items-center gap-3">
          {/* Attach Button — claude.ai-style circular `+` glyph at the LEFT
              edge of the composer toolbar. Post-#940 reverted Plus from
              AttachDropTray; #941 (2026-05-20) restores the CIRCULAR pill
              container (`rounded-full`) to match claude.ai's affordance —
              previous `rounded-lg` produced 8px square-ish corners. Drag-drop
              on the textarea is preserved by ChatInputBar (#683/#687) and is
              orthogonal to this trigger. */}
          <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach files"
          data-testid="chat-attach-button"
          className={clsx(
            'p-2 rounded-full transition-colors',
            disabled && 'opacity-50 cursor-not-allowed',
            'hover:bg-theme-bg-secondary'
          )}
          style={{ color: 'var(--text-secondary)' }}
          title="Attach files"
        >
          <Plus size={18} aria-hidden="true" />
        </motion.button>

        {/* Grounding Toggle — magnifying-glass + check glyph. When ON, post-stream
            the platform appends a `grounding_check` invocation that web_searches
            authoritative sources and renders a verdict chip below the answer.
            User feedback 2026-05-18: "we also need a grounding t1 that checks
            the prompts responses by looking what the model recommended on the
            internet using web_search tool". State persists via useGroundingStore.
            All colors resolved via var(--cm-*)/var(--text-secondary) per
            CLAUDE.md rule 8(b). */}
        <GroundingToggleButton disabled={disabled} />

        {/* Follow-up chips toggle — Sparkles glyph. ON = chips render below
            assistant messages, OFF = ChipsRow returns null. User direction
            2026-05-19: "we also need a button... to enable/disable recommended
            followup pills (which DO fucking rock)". State persists via
            useFollowupChipsStore. Colors via var(--cm-*) per CLAUDE.md 8(b). */}
        <FollowupChipsToggleButton disabled={disabled} />

        {/* MCP Servers puzzle button removed — MCP tools are auto-discovered by the pipeline */}

        {/* Skills configuration moved to Admin Portal > Pipeline Settings */}

      </div>

      {/* Right side - Model selector (Admin only) */}
      <div className="flex items-center gap-2">
        {/* Model Selector - Only visible to admins. Dropped the scale-on-hover
            framer transform because 1.02/0.98 against a 1px border produced
            subpixel shimmer that read as "jagged" on the pill edge.
            borderRadius pinned to 9999px explicitly (not rounded-full class)
            so Tailwind's purge can't strip it, transform:translateZ(0) forces
            the browser to rasterize on a pixel grid. */}
        {/* RIPPED: Tools-indexed sanity pill (per user direction —
            cluttered the composer + the data is admin-only ops noise
            that doesn't belong in the chat input bar). */}

        {isAdmin && availableModels && availableModels.length > 0 && onModelChange && (
          <div className="relative">
            <button
              ref={modelSelectorButtonRef}
              type="button"
              onClick={() => setShowModelSelector(!showModelSelector)}
              aria-label={`Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Auto-Routing'}`}
              aria-haspopup="listbox"
              aria-expanded={showModelSelector}
              className="model-selector-button flex items-center gap-2 px-3 py-1.5 transition-colors text-sm hover:bg-theme-bg-secondary"
              style={{
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--color-surfaceSecondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 9999,
                transform: 'translateZ(0)',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
              }}
              title={`Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Auto-Routing'}`}
            >
              <span className="font-medium">
                {selectedModel
                  ? availableModels.find(m => m.id === selectedModel)?.name
                  : 'Auto-Routing'}
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        {/* Extended Thinking toggle — Brain glyph. Visible ONLY when the
            selected model supports extended thinking (capabilities.thinking
            from the Registry row — no hardcoded model names, CLAUDE.md Rule 7).
            ON by default. Reads from useModelStore.selectedModel +
            availableModels directly — no prop drilling needed. State persists
            via useExtendedThinkingStore (localStorage). Colors via var(--cm-*)
            per CLAUDE.md rule 8(b). */}
        <ExtendedThinkingToggleButton disabled={disabled} />

        {/* JSON admin tool-inspector button — removed 2026-04-20 per user
            feedback (dead weight on the composer). Its source is still in
            ChatContainer via onToggleToolInspector prop; that prop is now
            unused and can be dropped on the next pass. */}
      </div>

      {/* Model Selector Dropdown - Provider-grouped with search, capabilities, cost */}
      {isAdmin && onModelChange && showModelSelector && (
        <ModelSelectorDropdown
          selectedModel={selectedModel || ''}
          availableModels={availableModels || []}
          onModelChange={onModelChange}
          onClose={() => setShowModelSelector(false)}
          buttonRef={modelSelectorButtonRef}
        />
      )}

      </div>
    </div>
  );
};

export default ChatInputToolbar;