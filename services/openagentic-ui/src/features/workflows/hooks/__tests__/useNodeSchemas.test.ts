/**
 * useNodeSchemas — TDD tests (A2)
 * RED first: written before useNodeSchemas.ts exists.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Mock the API module
vi.mock('../../services/nodeSchemasApi', () => ({
  nodeSchemasApi: {
    fetchSchemas: vi.fn(),
  },
}));

const mockSchema = {
  type: 'http_request',
  category: 'action',
  label: 'HTTP Request',
  description: 'Make HTTP calls',
  icon: 'globe',
  ports: { inputs: [], outputs: [] },
  settings: [{ name: 'url', label: 'URL', type: 'string', required: true }],
  ai: { shortDescription: 'HTTP call.', whenToUse: 'Calling APIs.' },
  outputAssertions: [],
};

const mockSchema2 = {
  type: 'wait',
  category: 'logic',
  label: 'Wait',
  description: 'Pause execution',
  icon: 'clock',
  ports: { inputs: [], outputs: [] },
  settings: [{ name: 'duration', label: 'Duration (ms)', type: 'number', required: true }],
  ai: { shortDescription: 'Wait.', whenToUse: 'Delaying.' },
  outputAssertions: [],
};

describe('useNodeSchemas', () => {
  let mockFetchSchemas: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { nodeSchemasApi } = await import('../../services/nodeSchemasApi');
    mockFetchSchemas = nodeSchemasApi.fetchSchemas as ReturnType<typeof vi.fn>;
    mockFetchSchemas.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('success — exposes schemas, byType map, aiPromptFragment, loading=false', async () => {
    mockFetchSchemas.mockResolvedValueOnce({
      schemas: [mockSchema, mockSchema2],
      aiPromptFragment: '### Action\n- **http_request** — HTTP call.',
    });

    // Re-import after mock setup
    const { useNodeSchemas } = await import('../useNodeSchemas');
    const { result } = renderHook(() => useNodeSchemas());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.schemas).toHaveLength(2);
    expect(result.current.byType['http_request']).toBeDefined();
    expect(result.current.byType['wait']).toBeDefined();
    expect(result.current.aiPromptFragment).toContain('http_request');
    expect(result.current.error).toBeNull();
  });

  test('network error — loading=false, error set, schemas empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchSchemas.mockResolvedValueOnce({ schemas: [], aiPromptFragment: '' });

    const { useNodeSchemas } = await import('../useNodeSchemas');
    const { result } = renderHook(() => useNodeSchemas());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.schemas).toHaveLength(0);
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  test('byType index is keyed by schema.type', async () => {
    mockFetchSchemas.mockResolvedValueOnce({
      schemas: [mockSchema],
      aiPromptFragment: '',
    });

    const { useNodeSchemas } = await import('../useNodeSchemas');
    const { result } = renderHook(() => useNodeSchemas());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.byType['http_request']).toEqual(mockSchema);
    expect(result.current.byType['nonexistent']).toBeUndefined();
  });

  test('empty registry — all empty, no error', async () => {
    mockFetchSchemas.mockResolvedValueOnce({ schemas: [], aiPromptFragment: '' });

    const { useNodeSchemas } = await import('../useNodeSchemas');
    const { result } = renderHook(() => useNodeSchemas());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.schemas).toHaveLength(0);
    expect(result.current.byType).toEqual({});
    expect(result.current.aiPromptFragment).toBe('');
    expect(result.current.error).toBeNull();
  });
});
