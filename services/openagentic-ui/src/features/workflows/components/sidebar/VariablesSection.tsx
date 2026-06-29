/**
 * VariablesSection - CRUD for workflow variables with expression helpers
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  X,
  Copy,
  Check,
  ChevronDown,
} from '@/shared/icons';

interface VariablesSectionProps {
  variables: Record<string, any>;
  onVariablesChange: (vars: Record<string, any>) => void;
}

type VariableType = 'string' | 'number' | 'boolean' | 'json' | 'secret_ref';

interface VariableEntry {
  key: string;
  value: any;
  type: VariableType;
}

const typeColors: Record<VariableType, string> = {
  string: 'var(--color-info)',
  number: 'var(--color-warning)',
  boolean: 'var(--color-success)',
  json: 'var(--color-accent)',
  secret_ref: 'var(--color-error)',
};

const COMMON_EXPRESSIONS = [
  { label: 'Trigger Body Field', expr: '{{trigger.body.field}}' },
  { label: 'Node Output', expr: '{{nodes.nodeId.output}}' },
  { label: 'Env Variable', expr: '{{env.KEY}}' },
  { label: 'Execution ID', expr: '{{execution.id}}' },
  { label: 'Current Timestamp', expr: '{{now}}' },
  { label: 'User ID', expr: '{{user.id}}' },
];

function inferType(value: any): VariableType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && value.startsWith('{{secret:')) return 'secret_ref';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

function parseEntries(vars: Record<string, any>): VariableEntry[] {
  return Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: inferType(value),
  }));
}

function coerceValue(value: string, type: VariableType): any {
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? 0 : n;
    }
    case 'boolean':
      return value === 'true' || value === '1';
    case 'json':
      try { return JSON.parse(value); } catch { return value; }
    default:
      return value;
  }
}

export const VariablesSection: React.FC<VariablesSectionProps> = ({ variables, onVariablesChange }) => {
  const [entries, setEntries] = useState<VariableEntry[]>(() => parseEntries(variables));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showExpressions, setShowExpressions] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Sync entries back to parent
  const commitChanges = useCallback((updated: VariableEntry[]) => {
    const vars: Record<string, any> = {};
    updated.forEach(e => {
      if (e.key.trim()) {
        vars[e.key.trim()] = e.value;
      }
    });
    onVariablesChange(vars);
  }, [onVariablesChange]);

  const handleAddRow = useCallback(() => {
    const newEntries = [...entries, { key: '', value: '', type: 'string' as VariableType }];
    setEntries(newEntries);
    setEditingKey('');
  }, [entries]);

  const handleDeleteRow = useCallback((index: number) => {
    const updated = entries.filter((_, i) => i !== index);
    setEntries(updated);
    commitChanges(updated);
  }, [entries, commitChanges]);

  const handleKeyChange = useCallback((index: number, newKey: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], key: newKey };
    setEntries(updated);
  }, [entries]);

  const handleValueChange = useCallback((index: number, newValue: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], value: coerceValue(newValue, updated[index].type) };
    setEntries(updated);
  }, [entries]);

  const handleTypeChange = useCallback((index: number, newType: VariableType) => {
    const updated = [...entries];
    const strVal = String(updated[index].value);
    updated[index] = { ...updated[index], type: newType, value: coerceValue(strVal, newType) };
    setEntries(updated);
    commitChanges(updated);
  }, [entries, commitChanges]);

  const handleBlur = useCallback(() => {
    setEditingKey(null);
    commitChanges(entries);
  }, [entries, commitChanges]);

  const handleCopyExpression = useCallback((key: string) => {
    navigator.clipboard.writeText(`{{variables.${key}}}`).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  const handleCopyCommonExpression = useCallback((expr: string) => {
    navigator.clipboard.writeText(expr).catch(() => {});
    setCopiedKey(expr);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  return (
    <div className="px-4 py-2 space-y-2">
      {/* Variable rows */}
      {entries.length === 0 ? (
        <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
          No variables defined
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry, index) => (
            <div
              key={index}
              className="flex items-center gap-1 p-1.5 rounded-[var(--ctl-radius-sm)] border"
              style={{ borderColor: 'var(--glass-border)', background: 'var(--ctl-surf)' }}
            >
              {/* Name input */}
              <input
                type="text"
                value={entry.key}
                onChange={e => handleKeyChange(index, e.target.value)}
                onBlur={handleBlur}
                placeholder="name"
                className="flex-1 min-w-0 px-1.5 py-0.5 text-[12px] rounded border-none bg-transparent focus:outline-none"
                style={{ color: 'var(--color-text)' }}
              />

              {/* Type badge */}
              <select
                value={entry.type}
                onChange={e => handleTypeChange(index, e.target.value as VariableType)}
                className="text-[10px] px-1 py-0.5 rounded border-none cursor-pointer focus:outline-none"
                style={{
                  backgroundColor: `${typeColors[entry.type]}20`,
                  color: typeColors[entry.type],
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="json">json</option>
                <option value="secret_ref">secret_ref</option>
              </select>

              {/* Value input */}
              <input
                type={entry.type === 'secret_ref' ? 'password' : 'text'}
                value={entry.type === 'boolean' ? String(entry.value) : (typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value ?? ''))}
                onChange={e => handleValueChange(index, e.target.value)}
                onBlur={handleBlur}
                placeholder="value"
                className="flex-1 min-w-0 px-1.5 py-0.5 text-[12px] rounded border-none bg-transparent focus:outline-none"
                style={{ color: 'var(--color-text)' }}
              />

              {/* Copy expression */}
              {entry.key.trim() && (
                <button
                  onClick={() => handleCopyExpression(entry.key)}
                  className="p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                  title={`Copy {{variables.${entry.key}}}`}
                >
                  {copiedKey === entry.key ? (
                    <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => handleDeleteRow(index)}
                className="p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
                style={{ color: 'var(--color-text-tertiary, #999)' }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add row button */}
      <button
        onClick={handleAddRow}
        className="flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80"
        style={{ color: 'var(--user-accent-primary, #FF5722)' }}
      >
        <Plus className="w-3 h-3" />
        Add Variable
      </button>

      {/* Expression helper */}
      <div>
        <button
          onClick={() => setShowExpressions(!showExpressions)}
          className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-tertiary, #999)' }}
        >
          <motion.div animate={{ rotate: showExpressions ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-3 h-3" />
          </motion.div>
          Expression Helpers
        </button>
        <AnimatePresence>
          {showExpressions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mt-1"
            >
              <div className="space-y-0.5">
                {COMMON_EXPRESSIONS.map(ce => (
                  <button
                    key={ce.expr}
                    onClick={() => handleCopyCommonExpression(ce.expr)}
                    className="w-full flex items-center justify-between px-2 py-1 rounded text-left transition-colors hover:bg-[var(--color-surface)]"
                  >
                    <span className="text-[11px]" style={{ color: 'var(--color-text-secondary, #666)' }}>
                      {ce.label}
                    </span>
                    <span className="flex items-center gap-1">
                      <code className="text-[10px] font-mono" style={{ color: 'var(--user-accent-primary, #FF5722)' }}>
                        {ce.expr}
                      </code>
                      {copiedKey === ce.expr ? (
                        <Check className="w-2.5 h-2.5" style={{ color: 'var(--color-success)' }} />
                      ) : (
                        <Copy className="w-2.5 h-2.5" style={{ color: 'var(--color-text-tertiary, #999)' }} />
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
