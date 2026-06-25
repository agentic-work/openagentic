/**
 * PipelineSettingsView — chrome consistency tests (Bulk Batch A)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../../../app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAccessToken: () => Promise.resolve('test-token'),
  }),
}));

vi.mock('@/shared/hooks/useConfirm', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

import { PipelineSettingsView } from '../PipelineSettingsView';

const PIPELINE_CONFIG_FIXTURE = {
  configuration: {
    id: 'p1',
    version: 1,
    enabled: true,
    stages: {},
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  },
};

const MODELS_FIXTURE = { models: [] };

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/admin/pipeline-config/models')) {
      return Promise.resolve(
        new Response(JSON.stringify(MODELS_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (typeof url === 'string' && url.includes('/api/admin/pipeline-config')) {
      return Promise.resolve(
        new Response(JSON.stringify(PIPELINE_CONFIG_FIXTURE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as any;
});

describe('PipelineSettingsView — chrome consistency', () => {
  it('renders the universal PageHeader primitive at the top', async () => {
    render(<PipelineSettingsView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Pipeline/i', async () => {
    render(<PipelineSettingsView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Pipeline/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<PipelineSettingsView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
