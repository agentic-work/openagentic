/**
 * ModelManagementView — chrome consistency tests (Pilot Task B)
 *
 * Asserts that this Archetype B (Resource list) page conforms to the
 * universal admin-page chrome by rendering the new <PageHeader> primitive
 * at the top, with the expected title, and without any hex literals
 * leaking into inline styles emitted by PageHeader/SoTBanner/etc.
 *
 * Mirrors the three assertions from Pilot A — same shape will run on
 * every Archetype B migration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports that use them
// ---------------------------------------------------------------------------

const mockApiRequest = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

vi.mock('@/shared/hooks/useConfirm', () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

// Stub the heavy tab subcomponents — Pilot B's chrome-consistency test only
// cares about the page header, not the table internals. Keeping these out
// of the render also keeps the no-hex assertion focused on chrome itself.
vi.mock('../ModelManagementView/RegistryTab', () => ({
  RegistryTab: () => <div data-testid="stub-registry-tab" />,
}));
vi.mock('../ModelManagementView/ModelGardenTab', () => ({
  ModelGardenTab: () => <div data-testid="stub-garden-tab" />,
}));
vi.mock('../ModelManagementView/PlaygroundTab', () => ({
  PlaygroundTab: () => <div data-testid="stub-playground-tab" />,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import { ModelManagementView } from '../ModelManagementView';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROVIDERS_FIXTURE = { providers: [] };
const REGISTRY_FIXTURE: any[] = [];

function mkResponse(body: unknown, ok = true) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function setupApiMock() {
  mockApiRequest.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/admin/llm-providers/database')) {
      return mkResponse(PROVIDERS_FIXTURE);
    }
    if (typeof url === 'string' && url.includes('/admin/llm-providers/registry')) {
      return mkResponse(REGISTRY_FIXTURE);
    }
    return mkResponse({});
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelManagementView — chrome consistency (Pilot B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<ModelManagementView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Models?/i', async () => {
    render(<ModelManagementView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Models?/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<ModelManagementView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
