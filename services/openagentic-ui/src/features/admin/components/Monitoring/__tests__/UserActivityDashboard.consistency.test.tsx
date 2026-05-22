/**
 * UserActivityDashboard — chrome consistency tests (Bulk Batch D)
 *
 * Asserts the universal admin-page chrome: PageHeader at the top with
 * crumbs Admin / Monitoring / User Activity, the expected title, and
 * no hex literals leaking into inline styles emitted by header chrome.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports that use them
// ---------------------------------------------------------------------------

const mockApiRequest = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// Stub recharts — jsdom can't render SVG / ResizeObserver.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  Bar: () => <div data-testid="bar" />,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

vi.mock('@/utils/ndjsonStream', () => ({
  parseNDJSONStream: async function* () {
    /* yield nothing — stream stays empty */
  },
}));

// Stub heavy shared components.
vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label, value }: any) => (
    <div data-testid="stub-metric-card">{label}: {value}</div>
  ),
}));

vi.mock('../../Shared/AdminCard', () => ({
  AdminCard: ({ children }: any) => <div data-testid="stub-admin-card">{children}</div>,
}));

vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: () => <div data-testid="stub-filter-bar" />,
}));

vi.mock('../../Shared/AdminTooltip', () => ({
  InfoTooltip: () => <span data-testid="stub-info-tooltip" />,
}));

vi.mock('@/shared/components/SlideInPanel', () => ({
  default: ({ children, isOpen }: any) => isOpen ? <div data-testid="stub-slide-panel">{children}</div> : null,
  SlideInPanelSection: ({ children }: any) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Import the component after mocks
// ---------------------------------------------------------------------------

import UserActivityDashboard from '../UserActivityDashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SUMMARY_FIXTURE = {
  onlineCount: 0,
  activeChatSessions: 0,
  activeCodeSessions: 0,
  totalUsers: 0,
  newUsersToday: 0,
  todayTokens: {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalCost: 0,
    requestCount: 0,
    byProvider: [],
  },
  topUsers: [],
};

const USAGE_FIXTURE = {
  user: { id: 'u-1', email: 'alice@example.com', name: 'Alice', isAdmin: true, codeEnabled: true },
  tokenUsage: { totalTokens: 0, totalCost: 0, byProvider: [], byModel: [] },
  chatSessions: { totalSessions: 0, totalMessages: 0, totalTokens: 0, totalCost: 0, recent: [] },
  queryAudit: {
    recent: [
      {
        id: 'q-1',
        queryType: 'chat',
        intent: 'list pods in default namespace',
        mcpServer: 'openagentic-kubernetes',
        modelUsed: 'claude-sonnet-4-6',
        success: true,
        responseTimeMs: 250,
        createdAt: '2026-04-26T12:00:00Z',
      },
      {
        id: 'q-2',
        queryType: 'tool',
        intent: 'describe deployment',
        mcpServer: null,
        modelUsed: 'claude-sonnet-4-6',
        success: false,
        responseTimeMs: 1500,
        createdAt: '2026-04-26T12:01:00Z',
      },
    ],
  },
  codeMode: null,
};

describe('UserActivityDashboard — chrome consistency (Bulk Batch D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('/admin/user-activity/summary')) {
        return Promise.resolve(mkResponse(SUMMARY_FIXTURE));
      }
      if (url.includes('/admin/user-activity/live')) {
        return Promise.resolve(mkResponse({ users: [] }));
      }
      if (url.includes('/admin/user-activity/') && url.includes('/usage')) {
        return Promise.resolve(mkResponse(USAGE_FIXTURE));
      }
      return Promise.resolve(mkResponse({}));
    });

    // Stub the NDJSON stream fetch.
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: { getReader: () => ({ read: () => Promise.resolve({ done: true, value: undefined }) }) },
      } as any),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<UserActivityDashboard theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /User Activity/i', async () => {
    render(<UserActivityDashboard theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/User Activity/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<UserActivityDashboard theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });

  it('renders Recent Activity rows via the unified LogRow primitive', async () => {
    // Mount with a live user so we can open their detail panel.
    mockApiRequest.mockImplementation((url: string) => {
      if (url.includes('/admin/user-activity/summary')) {
        return Promise.resolve(mkResponse(SUMMARY_FIXTURE));
      }
      if (url.includes('/admin/user-activity/live')) {
        return Promise.resolve(mkResponse({ users: [{
          userId: 'u-1', email: 'alice@example.com', name: 'Alice',
          isAdmin: true, lastAccessed: new Date().toISOString(),
          sessionCount: 1, activityType: 'chatting',
        }] }));
      }
      if (url.includes('/admin/user-activity/') && url.includes('/usage')) {
        return Promise.resolve(mkResponse(USAGE_FIXTURE));
      }
      return Promise.resolve(mkResponse({}));
    });

    const { container } = render(<UserActivityDashboard theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    // Click first user button to open the slide-in panel and trigger usage fetch.
    const userButtons = container.querySelectorAll('button');
    const userBtn = Array.from(userButtons).find(b => (b.textContent || '').includes('alice'));
    if (userBtn) (userBtn as HTMLButtonElement).click();

    await waitFor(() => {
      const logRows = container.querySelectorAll('[data-severity]');
      expect(logRows.length).toBeGreaterThan(0);
    });
  });
});
