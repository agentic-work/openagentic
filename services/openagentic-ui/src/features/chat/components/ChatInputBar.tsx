/**
 * Modern Chat Input Bar Component
 * 
 * A polished chat input matching the UX of ChatGPT, Claude, and Gemini
 * Features:
 * - Auto-expanding textarea
 * - Floating bottom bar with rounded corners
 * - Plus button for attachments
 * - Send button that appears when text is entered
 * - Shift+Enter for newlines
 * - Mobile-friendly with sticky positioning
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Square, Paperclip, Image, FileText, X, Code2 } from '@/shared/icons';
import clsx from 'clsx';
import { useAuth } from '@/app/providers/AuthContext';
import ChatInputToolbar from './ChatInputToolbar';
// ToolApprovalPopup moved to ChatMessages for inline display
import { MCPCallsDisplay } from './MCPInlineDisplay';
import FileAttachmentThumbnails from './FileAttachmentThumbnails';
import { LongRunStatusPill } from './LongRunStatusPill';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { useSlashCommands, type SlashCommand } from '../hooks/useSlashCommands';
import CommandAutocomplete from './CommandAutocomplete';

interface AttachmentFile {
  id: string;
  file: File;
  type: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other';
  preview?: string;
  uploadProgress?: number;
}

interface ChatInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStopGeneration?: () => void;
  onFileSelect?: (files: File[]) => void;
  onFileRemove?: (fileId: string) => void;
  isLoading?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxRows?: number;
  attachments?: AttachmentFile[];
  className?: string;
  messageHistory?: string[];
  // Toolbar props
  showSettings?: boolean;
  showTokenUsage?: boolean;
  showTTS?: boolean;
  selectedModel?: string;
  availableModels?: Array<{ id: string; name: string; description?: string; }>;
  onToggleSettings?: () => void;
  onToggleTokenUsage?: () => void;
  onToggleTTS?: () => void;
  onModelChange?: (model: string) => void;
  settingsButtonRef?: React.RefObject<HTMLButtonElement>;
  currentPrompt?: string; // Show the actual prompt being used
  // Global token usage for admins
  globalTokenUsage?: {
    total: number;
    sessions: number;
    users: number;
    cost: number;
  };
  // MCP functions
  availableMcpFunctions?: any;
  enabledTools?: Set<string>;
  onToggleTool?: (toolName: string) => void;
  onToggleBackgroundJobs?: () => void;
  onToggleWorkflows?: () => void;
  // Token counting
  tokenCount?: number;
  // Active MCP calls for floating display
  activeMcpCalls?: any[];
  // MCP Indicators display toggle
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  // Model Badges display toggle
  showModelBadges?: boolean;
  onToggleModelBadges?: () => void;
  // Thinking mode toggle
  isThinkingEnabled?: boolean;
  onThinkingToggle?: () => void;
  modelSupportsThinking?: boolean;
  // Multi-model mode (disables model selector when enabled)
  isMultiModelEnabled?: boolean;
  // Admin Tool Inspector
  onToggleToolInspector?: () => void;
  showToolInspector?: boolean;
  // Sev-1 #923 — long-run progress indicator (visible inside the composer
  // after the stream has been active for 30+ seconds). For multi-minute
  // capstone prompts where the assistant header (and its ThinkingSphere)
  // has scrolled out of view.
  streamStartedAt?: number | null;
  longRunModelLabel?: string;
  longRunOutputTokens?: number;
  longRunStatus?: string;
}

const ChatInputBar: React.FC<ChatInputBarProps> = ({
  value,
  onChange,
  onSend,
  onStopGeneration,
  onFileSelect,
  onFileRemove,
  isLoading = false,
  isStreaming = false,
  disabled = false,
  placeholder = "What can I do for you?",
  maxRows = 6,
  attachments = [],
  className,
  messageHistory = [],
  // Toolbar props
  showSettings = false,
  showTokenUsage = false,
  showTTS = false,
  selectedModel = 'auto',
  availableModels = [],
  onToggleSettings,
  onToggleTokenUsage,
  onToggleTTS,
  onModelChange,
  settingsButtonRef,
  currentPrompt,
  globalTokenUsage,
  availableMcpFunctions,
  enabledTools,
  onToggleTool,
  onToggleBackgroundJobs,
  onToggleWorkflows,
  // Token counting
  tokenCount,
  activeMcpCalls = [],
  showMCPIndicators = true,
  onToggleMCPIndicators,
  // Model Badges toggle
  showModelBadges = true,
  onToggleModelBadges,
  // Thinking mode toggle
  isThinkingEnabled = true,
  onThinkingToggle,
  // Multi-model mode
  isMultiModelEnabled = false,
  // Admin Tool Inspector
  onToggleToolInspector,
  showToolInspector = false,
  // Sev-1 #923 — long-run progress indicator wiring
  streamStartedAt = null,
  longRunModelLabel,
  longRunOutputTokens,
  longRunStatus,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{[key: string]: number}>({});
  const [dragCounter, setDragCounter] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { user } = useAuth();

  // Slash command autocomplete state
  const { getMatchingCommands, executeCommand, helpResponse } = useSlashCommands();
  const [showCommandAutocomplete, setShowCommandAutocomplete] = useState(false);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const matchingCommands = getMatchingCommands(value);

  // Get user permissions
  const { permissions } = useUserPermissions();

  // Check if user is admin (check both isAdmin and is_admin for compatibility)
  const isAdmin = user?.isAdmin || user?.is_admin || user?.groups?.includes('OpenAgenticAdmins') || user?.groups?.includes('admin') || false;

  // Focus textarea when component mounts
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Reset textarea height when value is cleared (after send)
  useEffect(() => {
    if (!value && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value]);

  // Load starter prompt from localStorage (set by WelcomeCapabilitySelector or StarterPrompts)
  // Also listen for custom event when prompt is set after component mount
  useEffect(() => {
    const loadStarterPrompt = () => {
      const starterPrompt = localStorage.getItem('ac-starter-prompt');
      if (starterPrompt) {
        onChange(starterPrompt);
        localStorage.removeItem('ac-starter-prompt');
        // Focus and position cursor at end
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.selectionStart = textareaRef.current.value.length;
            textareaRef.current.selectionEnd = textareaRef.current.value.length;
          }
        }, 100);
      }
    };

    // Check on mount
    loadStarterPrompt();

    // Listen for custom event when WelcomeCapabilitySelector or StarterPrompts sets a prompt
    const handleStarterPromptEvent = () => {
      loadStarterPrompt();
    };
    window.addEventListener('ac-starter-prompt-set', handleStarterPromptEvent);

    return () => {
      window.removeEventListener('ac-starter-prompt-set', handleStarterPromptEvent);
    };
  }, [onChange]);

  // Show/hide command autocomplete based on input
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.startsWith('/') && !trimmed.includes(' ') && matchingCommands.length > 0) {
      setShowCommandAutocomplete(true);
      setCommandSelectedIndex(0);
    } else {
      setShowCommandAutocomplete(false);
    }
  }, [value, matchingCommands.length]);

  // Handle slash command selection from autocomplete
  const handleCommandSelect = useCallback((command: SlashCommand) => {
    setShowCommandAutocomplete(false);
    onChange(command.command);
    // Execute the command when Enter is pressed (handled in handleKeyDown)
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command autocomplete navigation
    if (showCommandAutocomplete && matchingCommands.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandSelectedIndex(prev =>
          prev > 0 ? prev - 1 : matchingCommands.length - 1
        );
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandSelectedIndex(prev =>
          prev < matchingCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const selectedCommand = matchingCommands[commandSelectedIndex];
        if (selectedCommand) {
          onChange(selectedCommand.command);
          setShowCommandAutocomplete(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowCommandAutocomplete(false);
        return;
      }
    }

    // Up arrow - cycle through previous messages
    if (e.key === 'ArrowUp' && !value && messageHistory.length > 0) {
      e.preventDefault();
      const newIndex = historyIndex + 1;
      if (newIndex < messageHistory.length) {
        setHistoryIndex(newIndex);
        onChange(messageHistory[messageHistory.length - 1 - newIndex]);
      }
      return;
    }
    // Down arrow - cycle back through history
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault();
      const newIndex = historyIndex - 1;
      if (newIndex >= 0) {
        setHistoryIndex(newIndex);
        onChange(messageHistory[messageHistory.length - 1 - newIndex]);
      } else {
        setHistoryIndex(-1);
        onChange('');
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Allow sending during streaming to queue messages
      if (value.trim() && !disabled) {
        setHistoryIndex(-1); // Reset history on send
        onSend();
      }
    }
  }, [value, disabled, onSend, historyIndex, messageHistory, onChange, showCommandAutocomplete, matchingCommands, commandSelectedIndex]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    
    if (imageItems.length > 0 && onFileSelect) {
      e.preventDefault();
      const files = imageItems
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      
      if (files.length > 0) {
        onFileSelect(files);
      }
    }
  }, [onFileSelect]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (!isDragging) {
      setIsDragging(true);
    }
  }, [isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onFileSelect) {
      // Simulate upload progress for demo
      files.forEach((file, index) => {
        const fileKey = `${file.name}-${Date.now()}-${index}`;
        setUploadProgress(prev => ({ ...prev, [fileKey]: 0 }));
        
        // Simulate progressive upload
        let progress = 0;
        const interval = setInterval(() => {
          progress += Math.random() * 30;
          if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
              setUploadProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[fileKey];
                return newProgress;
              });
            }, 500);
          }
          setUploadProgress(prev => ({ ...prev, [fileKey]: progress }));
        }, 100);
      });
      
      onFileSelect(files);
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && onFileSelect) {
      onFileSelect(files);
    }
    // Reset input so the same file can be selected again
    e.target.value = '';
  }, [onFileSelect]);

  const hasContent = value.trim().length > 0;
  const showSendButton = hasContent || attachments.length > 0;
  const showStopButton = isLoading || isStreaming;

  return (
    <div
      className={clsx(
        'w-full',
        'px-3 pb-6',
        // Terminal Glass (Phase 4) — the composer is the last beat of the
        // orchestrated load-in cascade (sidebar d1 → main d2 → first user d3
        // → first assistant d4 → composer d5). One-shot rise+fade; keyframes +
        // delay live in theme.css (the ONE SOT).
        'rise rise-d5',
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto mb-4">
        {/* Attachments Preview - Enhanced with FileAttachmentThumbnails */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mb-3"
            >
              <FileAttachmentThumbnails
                attachments={attachments}
                onRemove={onFileRemove}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified Input Container — TERMINAL GLASS (elevated) composer:
            a frosted glass panel (.glass-surface: top-lit gradient + blur +
            soft 1px border + soft radius) with a signal-orange focus GLOW on
            focus-within, mirroring the reference composer. Token-only — every
            visual value reads the per-theme glass / ctl tokens in theme.css,
            so the panel flips dark ("orange-aurora") ⇄ light ("Warm Frost"). */}
        <div
          className={clsx(
            'glass-surface relative',
            'transition-[border-color,box-shadow,background] duration-150',
            'focus-within:[border-color:var(--ctl-focus-border)]',
            'focus-within:[box-shadow:var(--ctl-focus-ring),var(--glass-card-shadow)]',
            isDragging && '[border-color:var(--ctl-focus-border)]'
          )}
        >
          {/* Drag Overlay */}
          <AnimatePresence>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-accent-primary/10 z-10 border border-dashed border-accent-primary [border-radius:var(--glass-radius)]"
              >
                <div className="text-center">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="mb-2"
                  >
                    <Paperclip size={32} className="text-theme-accent mx-auto" />
                  </motion.div>
                  <p className={clsx(
                    'font-medium',
                    'text-theme-accent'
                  )}>
                    Drop files here to attach
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Upload Progress Overlay */}
          <AnimatePresence>
            {Object.keys(uploadProgress).length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-0 left-0 right-0 -translate-y-full mb-2 p-3 rounded-popover shadow-soft-md border z-20 bg-theme-bg-card/95 border-theme-border-primary"
              >
                <div className="space-y-2">
                  {Object.entries(uploadProgress).map(([fileKey, progress]) => {
                    const fileName = fileKey.split('-')[0];
                    return (
                      <div key={fileKey} className="flex items-center gap-3">
                        <Paperclip size={14} className="text-theme-accent flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-theme-text-muted truncate">{fileName}</div>
                          <div
                          className="w-full rounded-full h-1.5 mt-1"
                          style={{ backgroundColor: 'var(--color-background)' }}>
                            <motion.div
                              className="bg-accent-primary h-1.5 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${progress}%` }}
                              transition={{ duration: 0.2 }}
                            />
                          </div>
                        </div>
                        <div className="text-xs text-theme-text-muted font-mono">
                          {Math.round(progress)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Slash Command Autocomplete */}
          {showCommandAutocomplete && matchingCommands.length > 0 && (
            <CommandAutocomplete
              commands={matchingCommands}
              selectedIndex={commandSelectedIndex}
              onSelect={handleCommandSelect}
              onClose={() => setShowCommandAutocomplete(false)}
              position="above"
            />
          )}

          {/* Sev-1 #923 — Long-run progress pill. Lives inside the composer
              container's normal flow (NOT floating — the floating bottom-
              center pattern was ripped in #667). The pill returns null
              before 30s elapsed so short responses stay clean. Visible
              inside the same rounded surface as the textarea so it tracks
              the user's eye line during multi-minute capstone prompts. */}
          {(isStreaming || isLoading) && streamStartedAt != null && (
            <div className="px-5 pt-3">
              <LongRunStatusPill
                isStreaming={isStreaming || isLoading}
                streamStartedAt={streamStartedAt}
                modelLabel={longRunModelLabel}
                outputTokens={longRunOutputTokens}
                status={longRunStatus}
              />
            </div>
          )}

          {/* Textarea — M3 Expressive (task #160): generous 16px vert /
              20px horiz padding to balance the 28px pill shape. */}
          <div className="flex items-center gap-2 pl-5 pr-3 py-4 relative">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 28 * maxRows)}px`;
                }}
                placeholder={isStreaming ? "Type to queue another message..." : placeholder}
                disabled={disabled}
                rows={1}
                aria-label="Chat message input"
                aria-multiline="true"
                aria-describedby="chat-input-hint"
                role="textbox"
                className={clsx(
                  'w-full resize-none bg-transparent',
                  'text-[16px] leading-relaxed',
                  'outline-none border-0 focus:outline-none',
                  'placeholder:text-[var(--color-fg-subtle)]',
                  'overflow-y-auto',
                  'text-theme-text-primary',
                  disabled && 'cursor-not-allowed opacity-60'
                )}
                style={{
                  minHeight: '20px',
                  maxHeight: `${28 * maxRows}px`,
                  background: 'transparent',
                  boxShadow: 'none',
                  // --text-primary is a hex value (#E8E8ED dark / #1F1F1F light)
                  // not an "R G B" triple — DO NOT wrap it in rgb(). Apply it
                  // directly so the typed text is always visible across themes.
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Send/Stop — M3 Expressive (task #160): circular 40×40 pill
                buttons anchored right. Press scale 0.98 over 150ms; the
                idle state is the accent primary so the "send" affordance
                reads instantly. */}
            <div className="flex items-center gap-1.5">
              <AnimatePresence>
                {showStopButton && (
                  <motion.button
                    key="stop"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onStopGeneration}
                    aria-label="Stop generation"
                    className={clsx(
                      // Terminal Glass: error-hue gradient control in the same
                      // glass language as the send button — soft radius, glow,
                      // glow-lift hover (.glass-btn-danger). Token-only.
                      'glass-btn glass-btn-danger h-10 w-10'
                    )}
                  >
                    <Square size={14} aria-hidden="true" />
                  </motion.button>
                )}
                {showSendButton && (
                  <motion.button
                    key="send"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onSend}
                    disabled={!hasContent && attachments.length === 0}
                    aria-label={showStopButton ? "Queue message" : "Send message"}
                    title={showStopButton ? "Queue this message for after current response" : "Send message"}
                    className={clsx(
                      // Terminal Glass send CTA (the reference ".go"): the
                      // signal-orange gradient + glow with a glow-lift hover
                      // when there's content, falling back to a frosted neutral
                      // control when empty. Soft radius, token-only.
                      'glass-btn h-10 w-10',
                      (showStopButton || hasContent || attachments.length > 0)
                        ? 'glass-btn-primary'
                        : 'glass-btn-secondary'
                    )}
                  >
                    <ArrowUp size={16} aria-hidden="true" strokeWidth={2.5} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Subtle Divider Line - Gemini style */}
          <div
            className="mx-4 h-px"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-fg) 10%, transparent)',
              opacity: 0.3
            }}
          />

          {/* Integrated Toolbar - Inside the same container */}
          <div className="px-4 py-2">
            <ChatInputToolbar
              availableMcpFunctions={availableMcpFunctions}
              enabledTools={enabledTools}
              onToggleTool={onToggleTool}
              onToggleBackgroundJobs={onToggleBackgroundJobs}
              onToggleWorkflows={onToggleWorkflows}
              availableModels={availableModels}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              isAdmin={isAdmin}
              fileInputRef={fileInputRef}
              disabled={disabled}
              tokenCount={tokenCount}
              onToggleTokenUsage={onToggleTokenUsage}
              showMCPIndicators={showMCPIndicators}
              onToggleMCPIndicators={onToggleMCPIndicators}
              showModelBadges={showModelBadges}
              onToggleModelBadges={onToggleModelBadges}
              isStreaming={isStreaming}
              isThinkingEnabled={isThinkingEnabled}
              onThinkingToggle={onThinkingToggle}
              isMultiModelEnabled={isMultiModelEnabled}
              onToggleToolInspector={onToggleToolInspector}
              showToolInspector={showToolInspector}
            />
          </div>
        </div>

        {/* Tool Approval Popup moved to ChatMessages for inline display */}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          accept=".txt,.pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.xml,.md,.py,.js,.ts,.jsx,.tsx,.java,.cpp,.c,.h,.hpp,.cs,.rb,.go,.rs,.php,.swift,.kt,.r,.m,.sql,.png,.jpg,.jpeg,.gif,.webp,.svg"
        />
        {/* Screen reader hint for chat input */}
        <span id="chat-input-hint" className="sr-only">
          Press Enter to send, Shift+Enter for new line. Use the toolbar below for attachments and model selection.
        </span>
      </div>

    </div>
  );
};

export default ChatInputBar;