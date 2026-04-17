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
import { Plus, ChevronDown, ChevronRight, X, PuzzleIcon, Layers, Code2, Sparkles, Search, CheckCircle, FileText, Smile } from '@/shared/icons';
// SynthIndicator removed - HITM enforced, no YOLO mode
// ThinkingIcon removed - thinking is auto-enabled for supported models
import FileAttachmentThumbnails, { AttachmentFile } from './FileAttachmentThumbnails';
import { ModelSelectorDropdown as NewModelSelectorDropdown } from './ModelSelectorDropdown';
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
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(6px)' }}
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
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Animated rainbow gradient header - intentional decorative colors */}
            {/* eslint-disable no-restricted-syntax */}
            <div
              className="h-1.5"
              style={{
                background: 'linear-gradient(90deg, #FF375F, #F97316, #FFD60A, #22C55E, #0A84FF, #BF5AF2, #FF375F)',
                backgroundSize: '200% 100%',
                animation: 'gradient-shift 4s ease infinite'
              }}
            />
            {/* eslint-enable no-restricted-syntax */}

            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="Close Deep Research Agent dialog"
              className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors hover:bg-white/10 z-10"
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
                    background: 'linear-gradient(135deg, rgba(255,0,128,0.15), color-mix(in srgb, var(--color-primary) 15%, transparent), rgba(0,191,255,0.15))',
                    boxShadow: `0 0 30px color-mix(in srgb, var(--color-primary) 20%, transparent)`
                  }}
                >
                  <Sparkles
                    size={36}
                    style={{
                      color: 'url(#rainbow-gradient)'
                    }}
                  />
                  {/* Rainbow gradient SVG - intentional decorative colors */}
                  {/* eslint-disable no-restricted-syntax */}
                  <svg width="0" height="0" className="absolute">
                    <defs>
                      <linearGradient id="rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#FF375F" />
                        <stop offset="33%" stopColor="#BF5AF2" />
                        <stop offset="66%" stopColor="#0A84FF" />
                        <stop offset="100%" stopColor="#22C55E" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {/* eslint-enable no-restricted-syntax */}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {/* Rainbow text gradient - intentional decorative colors */}
                    {/* eslint-disable no-restricted-syntax */}
                    <h2
                      className="text-xl font-bold"
                      style={{
                        background: 'linear-gradient(90deg, #ff0080, #8b5cf6, #00bfff)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                      }}
                    >
                      Deep Research Agent
                    </h2>
                    {/* eslint-enable no-restricted-syntax */}
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background: 'rgba(251,191,36,0.2)',
                        color: '#fbbf24'
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
                    { name: 'Plan', icon: '🎯', color: '#8b5cf6' },
                    { name: 'Search', icon: '🔍', color: '#3b82f6' },
                    { name: 'Retrieve', icon: '📥', color: '#06b6d4' },
                    { name: 'Extract', icon: '⚙️', color: '#10b981' },
                    { name: 'Validate', icon: '✓', color: '#00D26A' },
                    { name: 'Synthesize', icon: '🧠', color: '#f59e0b' },
                    { name: 'Report', icon: '📄', color: '#ec4899' },
                    { name: 'Cache', icon: '💾', color: '#8b5cf6' },
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
                          backgroundColor: `${phase.color}20`,
                          border: `1px solid ${phase.color}40`
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
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}>
                    <div className="text-sm">🔺</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Triangulate</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                    <div className="text-sm">🤝</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Consensus</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                    <div className="text-sm">📊</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Statistics</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                    <div className="text-sm">🏛️</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Authority</div>
                  </div>
                </div>
              </div>

              {/* Key Features - Compact */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <Search size={14} style={{ color: '#00bfff' }} />
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
                  <FileText size={14} style={{ color: '#ec4899' }} />
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
                    background: 'linear-gradient(90deg, rgba(34,197,94,0.1), color-mix(in srgb, var(--color-primary) 10%, transparent))',
                    border: '1px solid rgba(34,197,94,0.2)'
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
                    background: 'linear-gradient(90deg, var(--color-primary), #00bfff)',
                    color: 'white'
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
    if (s.includes('web')) return 'rgba(59, 130, 246, 0.15)';
    if (s.includes('azure')) return 'rgba(0, 120, 212, 0.15)';
    if (s.includes('aws')) return 'rgba(255, 153, 0, 0.15)';
    if (s.includes('gcp') || s.includes('google')) return 'rgba(66, 133, 244, 0.15)';
    if (s.includes('k8s') || s.includes('kubernetes')) return 'rgba(50, 108, 229, 0.15)';
    if (s.includes('github')) return 'rgba(139, 148, 158, 0.15)';
    if (s.includes('prometheus') || s.includes('loki')) return 'rgba(230, 100, 50, 0.15)';
    if (s.includes('admin')) return 'rgba(168, 85, 247, 0.15)';
    if (s.includes('diagram')) return 'rgba(34, 197, 94, 0.15)';
    if (s.includes('memory')) return 'rgba(236, 72, 153, 0.15)';
    return 'rgba(107, 114, 128, 0.12)';
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
            className="absolute top-3 right-3 p-1 rounded-md transition-colors hover:bg-red-500/20"
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
                  background: connected ? '#2ea043' : '#da3633',
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
  // OpenAgenticCode toggle
  isCodeMode?: boolean;
  onCodeModeToggle?: () => void;
  canUseAwcode?: boolean;
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
  // OAT / Tool Synthesis (display only - no YOLO mode)
  synthEnabled?: boolean;
  synthPendingCount?: number;
  onSynthToggle?: () => void;
  onSynthClick?: () => void;
  // Admin Tool Inspector toggle
  onToggleToolInspector?: () => void;
  showToolInspector?: boolean;
}

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
  // OpenAgenticCode toggle
  isCodeMode = false,
  onCodeModeToggle,
  canUseAwcode = false,
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
  // OAT / Tool Synthesis (display only)
  synthEnabled = false,
  synthPendingCount = 0,
  onSynthToggle,
  onSynthClick,
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
          {/* Plus/Attachment Button */}
          <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Add files or images"
          className={clsx(
            'p-2 rounded-lg transition-colors',
            disabled && 'opacity-50 cursor-not-allowed',
            'hover:bg-theme-bg-secondary'
          )}
          style={{ color: 'rgb(var(--text-secondary))' }}
          title="Add files or images"
        >
          <Plus size={18} aria-hidden="true" />
        </motion.button>

        {/* MCP Servers puzzle button removed — MCP tools are auto-discovered by the pipeline */}

        {/* OAT / Tool Synthesis - removed YOLO mode, HITM enforced */}

        {/* OpenAgenticCode button removed - use sidebar mode toggle instead (Ctrl+Shift+C) */}

        {/* Extended Thinking is auto-enabled for models that support it - no UI toggle needed */}

        {/* Skills configuration moved to Admin Portal > Pipeline Settings */}

      </div>

      {/* Right side - Model selector (Admin only) */}
      <div className="flex items-center gap-2">
        {/* Model Selector - Only visible to admins */}
        {isAdmin && availableModels && availableModels.length > 0 && onModelChange && (
          <div className="relative">
            <motion.button
              ref={modelSelectorButtonRef}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowModelSelector(!showModelSelector)}
              aria-label={`Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Smart Router'}`}
              aria-haspopup="listbox"
              aria-expanded={showModelSelector}
              className={clsx(
                'model-selector-button flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors text-sm',
                'hover:bg-theme-bg-secondary',
                'border border-theme-border-primary'
              )}
              style={{
                color: 'rgb(var(--text-secondary))',
                backgroundColor: 'var(--color-surfaceSecondary)'
              }}
              title={`Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Smart Router'}`}
            >
              <span className="font-medium">
                {selectedModel
                  ? availableModels.find(m => m.id === selectedModel)?.name
                  : 'Smart Router'}
              </span>
              <ChevronDown size={14} />
            </motion.button>
          </div>
        )}

        {/* Admin Tool Inspector Button */}
        {isAdmin && onToggleToolInspector && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggleToolInspector}
            aria-label="Toggle Tool Call Inspector"
            title="Inspect tool call request/response JSON"
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-colors text-xs font-medium',
              'border',
              showToolInspector
                ? 'border-blue-500/50 bg-blue-500/10'
                : 'border-theme-border-primary hover:bg-theme-bg-secondary'
            )}
            style={{
              color: showToolInspector ? 'var(--color-primary)' : 'rgb(var(--text-secondary))',
            }}
          >
            <Code2 size={14} />
            <span>JSON</span>
          </motion.button>
        )}
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