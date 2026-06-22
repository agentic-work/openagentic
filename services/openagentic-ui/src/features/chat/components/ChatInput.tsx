/**
 * Chat Input Component
 * Advanced chat input with multi-line support, file attachments, and voice input
 * Features: Auto-resize textarea, file drag-and-drop, paste image support, markdown preview
 * Handles: Message composition, file uploads, keyboard shortcuts, streaming status
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Mic, ArrowUp, Square, Settings, Activity, Info } from '@/shared/icons';
import Tooltip from './Tooltip';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';
import ToolsPopup from './ToolsPopup';
import LiveUsagePanel from './LiveUsagePanel';
// Model selector removed - backend handles model selection

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: string[];
  pricing: {
    prompt: number;
    completion: number;
    currency: string;
  };
}

interface ChatInputProps {
  theme?: 'light' | 'dark';
  inputMessage?: string;
  isLoading?: boolean;
  streamingContent?: string;
  isAuthenticated?: boolean;
  showSettings?: boolean;
  selectedFiles?: File[];
  fileInputRef?: React.RefObject<HTMLInputElement>;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  messageHistory?: string[];
  onInputChange?: (message: string) => void;
  onSend?: () => void;
  onSendMessage?: () => void;
  onStopGeneration?: () => void;
  onToggleSettings?: () => void;
  onFileSelect?: (files: File[]) => void;
  // Toolbar props
  showTokenUsage?: boolean;
  onToggleTokenUsage?: () => void;
  // CoT toggle
  showCoT?: boolean;
  onToggleCoT?: () => void;
  // Model selection props
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  // WebSocket status
  wsConnected?: boolean;
  // MCP Tools props
  availableMCPFunctions?: any;
  enabledTools?: Set<string>;
  onToggleTool?: (toolName: string) => void;
  showMCPTools?: boolean;
  onToggleMCPTools?: () => void;
  // Audio TTS props
  textToSpeechEnabled?: boolean;
  onToggleTextToSpeech?: () => void;
  // MCP Indicators display toggle
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  // Error handling
  onError?: (error: string) => void;
  // Settings button ref
  settingsButtonRef?: React.RefObject<HTMLButtonElement>;
}

const ChatInput: React.FC<ChatInputProps> = ({
  theme = 'dark',
  inputMessage = '',
  isLoading = false,
  streamingContent = '',
  isAuthenticated = true,
  showSettings = false,
  selectedFiles = [],
  fileInputRef,
  inputRef,
  messageHistory = [],
  onInputChange,
  onSend,
  onSendMessage,
  onStopGeneration,
  onToggleSettings,
  onFileSelect,
  showTokenUsage = false,
  onToggleTokenUsage,
  showCoT = false,
  onToggleCoT,
  selectedModel = '',
  onModelChange,
  wsConnected = false,
  availableMCPFunctions,
  enabledTools,
  onToggleTool,
  showMCPTools = false,
  onToggleMCPTools,
  textToSpeechEnabled = false,
  onToggleTextToSpeech,
  showMCPIndicators = true,
  onToggleMCPIndicators,
  onError,
  settingsButtonRef
}) => {
  const [showToolsPopup, setShowToolsPopup] = useState(false);
  const [showLiveUsage, setShowLiveUsage] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { user: authUser } = useAuth();
  const userId = authUser?.id;
  const handleSend = onSendMessage || onSend;

  // Reactive shrink: whenever the input goes empty (sent, cleared, draft restored
  // empty) snap the textarea back to its baseline 56px. The onInput handler only
  // grows it; this is the matching shrink path so a long paste-then-send doesn't
  // leave the input bar permanently inflated.
  useEffect(() => {
    if (!inputMessage && inputRef?.current instanceof HTMLTextAreaElement) {
      inputRef.current.style.height = '56px';
    }
  }, [inputMessage, inputRef]);
  const draftKey = 'openagentic-chat-draft';
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { getAccessToken, user } = useAuth();
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  
  // Check if user is admin
  const isAdmin = user?.groups?.includes('OpenAgenticAdmins') || user?.is_admin || false;
  
  // Load available models — task #4 (registry SoT): source = Registry endpoint
  const loadAvailableModels = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const token = await getAccessToken(['User.Read']);
      const { mapRegistryRowToToolbarModel } = await import('../hooks/useRegistryModels');
      const response = await fetch(apiEndpoint('/admin/llm-providers/registry?enabledOnly=true'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const registryRows = await response.json();
        const mapped: ModelInfo[] = Array.isArray(registryRows)
          ? registryRows.map((r: any) => mapRegistryRowToToolbarModel(r) as ModelInfo)
          : [];
        setAvailableModels(mapped);

        // Set default model if none selected and we have models
        if (!selectedModel && mapped.length > 0) {
          onModelChange?.(mapped[0].id);
        }
      } else {
        console.error('Failed to load models:', response.statusText);
      }
    } catch (error) {
      console.error('Error loading models:', error);
    } finally {
      setModelsLoading(false);
    }
  }, [isAuthenticated, getAccessToken, selectedModel, onModelChange]);
  
  // Load models on mount
  useEffect(() => {
    loadAvailableModels();
  }, [loadAvailableModels]);
  
  // Load draft on mount
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const savedDraft = sessionStorage.getItem(draftKey);
    if (savedDraft && !inputMessage) {
      onInputChange?.(savedDraft);
    }
  }, [isAuthenticated]);
  
  // Auto-save draft with debouncing
  useEffect(() => {
    if (!isAuthenticated) return;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Save after 500ms of no typing
    saveTimeoutRef.current = setTimeout(() => {
      if (inputMessage.trim()) {
        sessionStorage.setItem(draftKey, inputMessage);
      } else {
        sessionStorage.removeItem(draftKey);
      }
    }, 500);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [inputMessage, isAuthenticated]);
  
  // Clear draft after sending. Also reset the textarea height back to its base
  // so a long paste-then-send doesn't leave the input bar permanently inflated.
  // The onInput grow handler only knows how to expand; we shrink here on send.
  const handleSendWithDraftClear = useCallback(() => {
    handleSend?.();
    localStorage.removeItem(draftKey);
    // Reset textarea to its baseline height (matches the inline style minHeight).
    // Defer to next tick so React clears the value first, then we measure auto.
    requestAnimationFrame(() => {
      const ta = inputRef?.current;
      if (ta && ta instanceof HTMLTextAreaElement) {
        ta.style.height = 'auto';
        ta.style.height = '56px';
      }
    });
  }, [handleSend, draftKey, inputRef]);

  // Handle drag and drop
  const [isDragging, setIsDragging] = useState(false);
  
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the container
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Filter for supported file types (images and documents)
      const supportedFiles = files.filter(file => 
        file.type.startsWith('image/') || 
        file.type === 'application/pdf' ||
        file.type.includes('text') ||
        file.type.includes('document')
      );
      
      if (supportedFiles.length > 0) {
        onFileSelect?.([...selectedFiles, ...supportedFiles]);
      } else {
        onError?.('Unsupported file type. Please upload images, PDFs, or text documents.');
      }
    }
  }, [selectedFiles, onFileSelect, onError]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      
      if (!file) return;
      
      // Add the pasted image to selected files - let backend determine model capabilities
      onFileSelect?.([...selectedFiles, file]);
    }
  }, [selectedFiles, onFileSelect]);
  return (
    <div className="fixed bottom-0 left-0 right-0 pt-4 pb-6 px-6 z-50">
      {/* Solid backdrop */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-background)] via-[var(--color-background)]/80 to-transparent pointer-events-none" />
      {!isAuthenticated && (
        <div
          className="mb-3 px-4 py-2 rounded-lg text-center text-sm border"
          style={{
            color: 'var(--color-warn)',
            background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-warn) 20%, transparent)',
          }}
        >
          Please login to start using OpenAgentic Chat
        </div>
      )}
      {!isAuthenticated ? (
        <div className="max-w-3xl mx-auto">
          <div
            className="w-full px-6 py-4 rounded-2xl text-center border"
            style={{
              color: 'var(--color-warn)',
              background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)',
              borderColor: 'color-mix(in srgb, var(--color-warn) 20%, transparent)',
            }}
          >
            Please sign in to start chatting
          </div>
        </div>
      ) : (
        <div
          className="max-w-3xl mx-auto relative"
          role="button"
          tabIndex={0}
          aria-label="Message composer with file drop zone. Press Enter to choose files."
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              fileInputRef?.current?.click();
            }
          }}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[24px] bg-accent-primary/20 border-2 border-dashed border-accent-primary">
              <div className="text-center">
                <Plus className="w-12 h-12 text-accent-primary mx-auto mb-2" />
                <p className="text-accent-primary font-medium">Drop files here</p>
                <p className="text-accent-primary/70 text-sm">Images, PDFs, and text documents supported</p>
              </div>
            </div>
          )}
          
          {/* Main input container - Floating input with glassmorphism */}
          <div className="relative group">
            <div className="flex items-end gap-2 rounded-[24px] px-4 py-3 transition-all glass hover:shadow-lg hover:scale-[1.01]" style={{ borderRadius: '24px' }}>
              {/* Plus button inside input area */}
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => fileInputRef.current?.click()}
                className="p-2 rounded-full transition-all mb-1 hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] text-text-secondary hover:text-text-primary"
              >
                <Plus size={20} />
                {selectedFiles.length > 0 && (
                  <span
                  className="absolute -top-1 -right-1 bg-accent-primary text-xs rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
                  style={{ color: 'var(--color-text)' }}>
                    {selectedFiles.length}
                  </span>
                )}
              </motion.button>
              
              {/* MCP Tools button inside input area */}
              <motion.button
                ref={toolsButtonRef}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowToolsPopup(!showToolsPopup)}
                className={`p-2 rounded-full transition-all mb-1 ${
                  showToolsPopup
                    ? 'bg-accent-primary/20 text-accent-primary hover:text-accent-primary/80'
                    : 'hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] text-text-secondary hover:text-text-primary'
                }`}
              >
                <Settings size={20} />
              </motion.button>

              {/* Live Token Usage button inside input area */}
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowLiveUsage(!showLiveUsage)}
                className={`p-2 rounded-full transition-all mb-1 ${
                  showLiveUsage
                    ? ''
                    : 'hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] text-text-secondary hover:text-text-primary'
                }`}
                style={showLiveUsage ? { background: 'color-mix(in srgb, var(--color-ok) 20%, transparent)', color: 'var(--color-ok)' } : undefined}
              >
                <Activity size={20} />
              </motion.button>
              
              {/* Invisible textarea - no border, no background */}
              <textarea
                ref={inputRef}
                data-chat-input
                value={inputMessage}
                onChange={(e) => {
                  onInputChange?.(e.target.value);
                  // Reset history index when user types
                  setHistoryIndex(-1);
                }}
                onKeyDown={(e) => {
                  // Up arrow - cycle through previous messages
                  if (e.key === 'ArrowUp' && !inputMessage && messageHistory.length > 0) {
                    e.preventDefault();
                    const newIndex = historyIndex + 1;
                    if (newIndex < messageHistory.length) {
                      setHistoryIndex(newIndex);
                      onInputChange?.(messageHistory[messageHistory.length - 1 - newIndex]);
                    }
                  }
                  // Down arrow - cycle back through history
                  if (e.key === 'ArrowDown' && historyIndex >= 0) {
                    e.preventDefault();
                    const newIndex = historyIndex - 1;
                    if (newIndex >= 0) {
                      setHistoryIndex(newIndex);
                      onInputChange?.(messageHistory[messageHistory.length - 1 - newIndex]);
                    } else {
                      setHistoryIndex(-1);
                      onInputChange?.('');
                    }
                  }
                  // Cmd+Enter or Ctrl+Enter to send
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSendWithDraftClear();
                    setHistoryIndex(-1);
                  }
                  // Regular Enter for new line (default behavior)
                }}
                onPaste={handlePaste}
                placeholder={!isAuthenticated ? "Please login to start chatting..." : "Message OpenAgentic... (Cmd+Enter to send)"}
                disabled={isLoading || !isAuthenticated}
                rows={1}
                
                className="flex-1 bg-transparent outline-none resize-none text-base leading-relaxed px-2 placeholder-text-secondary"
                style={{
                  color: 'var(--color-text)',
                  minHeight: '56px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  lineHeight: '1.6',
                  letterSpacing: '-0.01em'
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
              />
              
              {/* Right side - Only send button */}
              <div className="flex items-center gap-2 mb-1">
                {/* Send/Stop button */}
                {isLoading || streamingContent ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onStopGeneration}
                    className="p-2.5 rounded-full transition-colors"
                    style={{ background: 'var(--color-err)', color: 'var(--color-on-accent)' }}
                  >
                    <Square size={16} />
                  </motion.button>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSendWithDraftClear}
                    disabled={!inputMessage.trim()}
                    className={`p-2.5 rounded-full transition-all ${
                      !inputMessage.trim() ? 'cursor-not-allowed' : 'active:scale-[0.98]'
                    }`}
                    style={
                      !inputMessage.trim()
                        ? { background: 'color-mix(in srgb, var(--color-fg) 5%, transparent)', color: 'var(--color-fg-subtle)' }
                        : { background: 'var(--color-accent)', color: 'var(--color-on-accent)' }
                    }
                  >
                    <ArrowUp size={16} />
                  </motion.button>
                )}
              </div>
            </div>
          </div>
          
          {/* Modern Unified Toolbar - Consistent Height Across All Tabs */}
          <div className="flex items-center justify-between mt-4 px-2 h-12 min-h-[3rem]">
            {/* Left Side - Model Selection and Assistant Display */}
            <div className="flex items-center gap-3 h-full">
              {/* Assistant/Agent Indicator */}
              <div
                data-testid="assistant-name"
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm h-full border bg-accent-primary/10 text-accent-primary border-accent-primary/20"
              >
                <span className="font-medium">AI Assistant:</span>
                <span className="font-semibold">
                  {selectedModel && availableModels.find(m => m.id === selectedModel)?.name || availableModels[0]?.name || 'Loading...'}
                </span>
                {/* Assistant Info Button */}
                <Tooltip content={`Context window: ${availableModels.find(m => m.id === selectedModel)?.contextWindow || '128K'} tokens • Max output: ${availableModels.find(m => m.id === selectedModel)?.maxOutputTokens || '4K'} tokens • Capabilities: ${availableModels.find(m => m.id === selectedModel)?.capabilities?.join(', ') || 'text, vision, function-calling'}`}>
                  <button
                    data-testid="assistant-info"
                    aria-label="Assistant capabilities"
                    className="p-1 rounded-lg transition-colors hover:bg-accent-primary/20 text-accent-primary"
                  >
                    <Info size={14} />
                  </button>
                </Tooltip>
              </div>

              <div className="relative h-full">
                <select
                  value={selectedModel}
                  onChange={(e) => onModelChange?.(e.target.value)}
                  disabled={modelsLoading}
                  data-testid="assistant-selector"
                  aria-label="Select assistant model"
                  className={`h-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer border bg-bg-tertiary hover:bg-bg-hover text-text-secondary border-border hover:border-border-hover focus:outline-none focus:ring-2 focus:ring-accent-primary/30 ${
                    modelsLoading ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  style={{
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    appearance: 'none',
                    // theme-allow: a data-URI SVG cannot read CSS custom
                    // properties, so the chevron stroke must be inlined; this
                    // muted-grey reads correctly on both paper and terminal bg.
                    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 1rem center',
                    backgroundSize: '1rem',
                    paddingRight: '2.5rem'
                  }}
                >
                  {modelsLoading ? (
                    <option value="">Loading models...</option>
                  ) : availableModels.length > 0 ? (
                    availableModels.map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        className="bg-bg-secondary text-text-secondary"
                      >
                        {model.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No models available</option>
                  )}
                </select>
              </div>

              {/* Connection Status */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm h-full border"
                style={{
                  color: wsConnected ? 'var(--color-ok)' : 'var(--color-err)',
                  background: `color-mix(in srgb, ${wsConnected ? 'var(--color-ok)' : 'var(--color-err)'} 10%, transparent)`,
                  borderColor: `color-mix(in srgb, ${wsConnected ? 'var(--color-ok)' : 'var(--color-err)'} 20%, transparent)`,
                }}
              >
                <div className="w-2 h-2 rounded-full" style={{ background: wsConnected ? 'var(--color-ok)' : 'var(--color-err)' }} />
                <span className="font-medium">{wsConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
            
            {/* Center - Action Buttons with Fixed Height */}
            <div className="flex items-center gap-2 h-full">
              
              {/* Live Token Usage - Now with Real Data Connection */}
              <Tooltip content={showLiveUsage ? "Hide token usage analytics" : "Show live token usage analytics"}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowLiveUsage(!showLiveUsage)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border h-full ${
                    showLiveUsage
                      ? 'bg-accent-primary/20 text-accent-primary border-accent-primary/30 shadow-[0_0_15px_var(--user-accent-soft)] ring-1 ring-accent-primary/40'
                      : 'bg-bg-tertiary hover:bg-bg-hover text-text-muted hover:text-text-secondary border-border hover:border-border-hover'
                  }`}
                >
                  <Activity size={16} />
                  <span>Analytics</span>
                  {showLiveUsage && (
                    <div className="w-2 h-2 rounded-full animate-pulse bg-accent-primary" />
                  )}
                </motion.button>
              </Tooltip>
            </div>
            
            {/* Right Side - Additional Controls */}
            <div className="flex items-center gap-2 h-full">
              {/* Future: Additional controls can go here */}
              
              {/* Inline Settings Panel */}
              <AnimatePresence>
                {showToolsPopup && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full right-0 mt-2 w-80 rounded-2xl shadow-2xl border z-50 bg-bg-secondary border-border"
                  >
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-text-primary">
                          MCP Tools
                        </h3>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setShowToolsPopup(false)}
                          className="p-1 rounded-lg transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        >
                          ✕
                        </motion.button>
                      </div>

                      <div className="space-y-4">
                        {/* REAL MCP Inspector embedded */}
                        <div
                        className="h-[400px] w-full overflow-hidden rounded-lg border border-border-hover">
                          <iframe
                            src={`/api/inspector/ui?userId=${encodeURIComponent(userId || '')}&admin=true`}
                            className="w-full h-full border-0"
                            title="MCP Inspector"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-text-secondary">
                            Token Usage Display
                          </span>
                          <motion.button
                            aria-label="Token Usage Display"
                            whileTap={{ scale: 0.95 }}
                            onClick={onToggleTokenUsage}
                            className={`relative w-11 h-6 rounded-full transition-colors ${
                              showTokenUsage ? 'bg-accent-primary' : 'bg-bg-tertiary'
                            }`}
                          >
                            <motion.div
                              animate={{ x: showTokenUsage ? 20 : 2 }}
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                              className="absolute top-1 w-4 h-4 rounded-full shadow bg-surface"
                            />
                          </motion.button>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-text-secondary">
                            Chain of Thought
                          </span>
                          <motion.button
                            aria-label="Chain of Thought"
                            whileTap={{ scale: 0.95 }}
                            onClick={onToggleCoT}
                            className={`relative w-11 h-6 rounded-full transition-colors ${
                              showCoT ? 'bg-accent-primary' : 'bg-bg-tertiary'
                            }`}
                          >
                            <motion.div
                              animate={{ x: showCoT ? 20 : 2 }}
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                              className="absolute top-1 w-4 h-4 rounded-full shadow bg-surface"
                            />
                          </motion.button>
                        </div>

                        {/* MCP Tool Execution Indicators Toggle - Admin only */}
                        {user?.is_admin && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-text-secondary">
                              Tool Execution Indicators
                            </span>
                            <motion.button
                              aria-label="Tool Execution Indicators"
                              whileTap={{ scale: 0.95 }}
                              onClick={onToggleMCPIndicators}
                              className={`relative w-11 h-6 rounded-full transition-colors ${
                                showMCPIndicators ? '' : 'bg-bg-tertiary'
                              }`}
                              style={showMCPIndicators ? { background: 'var(--color-ok)' } : undefined}
                            >
                              <motion.div
                                animate={{ x: showMCPIndicators ? 20 : 2 }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                className="absolute top-1 w-4 h-4 rounded-full shadow bg-surface"
                              />
                            </motion.button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              onFileSelect?.([...selectedFiles, ...files]);
              e.target.value = '';
            }}
            className="hidden"
            accept=".txt,.pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.xml,.md,.py,.js,.ts,.jsx,.tsx,.java,.cpp,.c,.h,.hpp,.cs,.rb,.go,.rs,.php,.swift,.kt,.r,.m,.sql,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.tiff"
          />
          
        </div>
      )}
      
      {/* Live Usage Panel */}
      <LiveUsagePanel
        isOpen={showLiveUsage}
        onClose={() => setShowLiveUsage(false)}
        theme={theme}
      />
    </div>
  );
};

export default ChatInput;