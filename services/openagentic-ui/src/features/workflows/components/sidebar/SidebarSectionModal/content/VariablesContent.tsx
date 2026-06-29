/**
 * VariablesContent — reusable workflow variables referenced as
 * {{variables.name}} in any node, resolved at runtime by the execution
 * engine.
 */

import React from 'react';
import type { VariableType } from '../sectionShared';

export interface VariablesContentProps {
  variables: Record<string, unknown>;
  onVariablesChange: (vars: Record<string, unknown>) => void;
}

interface VarEntry {
  key: string;
  value: unknown;
  type: VariableType;
  description: string;
}

function inferType(value: unknown): VariableType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && value.startsWith('{{secret:')) return 'secret_ref';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

function coerceValue(value: string, type: VariableType): unknown {
  switch (type) {
    case 'number': { const n = Number(value); return Number.isNaN(n) ? 0 : n; }
    case 'boolean': return value === 'true' || value === '1';
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

// Variables: reusable workflow variables referenced as {{variables.name}} in
// any node, resolved at runtime by the execution engine.
export const VariablesContent: React.FC<VariablesContentProps> = (_props) => (
  <div className="py-12 text-center">
    <div className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
      Workflow variables
    </div>
    <div className="text-sm max-w-md mx-auto" style={{ color: 'var(--color-text-tertiary)' }}>
      Variables are referenced as{' '}
      <code style={{ color: 'var(--color-text-secondary)' }}>{'{{variables.name}}'}</code> in any node and
      resolved at runtime by the execution engine.
    </div>
  </div>
);
