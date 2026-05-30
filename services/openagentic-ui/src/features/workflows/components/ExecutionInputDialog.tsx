/**
 * ExecutionInputDialog — Modal shown before workflow execution
 * Allows user to provide trigger inputs instead of always sending {}
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X, RotateCcw, ChevronDown } from '@/shared/icons';

interface TriggerField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
}

interface ExecutionInputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (input: Record<string, any>) => void;
  workflowName: string;
  triggerNode?: {
    id: string;
    type: string;
    data: Record<string, any>;
  } | null;
  lastInput?: Record<string, any>;
  isExecuting?: boolean;
}

/** Parse trigger node config to determine expected input fields */
function parseTriggerFields(triggerNode?: { data: Record<string, any> } | null): TriggerField[] {
  if (!triggerNode?.data) return [];
  const { triggerConfig, inputSchema } = triggerNode.data;

  // If node has explicit inputSchema, use it
  if (inputSchema && typeof inputSchema === 'object') {
    const properties = inputSchema.properties || {};
    const required = inputSchema.required || [];
    return Object.entries(properties).map(([key, schema]: [string, any]) => ({
      key,
      type: schema.type === 'number' || schema.type === 'integer' ? 'number'
        : schema.type === 'boolean' ? 'boolean'
        : schema.type === 'object' || schema.type === 'array' ? 'json'
        : 'string',
      label: schema.title || key,
      description: schema.description,
      required: required.includes(key),
      defaultValue: schema.default,
    }));
  }

  // For webhook triggers, expect a generic message/body field
  if (triggerConfig?.type === 'webhook' || triggerNode.data.triggerType === 'webhook') {
    return [{ key: 'body', type: 'json', label: 'Request Body', description: 'JSON body sent to webhook' }];
  }

  // Default: single "message" input for manual triggers
  return [{ key: 'message', type: 'string', label: 'Input Message', description: 'Message or query to process' }];
}

export const ExecutionInputDialog: React.FC<ExecutionInputDialogProps> = ({
  isOpen, onClose, onExecute, workflowName, triggerNode, lastInput, isExecuting,
}) => {
  const fields = parseTriggerFields(triggerNode);
  const [values, setValues] = useState<Record<string, any>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Initialize with lastInput or defaults
  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, any> = {};
      for (const field of fields) {
        initial[field.key] = lastInput?.[field.key] ?? field.defaultValue ?? '';
      }
      setValues(initial);
      setRawJson(JSON.stringify(lastInput || {}, null, 2));
      setJsonError(null);
      // Focus first input after animation
      setTimeout(() => firstInputRef.current?.focus(), 150);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldChange = useCallback((key: string, value: any) => {
    setValues(prev => {
      const next = { ...prev, [key]: value };
      setRawJson(JSON.stringify(next, null, 2));
      return next;
    });
  }, []);

  const handleRawJsonChange = useCallback((json: string) => {
    setRawJson(json);
    try {
      const parsed = JSON.parse(json);
      setValues(parsed);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  }, []);

  const handleExecute = useCallback(() => {
    // Build final input, stripping empty strings
    const input: Record<string, any> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== '' && v !== undefined && v !== null) {
        input[k] = v;
      }
    }
    onExecute(input);
  }, [values, onExecute]);

  const handleRunWithDefaults = useCallback(() => {
    onExecute({});
  }, [onExecute]);

  // Keyboard: Enter to execute, Escape to close
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExecute();
  }, [onClose, handleExecute]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl shadow-2xl border overflow-hidden"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
            }}
            onKeyDown={handleKeyDown}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Execute Workflow
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                  {workflowName}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-[var(--color-surface)] transition-colors"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {/* Field-based inputs */}
              {!showAdvanced && fields.map((field, idx) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  {field.description && (
                    <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      {field.description}
                    </p>
                  )}
                  {field.type === 'boolean' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!values[field.key]}
                        onChange={e => handleFieldChange(field.key, e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                        {values[field.key] ? 'true' : 'false'}
                      </span>
                    </label>
                  ) : field.type === 'json' ? (
                    <textarea
                      ref={idx === 0 ? firstInputRef as any : undefined}
                      value={typeof values[field.key] === 'string' ? values[field.key] : JSON.stringify(values[field.key] || {}, null, 2)}
                      onChange={e => {
                        try {
                          handleFieldChange(field.key, JSON.parse(e.target.value));
                        } catch {
                          handleFieldChange(field.key, e.target.value);
                        }
                      }}
                      rows={4}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  ) : field.type === 'number' ? (
                    <input
                      ref={idx === 0 ? firstInputRef as any : undefined}
                      type="number"
                      value={values[field.key] || ''}
                      onChange={e => handleFieldChange(field.key, e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  ) : (
                    <textarea
                      ref={idx === 0 ? firstInputRef as any : undefined}
                      value={values[field.key] || ''}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                      rows={field.key === 'message' || field.key === 'query' || field.key === 'prompt' ? 3 : 1}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                      className="w-full px-3 py-2 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-y"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  )}
                </div>
              ))}

              {/* Advanced: raw JSON editor */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-[11px] font-medium"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
                Raw JSON
              </button>
              {showAdvanced && (
                <div>
                  <textarea
                    value={rawJson}
                    onChange={e => handleRawJsonChange(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      borderColor: jsonError ? '#f85149' : 'var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                    spellCheck={false}
                  />
                  {jsonError && (
                    <p className="text-[10px] mt-1 text-red-400">{jsonError}</p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-5 py-3 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={handleRunWithDefaults}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-[var(--color-surface)] disabled:opacity-50"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <RotateCcw className="w-3 h-3" />
                Run with defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isExecuting || !!jsonError}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--user-accent-primary, #2196f3)',
                    color: '#fff',
                  }}
                >
                  <Play className="w-3 h-3" />
                  {isExecuting ? 'Executing...' : 'Execute'}
                </button>
              </div>
            </div>

            {/* Keyboard hint */}
            <div className="px-5 pb-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Press <kbd className="px-1 py-0.5 rounded text-[9px] border" style={{ borderColor: 'var(--color-border)' }}>⌘ Enter</kbd> to execute
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
