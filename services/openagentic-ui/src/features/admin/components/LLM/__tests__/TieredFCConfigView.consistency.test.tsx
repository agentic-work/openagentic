/**
 * TieredFCConfigView — chrome consistency tests (Pilot Task A)
 *
 * Asserts that this page conforms to the universal admin-page chrome by
 * rendering the new <PageHeader> primitive at the top, with the expected
 * title, and without any hex literals leaking into inline styles.
 *
 * This is the canary test for the 64-page admin UX migration; the same
 * three assertions will run on every other migrated page.
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

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import TieredFCConfigView from '../TieredFCConfigView';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TIERED_FC_FIXTURE = {
  config: {
    cheapModel: null,
    balancedModel: null,
    premiumModel: null,
    toolStrippingEnabled: true,
    decisionCacheEnabled: true,
    decisionCacheTtlSeconds: 300,
  },
  cacheStats: { size: 0, hits: 0, misses: 0, hitRate: 0 },
  tiers: {
    cheap: {
      triggers: 'short, simple',
      model: 'default',
      description: 'cheap',
      recommended: ['See env config'],
    },
    balanced: {
      triggers: 'multi-tool',
      model: 'default',
      description: 'balanced',
      recommended: ['See env config'],
    },
    premium: {
      triggers: 'complex',
      model: 'default',
      description: 'premium',
      recommended: ['See env config'],
    },
  },
  features: {
    toolStripping: { enabled: true, description: 'strip when not needed' },
    decisionCaching: { enabled: true, ttlSeconds: 300, description: 'cache decisions' },
  },
};

const PROVIDERS_FIXTURE = { providers: [] };

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
    if (typeof url === 'string' && url.includes('/admin/tiered-fc')) {
      return mkResponse(TIERED_FC_FIXTURE);
    }
    if (typeof url === 'string' && url.includes('/admin/llm-providers')) {
      return mkResponse(PROVIDERS_FIXTURE);
    }
    return mkResponse({});
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TieredFCConfigView — chrome consistency (Pilot A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMock();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<TieredFCConfigView />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Tiered Function Calling/i', async () => {
    const { container: _container } = render(<TieredFCConfigView />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Tiered Function Calling/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<TieredFCConfigView />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
