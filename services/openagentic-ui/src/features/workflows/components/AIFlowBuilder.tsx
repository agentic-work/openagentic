/**
 * AIFlowBuilder - Slide-out panel for AI-assisted workflow generation
 * Users describe workflows in natural language, AI generates node/edge definitions
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Sparkles, Trash2, Loader2, Workflow, AlertCircle, Zap, Eye, Beaker } from '@/shared/icons';
import { useAIFlowChat, AIFlowMessage, type CanvasContext, type ExecutionContext, type WorkflowPatch } from '../hooks/useAIFlowChat';
import type { WorkflowDefinition } from '../types/workflow.types';

interface AIFlowBuilderProps {
  onClose: () => void;
  onWorkflowGenerated: (definition: WorkflowDefinition) => void;
  onWorkflowPatch?: (patches: WorkflowPatch[]) => void;
  canvasState?: CanvasContext | null;
  executionData?: ExecutionContext | null;
}

export const AIFlowBuilder: React.FC<AIFlowBuilderProps> = ({
  onClose,
  onWorkflowGenerated,
  onWorkflowPatch,
  canvasState,
  executionData,
}) => {
  const { messages, isGenerating, sendMessage, clearMessages, stopGeneration, setCanvasContext } = useAIFlowChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Push canvas/execution context to the hook whenever it changes
  useEffect(() => {
    setCanvasContext(canvasState || null, executionData || null);
  }, [canvasState, executionData, setCanvasContext]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async (overrideMsg?: string) => {
    const msg = (overrideMsg || input).trim();
    if (!msg || isGenerating) return;
    if (!overrideMsg) setInput('');
    const result = await sendMessage(msg);
    // Auto-apply workflow to canvas when generated
    if (result) {
      onWorkflowGenerated(result);
    }
  };

  // Check latest message for patches and auto-apply
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.patches && onWorkflowPatch) {
      onWorkflowPatch(last.patches);
    }
  }, [messages, onWorkflowPatch]);

  const hasCanvas = canvasState && canvasState.nodes.length > 0;
  const hasFailedExecution = executionData?.status === 'failed';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApply = (definition: WorkflowDefinition) => {
    onWorkflowGenerated(definition);
  };

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="glass absolute right-0 top-0 bottom-0 w-[380px] flex flex-col z-30 border-l"
      style={{
        borderRadius: 0,
        borderColor: 'var(--glass-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Flows Agent
          </span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-1.5 rounded transition-colors hover:bg-[var(--ctl-surf-hover)]"
              title="Clear conversation"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded transition-colors hover:bg-[var(--ctl-surf-hover)]"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      {hasCanvas && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <button
            onClick={() => handleSend('What does this workflow do? Explain each node and how data flows between them.')}
            disabled={isGenerating}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--color-text-secondary)', background: 'var(--ctl-surf)' }}
          >
            <Eye className="w-3 h-3" /> Explain
          </button>
          {hasFailedExecution && (
            <>
              <button
                onClick={() => handleSend('The last execution failed. For EACH failed node:\n1. Identify the root cause from the error message\n2. Apply the fix using a ```patch block\n3. If the node type is fundamentally wrong (e.g. mcp_tool referencing unavailable tool), replace it with an openagentic_llm node that achieves the same goal.\nFix ALL errors, not just the first one.')}
                disabled={isGenerating}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:border-[color-mix(in_srgb,var(--color-error)_60%,transparent)]"
                style={{ borderColor: 'color-mix(in srgb, var(--color-error) 30%, transparent)', color: 'var(--color-error)', background: 'color-mix(in srgb, var(--color-error) 5%, transparent)' }}
              >
                <AlertCircle className="w-3 h-3" /> Fix Errors
              </button>
              <button
                onClick={() => handleSend('The last execution failed. Diagnose every failed node, output a ```patch block that fixes ALL errors, then I will re-execute. Be surgical — only change what is broken. Common fixes: remove invalid modelOverride, fix mcp_tool arguments to match tool schema, fix condition expressions to use `input.field` instead of template syntax, replace unavailable MCP tools with openagentic_llm equivalents.')}
                disabled={isGenerating}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:border-[color-mix(in_srgb,var(--color-warning)_60%,transparent)]"
                style={{ borderColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)', color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 5%, transparent)' }}
              >
                <Zap className="w-3 h-3" /> Fix & Run
              </button>
            </>
          )}
          <button
            onClick={() => handleSend('Analyze this workflow and suggest optimizations: reduce redundant nodes, improve data flow, add error handling, and suggest better MCP tools where applicable.')}
            disabled={isGenerating}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--color-text-secondary)', background: 'var(--ctl-surf)' }}
          >
            <Zap className="w-3 h-3" /> Optimize
          </button>
          <button
            onClick={() => handleSend('Generate test cases for this workflow. For each node, suggest sample inputs and expected outputs that would validate correct behavior.')}
            disabled={isGenerating}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
            style={{ borderColor: 'var(--glass-border)', color: 'var(--color-text-secondary)', background: 'var(--ctl-surf)' }}
          >
            <Beaker className="w-3 h-3" /> Gen Tests
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 wf-scrollbar">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Workflow className="w-10 h-10 mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Describe your workflow
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
              Tell me what you want to automate and I'll generate a multi-agent workflow for you.
            </p>
            <div className="mt-4 space-y-2 w-full">
              {[
                'Research a topic using web search, analyze findings, and produce a summary report',
                'Build a multi-agent code review pipeline with security scanning',
                'Create a scheduled data pipeline that queries, transforms, and alerts on anomalies',
                'Set up a document classification workflow with human approval for sensitive items',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setInput(suggestion)}
                  className="w-full text-left text-[11px] px-3 py-2 rounded-lg border transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
                  style={{
                    borderColor: 'var(--glass-border)',
                    color: 'var(--color-text-secondary)',
                    background: 'var(--ctl-surf)',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} onApply={handleApply} onApplyPatch={onWorkflowPatch} />
        ))}

        {isGenerating && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Generating workflow...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t px-3 py-3 flex-shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
        <div
          className="flex items-end gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--glass-border)', background: 'var(--ctl-surf)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your workflow..."
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none"
            style={{
              color: 'var(--color-text)',
              maxHeight: 120,
              minHeight: 20,
            }}
          />
          {isGenerating ? (
            <button
              onClick={stopGeneration}
              className="p-1.5 rounded-md transition-colors flex-shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: 'var(--color-error)' }}
              title="Stop generating"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-1.5 rounded-md transition-colors flex-shrink-0"
              style={{
                backgroundColor: input.trim() ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
                color: input.trim() ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                opacity: input.trim() ? 1 : 0.5,
              }}
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/** Individual message bubble */
const MessageBubble: React.FC<{
  message: AIFlowMessage;
  onApply: (def: WorkflowDefinition) => void;
  onApplyPatch?: (patches: WorkflowPatch[]) => void;
}> = ({ message, onApply, onApplyPatch }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${isUser ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
        style={{
          background: isUser ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--ctl-surf)',
          color: 'var(--color-text)',
          border: isUser ? 'none' : '1px solid var(--glass-border)',
        }}
      >
        {/* Render message content, hiding raw workflow/patch JSON for cleaner display */}
        <div className="whitespace-pre-wrap">
          {message.content.replace(/```(?:workflow|patch)[\s\S]*?```/g, '').trim() || message.content}
        </div>

        {/* Apply to Canvas button */}
        {message.workflowDefinition && (
          <motion.button
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onApply(message.workflowDefinition!)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              color: 'var(--color-accent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
            }}
          >
            <Sparkles className="w-3 h-3" />
            Apply to Canvas ({message.workflowDefinition.nodes.length} nodes)
          </motion.button>
        )}

        {/* Apply Patch button */}
        {message.patches && message.patches.length > 0 && onApplyPatch && (
          <motion.button
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onApplyPatch(message.patches!)}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
              color: 'var(--color-warning)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
            }}
          >
            <Zap className="w-3 h-3" />
            Apply Patch ({message.patches.length} node{message.patches.length > 1 ? 's' : ''})
          </motion.button>
        )}
      </div>
    </div>
  );
};
