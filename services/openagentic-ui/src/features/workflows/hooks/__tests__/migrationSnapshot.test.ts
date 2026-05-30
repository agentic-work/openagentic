/**
 * Migration snapshot test (Step 6 - A3)
 * Verifies the 8 already-migrated node types appear correctly via useMergedNodeConfigs.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../useNodeSchemas', () => ({
  useNodeSchemas: vi.fn(),
}));

// The 8 already-migrated node types (from commit 03bb0aa9)
const MIGRATED_TYPES = [
  'text',
  'http_request',
  'llm_completion',
  'wait',
  'transform',
  'merge',
  'webhook_response',
  'error_handler',
];

const mockSchemas = MIGRATED_TYPES.map(type => ({
  type,
  category: ['text'].includes(type) ? 'annotation' :
            ['http_request', 'webhook_response'].includes(type) ? 'action' :
            ['llm_completion'].includes(type) ? 'ai' :
            ['wait', 'error_handler'].includes(type) ? 'logic' :
            ['transform', 'merge'].includes(type) ? 'data' : 'action',
  label: `${type} (Schema)`,
  description: `Schema-driven ${type}`,
  icon: 'globe',
  settings: [],
}));

// Minimal legacy nodeConfigs (matching the real file structure)
const mockLegacyConfigs: Record<string, any> = {
  trigger: {
    type: 'trigger', label: 'Trigger', description: 'Start workflow',
    icon: '⚡', color: '#f59e0b', category: 'trigger', defaultData: {},
  },
  http_request: {
    type: 'http_request', label: 'HTTP Request (Legacy)', description: 'HTTP calls',
    icon: '🌐', color: '#16A34A', category: 'action', defaultData: {},
  },
  llm_completion: {
    type: 'llm_completion', label: 'LLM Completion (Legacy)', description: 'LLM calls',
    icon: '🧠', color: '#8b5cf6', category: 'ai', defaultData: {},
  },
  wait: {
    type: 'wait', label: 'Wait (Legacy)', description: 'Wait',
    icon: '⏱', color: '#6b7280', category: 'logic', defaultData: {},
  },
  transform: {
    type: 'transform', label: 'Transform (Legacy)', description: 'Transform data',
    icon: '🔄', color: '#f97316', category: 'data', defaultData: {},
  },
  merge: {
    type: 'merge', label: 'Merge (Legacy)', description: 'Merge inputs',
    icon: '⛙', color: '#15803d', category: 'data', defaultData: {},
  },
  webhook_response: {
    type: 'webhook_response', label: 'Webhook Response (Legacy)', description: 'Respond to webhook',
    icon: '↩️', color: '#f59e0b', category: 'action', defaultData: {},
  },
  error_handler: {
    type: 'error_handler', label: 'Error Handler (Legacy)', description: 'Handle errors',
    icon: '⚠️', color: '#ef4444', category: 'logic', defaultData: {},
  },
  text: {
    type: 'text', label: 'Text Note (Legacy)', description: 'Text annotation',
    icon: '📝', color: '#94a3b8', category: 'annotation', defaultData: {},
  },
  // Some unmigrated ones
  condition: {
    type: 'condition', label: 'Condition', description: 'Branch workflow',
    icon: '🔀', color: '#ec4899', category: 'logic', defaultData: {},
  },
  code: {
    type: 'code', label: 'Code', description: 'Run code',
    icon: '💻', color: '#10b981', category: 'action', defaultData: {},
  },
};

describe('migration snapshot — 8 migrated node types', () => {
  beforeEach(async () => {
    const { useNodeSchemas } = await import('../useNodeSchemas');
    const byType = Object.fromEntries(mockSchemas.map(s => [s.type, s]));
    (useNodeSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      schemas: mockSchemas,
      byType,
      aiPromptFragment: '',
      loading: false,
      error: null,
    });
    vi.resetModules();
  });

  test('all 8 migrated types appear in merged output', async () => {
    const { useMergedNodeConfigs } = await import('../useMergedNodeConfigs');
    const { result } = renderHook(() => useMergedNodeConfigs(mockLegacyConfigs));

    for (const type of MIGRATED_TYPES) {
      expect(result.current.merged[type]).toBeDefined();
      expect(result.current.schemaTypes.has(type)).toBe(true);
    }
  });

  test('schema wins over legacy for all 8 migrated types', async () => {
    const { useMergedNodeConfigs } = await import('../useMergedNodeConfigs');
    const { result } = renderHook(() => useMergedNodeConfigs(mockLegacyConfigs));

    for (const type of MIGRATED_TYPES) {
      const node = result.current.merged[type];
      // Schema label should be used (contains "(Schema)")
      expect(node.label).toContain('(Schema)');
    }
  });

  test('legacy-only nodes (condition, code, trigger) still present', async () => {
    const { useMergedNodeConfigs } = await import('../useMergedNodeConfigs');
    const { result } = renderHook(() => useMergedNodeConfigs(mockLegacyConfigs));

    expect(result.current.merged['condition']).toBeDefined();
    expect(result.current.merged['code']).toBeDefined();
    expect(result.current.merged['trigger']).toBeDefined();
    expect(result.current.legacyTypes.has('condition')).toBe(true);
    expect(result.current.legacyTypes.has('code')).toBe(true);
  });

  test('merged palette snapshot shows schema + legacy nodes side by side', async () => {
    const { useMergedNodeConfigs } = await import('../useMergedNodeConfigs');
    const { result } = renderHook(() => useMergedNodeConfigs(mockLegacyConfigs));

    const { merged, schemaTypes, legacyTypes } = result.current;

    // Schema-sourced: http_request, llm_completion, wait (3 migrated)
    const schemaSourced = ['http_request', 'llm_completion', 'wait'].map(t => ({
      type: t,
      source: 'schema',
      label: merged[t].label,
    }));

    // Legacy-only: condition, code, trigger
    const legacySourced = ['condition', 'code', 'trigger'].map(t => ({
      type: t,
      source: 'legacy',
      label: merged[t].label,
    }));

    // All schema types are in bySchema
    for (const { type } of schemaSourced) {
      expect(schemaTypes.has(type)).toBe(true);
    }

    // All legacy types are in legacyTypes
    for (const { type } of legacySourced) {
      expect(legacyTypes.has(type)).toBe(true);
    }

    // The total count is sum of schema + legacy
    const totalExpected = Object.keys(mockLegacyConfigs).length + mockSchemas.filter(s => !mockLegacyConfigs[s.type]).length;
    expect(Object.keys(merged).length).toBe(totalExpected);
  });
});
