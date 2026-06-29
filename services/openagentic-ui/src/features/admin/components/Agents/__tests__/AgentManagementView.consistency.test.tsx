/**
 * AgentManagementView — chrome consistency tests (Bulk Batch B2)
 *
 * Asserts the universal admin-page chrome: PageHeader at top, H1 title,
 * and no hex literals in inline styles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// Stub heavy child views — chrome consistency does not need their internals.
vi.mock('../AgentExecutionDashboard', () => ({
  AgentExecutionDashboard: () => <div data-testid="stub-execution-dashboard" />,
}));
vi.mock('../AgentPlayground', () => ({
  AgentPlayground: () => <div data-testid="stub-agent-playground" />,
}));
vi.mock('../SkillsMarketplaceView', () => ({
  SkillsMarketplaceView: () => <div data-testid="stub-skills-marketplace" />,
}));

import { AgentManagementView } from '../AgentManagementView';

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const fetchMock = vi.fn((url: string | URL) => {
  const u = typeof url === 'string' ? url : url.toString();
  if (u.includes('/api/admin/agents/skills')) return mkResponse({ skills: [] });
  if (u.includes('/api/admin/llm-providers/registry')) return mkResponse([]);
  if (u.includes('/api/admin/prompts/modules')) return mkResponse({ modules: [] });
  if (u.includes('/api/admin/agents')) return mkResponse({ agents: [] });
  return mkResponse({});
});

describe('AgentManagementView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<AgentManagementView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Agent/i', async () => {
    render(<AgentManagementView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Agent/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<AgentManagementView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
