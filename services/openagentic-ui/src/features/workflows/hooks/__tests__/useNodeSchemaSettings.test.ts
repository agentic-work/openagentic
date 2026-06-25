/**
 * useNodeSchemaSettings — TDD tests (A5)
 * RED first: written before useNodeSchemaSettings.ts exists.
 *
 * This hook exposes schema-driven settings metadata for a specific node type,
 * consumed by NodePropertiesPanel to render required-field markers, validation
 * patterns, enum values, and defaults.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../useNodeSchemas', () => ({
  useNodeSchemas: vi.fn(),
}));

const mockHttpSchema = {
  type: 'http_request',
  category: 'action',
  label: 'HTTP Request',
  description: 'Make HTTP calls',
  settings: [
    {
      name: 'url',
      label: 'URL',
      type: 'string',
      required: true,
      validation: { pattern: '^https?://', errorMessage: 'URL must start with http(s)' },
    },
    {
      name: 'method',
      label: 'Method',
      type: 'enum',
      values: ['GET', 'POST', 'PUT', 'DELETE'],
      default: 'GET',
      required: false,
    },
    {
      name: 'timeout',
      label: 'Timeout (ms)',
      type: 'number',
      default: 30000,
      min: 100,
      max: 600000,
      required: false,
    },
  ],
};

describe('useNodeSchemaSettings', () => {
  beforeEach(async () => {
    const { useNodeSchemas } = await import('../useNodeSchemas');
    (useNodeSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      schemas: [mockHttpSchema],
      byType: { http_request: mockHttpSchema },
      aiPromptFragment: '',
      loading: false,
      error: null,
    });
    vi.resetModules();
  });

  test('returns settings array for a known node type from schema', async () => {
    const { useNodeSchemaSettings } = await import('../useNodeSchemaSettings');
    const { result } = renderHook(() => useNodeSchemaSettings('http_request'));

    expect(result.current.settings).toHaveLength(3);
    expect(result.current.settings[0].name).toBe('url');
  });

  test('isRequired returns true for required fields', async () => {
    const { useNodeSchemaSettings } = await import('../useNodeSchemaSettings');
    const { result } = renderHook(() => useNodeSchemaSettings('http_request'));

    expect(result.current.isRequired('url')).toBe(true);
    expect(result.current.isRequired('method')).toBe(false);
  });

  test('getEnumValues returns values for enum settings', async () => {
    const { useNodeSchemaSettings } = await import('../useNodeSchemaSettings');
    const { result } = renderHook(() => useNodeSchemaSettings('http_request'));

    expect(result.current.getEnumValues('method')).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    expect(result.current.getEnumValues('url')).toEqual([]);
  });

  test('unknown node type — returns empty settings, isRequired always false', async () => {
    const { useNodeSchemaSettings } = await import('../useNodeSchemaSettings');
    const { result } = renderHook(() => useNodeSchemaSettings('unknown_node_type'));

    expect(result.current.settings).toHaveLength(0);
    expect(result.current.isRequired('any_field')).toBe(false);
    expect(result.current.getEnumValues('any_field')).toEqual([]);
  });
});
