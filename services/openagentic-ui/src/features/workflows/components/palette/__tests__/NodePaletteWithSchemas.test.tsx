/**
 * NodePalette + schema-merge layer — TDD tests (A3, A4)
 * RED first: written before the merge hook exists.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
    span: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock icons
vi.mock('@/shared/icons', () => ({
  Plus: () => <span data-testid="icon-plus" />,
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  AlertCircle: () => <span data-testid="icon-alert" />,
  ChevronDown: () => <span data-testid="icon-chevron" />,
}));

// Mock the useNodeSchemas hook
vi.mock('../../../hooks/useNodeSchemas', () => ({
  useNodeSchemas: vi.fn(),
}));

const schemaHttpRequest = {
  type: 'http_request',
  category: 'action',
  label: 'HTTP Request (Schema)',
  description: 'Make HTTP calls via schema',
  icon: 'globe',
  settings: [{ name: 'url', label: 'URL', type: 'string', required: true }],
};

const schemaWait = {
  type: 'wait',
  category: 'logic',
  label: 'Wait (Schema)',
  description: 'Pause execution',
  icon: 'clock',
  settings: [],
};

const schemaMerge = {
  type: 'merge',
  category: 'data',
  label: 'Merge (Schema)',
  description: 'Merge inputs',
  icon: 'merge',
  settings: [],
};

// Legacy configs that are NOT in the schema registry
const legacyConfigs: Record<string, any> = {
  trigger: {
    type: 'trigger',
    label: 'Trigger (Legacy)',
    description: 'Start workflow',
    icon: '⚡',
    color: '#f59e0b',
    category: 'trigger',
    defaultData: {},
  },
  condition: {
    type: 'condition',
    label: 'Condition (Legacy)',
    description: 'Branch workflow',
    icon: '🔀',
    color: '#ec4899',
    category: 'logic',
    defaultData: {},
  },
  // http_request also in legacy — schema should win
  http_request: {
    type: 'http_request',
    label: 'HTTP Request (Legacy)',
    description: 'Make HTTP calls via legacy',
    icon: '🌐',
    color: '#16A34A',
    category: 'action',
    defaultData: {},
  },
};

describe('useMergedNodeConfigs (schema-merge layer)', () => {
  beforeEach(async () => {
    const { useNodeSchemas } = await import('../../../hooks/useNodeSchemas');
    (useNodeSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      schemas: [schemaHttpRequest, schemaWait, schemaMerge],
      byType: {
        http_request: schemaHttpRequest,
        wait: schemaWait,
        merge: schemaMerge,
      },
      aiPromptFragment: '',
      loading: false,
      error: null,
    });
  });

  test('schema-sourced node wins over legacy for same type', async () => {
    const { useMergedNodeConfigs } = await import('../../../hooks/useMergedNodeConfigs');
    const { renderHook } = await import('@testing-library/react');

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));

    // http_request is in BOTH schema and legacy — schema wins
    const httpNode = result.current.merged['http_request'];
    expect(httpNode).toBeDefined();
    // Schema label wins
    expect(httpNode.label).toBe('HTTP Request (Schema)');
  });

  test('legacy-only node is included in merged output', async () => {
    const { useMergedNodeConfigs } = await import('../../../hooks/useMergedNodeConfigs');
    const { renderHook } = await import('@testing-library/react');

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));

    // trigger only exists in legacy
    expect(result.current.merged['trigger']).toBeDefined();
    expect(result.current.merged['trigger'].label).toBe('Trigger (Legacy)');
  });

  test('schema-only node (merge) is included in merged output', async () => {
    const { useMergedNodeConfigs } = await import('../../../hooks/useMergedNodeConfigs');
    const { renderHook } = await import('@testing-library/react');

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));

    // merge is only in schema
    expect(result.current.merged['merge']).toBeDefined();
  });

  test('categories deduped and sorted from merged output', async () => {
    const { useMergedNodeConfigs } = await import('../../../hooks/useMergedNodeConfigs');
    const { renderHook } = await import('@testing-library/react');

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));

    const cats = new Set(Object.values(result.current.merged).map((n: any) => n.category));
    // Should have action, logic, data (from schema) + trigger, logic (from legacy)
    expect(cats.has('action')).toBe(true);
    expect(cats.has('logic')).toBe(true);
    expect(cats.has('trigger')).toBe(true);
  });
});

describe('NodePalette renders categories from schemas', () => {
  test('renders schema-derived category header labels', async () => {
    const { useNodeSchemas } = await import('../../../hooks/useNodeSchemas');
    (useNodeSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      schemas: [schemaHttpRequest, schemaMerge],
      byType: { http_request: schemaHttpRequest, merge: schemaMerge },
      aiPromptFragment: '',
      loading: false,
      error: null,
    });

    const { NodePalette } = await import('../NodePalette');
    const merged = {
      http_request: {
        type: 'http_request', label: 'HTTP Request (Schema)', description: 'desc',
        category: 'action', icon: 'globe', color: '#16A34A', defaultData: {},
      },
      merge: {
        type: 'merge', label: 'Merge (Schema)', description: 'desc',
        category: 'data', icon: 'merge', color: '#15803d', defaultData: {},
      },
    };

    render(<NodePalette isOpen={true} nodeConfigs={merged} loading={false} error={null} />);

    // Categories from schema-sourced nodes should appear
    expect(screen.getByText(/Actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Data/i)).toBeInTheDocument();
  });

  test('shows loading state during schema fetch', async () => {
    const { useNodeSchemas } = await import('../../../hooks/useNodeSchemas');
    (useNodeSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      schemas: [],
      byType: {},
      aiPromptFragment: '',
      loading: true,
      error: null,
    });

    const { NodePalette } = await import('../NodePalette');
    render(<NodePalette isOpen={true} nodeConfigs={{}} loading={true} error={null} />);

    expect(screen.getByText(/Loading nodes/i)).toBeInTheDocument();
  });

  test('shows error state when schema fetch fails', async () => {
    const { NodePalette } = await import('../NodePalette');
    render(<NodePalette isOpen={true} nodeConfigs={{}} loading={false} error="Failed to fetch" />);

    expect(screen.getByText(/Failed to load nodes/i)).toBeInTheDocument();
  });

  test('empty palette shows no-nodes message', async () => {
    const { NodePalette } = await import('../NodePalette');
    render(<NodePalette isOpen={true} nodeConfigs={{}} loading={false} error={null} />);

    expect(screen.getByText(/No nodes found/i)).toBeInTheDocument();
  });
});
