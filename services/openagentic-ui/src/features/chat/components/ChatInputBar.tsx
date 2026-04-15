/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  // OpenAgenticCode toggle
  isCodeMode?: boolean;
  onCodeModeToggle?: () => void;
  canUseAwcode?: boolean;
  // Thinking mode toggle
  isThinkingEnabled?: boolean;
  onThinkingToggle?: () => void;
  modelSupportsThinking?: boolean;
  // Multi-model mode (disables model selector when enabled)
  isMultiModelEnabled?: boolean;
  // OAT / Tool Synthesis
  synthEnabled?: boolean;
  synthPendingCount?: number;
  onSynthToggle?: () => void;
  onSynthClick?: () => void;
  // Admin Tool Inspector
  onToggleToolInspector?: () => void;
  showToolInspector?: boolean;
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
  // OpenAgenticCode toggle
  isCodeMode = false,
  onCodeModeToggle,
  canUseAwcode = false,
  // Thinking mode toggle
  isThinkingEnabled = true,
  onThinkingToggle,
  // Multi-model mode
  isMultiModelEnabled = false,
  // OAT / Tool Synthesis
  synthEnabled = false,
  synthPendingCount = 0,
  onSynthToggle,
  onSynthClick,
  // Admin Tool Inspector
  onToggleToolInspector,
  showToolInspector = false,
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
      // Allow sending during streaming to queue messages (like code mode)
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
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto mb-4">
        {/* Floating MCP Calls Display - REMOVED: Duplicate of VerboseMCPDisplay in ChatMessages */}
        {/* VerboseMCPDisplay in ChatMessages already shows MCP execution details beautifully */}
        {/* <AnimatePresence>
          {activeMcpCalls && activeMcpCalls.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mb-4 flex justify-center w-full"
            >
              <div className="w-full">
                <MCPCallsDisplay calls={activeMcpCalls} />
              </div>
            </motion.div>
          )}
        </AnimatePresence> */}

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


        {/* Unified Input Container - Gemini-style design with integrated toolbar */}
        <div
          className={clsx(
            'glass-surface relative',
            'transition-all duration-200',
            isDragging && 'border-2 border-theme-accent/30'
          )}
          style={{
            border: isDragging ? undefined : '1px solid var(--color-border)',
            borderRadius: '24px',
          }}
        >
          {/* Drag Overlay */}
          <AnimatePresence>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-blue-500/10 rounded-2xl z-10 border-2 border-dashed border-blue-500"
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
                className="absolute top-0 left-0 right-0 -translate-y-full mb-2 p-3 rounded-lg shadow-lg border z-20 bg-theme-bg-card/95 border-theme-border-primary"
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
                              className="bg-blue-500 h-1.5 rounded-full"
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

          {/* Textarea area - Auto-expanding input field */}
          <div className="flex items-center gap-2 px-4 py-3 relative">
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
                  'placeholder-gray-500',
                  'overflow-y-auto',
                  'text-theme-text-primary',
                  disabled && 'cursor-not-allowed opacity-60'
                )}
                style={{
                  minHeight: '20px',
                  maxHeight: `${28 * maxRows}px`,
                  background: 'transparent',
                  boxShadow: 'none',
                  color: 'rgb(var(--text-primary))',
                }}
              />
            </div>

            {/* Send/Stop Buttons - Both visible during streaming to allow queuing */}
            <div className="flex items-center gap-1.5">
              <AnimatePresence>
                {/* Stop button - shown during streaming/loading */}
                {showStopButton && (
                  <motion.button
                    key="stop"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onStopGeneration}
                    aria-label="Stop generation"
                    className={clsx(
                      'p-2 rounded-lg transition-colors',
                      'bg-red-600 hover:bg-red-700 text-white'
                    )}
                  >
                    <Square size={16} aria-hidden="true" />
                  </motion.button>
                )}
                {/* Send button - shown when there's content (even during streaming) */}
                {showSendButton && (
                  <motion.button
                    key="send"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onSend}
                    disabled={!hasContent && attachments.length === 0}
                    aria-label={showStopButton ? "Queue message" : "Send message"}
                    title={showStopButton ? "Queue this message for after current response" : "Send message"}
                    className={clsx(
                      'p-2 rounded-lg transition-colors',
                      (!hasContent && attachments.length === 0) && 'opacity-50 cursor-not-allowed',
                      showStopButton ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-600 hover:bg-gray-500 text-white'
                    )}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Subtle Divider Line - Gemini style */}
          <div
            className="mx-4 h-px"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
              isCodeMode={isCodeMode}
              onCodeModeToggle={onCodeModeToggle}
              canUseAwcode={canUseAwcode}
              isStreaming={isStreaming}
              isThinkingEnabled={isThinkingEnabled}
              onThinkingToggle={onThinkingToggle}
              isMultiModelEnabled={isMultiModelEnabled}
              synthEnabled={synthEnabled}
              synthPendingCount={synthPendingCount}
              onSynthToggle={onSynthToggle}
              onSynthClick={onSynthClick}
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