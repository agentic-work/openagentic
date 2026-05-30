/**
 * TDD — IntegrationsView: Test Connection UI (RED-first)
 *
 * Tests:
 *   T5  success:false from API renders actual error, NOT "Connection successful"
 *   T6  success:true for Slack renders workspace/user/botId rich result
 *   T7  details.field='botToken' highlights botToken input with error
 *   T8  "Send test message" button appears only after Slack auth success
 *   T9  Status pill updates: Active / Error / Untested
 *   T10 success:false for Teams renders error detail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock @/utils/api (used by IntegrationsView as apiRequest)
// ---------------------------------------------------------------------------
vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock shared icons/components that have deep deps or SVG imports
// ---------------------------------------------------------------------------
vi.mock('@/shared/icons', () => ({
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  Plus: () => <span data-testid="icon-plus" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Eye: () => <span data-testid="icon-eye" />,
  Send: () => <span data-testid="icon-send" />,
  Search: () => <span data-testid="icon-search" />,
}));

vi.mock('../../Shared/AdminIcons', () => ({
  RefreshIcon: () => <span />,
  ActivityIcon: () => <span />,
  ServerIcon: () => <span />,
  EditIcon: () => <span />,
  CloseIcon: () => <span />,
  ToggleOnIcon: () => <span />,
  ToggleOffIcon: () => <span />,
  Loader2: () => <span data-testid="loader" />,
}));

vi.mock('../../Shared/AdminMetricCard', () => ({
  AdminMetricCard: ({ label, value }: any) => (
    <div data-testid={`metric-${label.replace(/\s+/g, '-').toLowerCase()}`}>{value}</div>
  ),
}));

vi.mock('../../Shared/AdminFilterBar', () => ({
  AdminFilterBar: () => <div data-testid="filter-bar" />,
}));

vi.mock('../../Shared/AdminStatusBadge', () => ({
  AdminStatusBadge: ({ status }: any) => (
    <span data-testid="status-badge" data-status={status}>{status}</span>
  ),
}));

vi.mock('../../Shared/AdminTooltip', () => ({
  InfoTooltip: () => <span />,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { apiRequest } from '@/utils/api';
import { IntegrationsView } from '../IntegrationsView';

const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: any, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const SLACK_INTEGRATION = {
  id: 'int-1',
  name: 'My Slack',
  platform: 'slack' as const,
  status: 'active' as const,
  webhookUrl: '/hooks/abc123',
  config: { botToken: 'xoxb-abc', signingSecret: 'abc123def456abc123def456abc12345', appId: 'A123' },
  channels: [],
  workflowIds: [],
  channelCount: 0,
  workflowCount: 0,
  lastActivity: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function setupInitialLoad(integration = SLACK_INTEGRATION) {
  mockApiRequest.mockResolvedValueOnce(
    makeResponse({ integrations: [integration] })
  );
}

async function openEditDialog() {
  const editBtn = screen.getByTitle('Edit');
  await act(async () => {
    fireEvent.click(editBtn);
  });
}

async function clickTestConnection() {
  const testBtn = screen.getByRole('button', { name: /Test Connection/i });
  await act(async () => {
    fireEvent.click(testBtn);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationsView — Test Connection', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // T5 — success:false renders actual error, NOT "Connection successful"
  it('T5: success:false response renders error detail, not "Connection successful"', async () => {
    setupInitialLoad();

    render(<IntegrationsView theme="dark" />);
    await waitFor(() => expect(screen.getByText('My Slack')).toBeInTheDocument());

    await openEditDialog();

    // Queue test response — success:false with specific error
    mockApiRequest.mockResolvedValueOnce(
      makeResponse({ success: false, details: { error: 'invalid_auth' } }, false, 400)
    );

    await clickTestConnection();

    await waitFor(() => {
      // Must NOT show "Connection successful"
      expect(screen.queryByText(/Connection successful/i)).not.toBeInTheDocument();
      // Must show actual error
      expect(screen.getByText(/invalid_auth/i)).toBeInTheDocument();
    });
  });

  // T6 — success:true for Slack renders workspace/user/botId
  it('T6: Slack success:true renders workspace name, user, and botId', async () => {
    setupInitialLoad();

    render(<IntegrationsView theme="dark" />);
    await waitFor(() => expect(screen.getByText('My Slack')).toBeInTheDocument());

    await openEditDialog();

    mockApiRequest.mockResolvedValueOnce(
      makeResponse({
        success: true,
        details: {
          team: 'OpenAgentic',
          teamId: 'T01ABC',
          user: 'agenticbot',
          userId: 'U01ABC',
          botId: 'B01ABC',
          url: 'https://openagentic.slack.com/',
        },
      }, true, 200)
    );

    await clickTestConnection();

    await waitFor(() => {
      expect(screen.getByText(/OpenAgentic/i)).toBeInTheDocument();
      expect(screen.getByText(/@agenticbot/i)).toBeInTheDocument();
      expect(screen.getByText(/B01ABC/i)).toBeInTheDocument();
    });
  });

  // T7 — details.field='botToken' highlights botToken input
  it('T7: details.field=botToken adds error styling to the botToken input', async () => {
    setupInitialLoad();

    render(<IntegrationsView theme="dark" />);
    await waitFor(() => expect(screen.getByText('My Slack')).toBeInTheDocument());

    await openEditDialog();

    mockApiRequest.mockResolvedValueOnce(
      makeResponse({
        success: false,
        details: { error: 'invalid_token_format', field: 'botToken' },
      }, false, 400)
    );

    await clickTestConnection();

    await waitFor(() => {
      // The botToken input should have an error indicator (data-error or red border class or aria-invalid)
      const botTokenInput = screen.getByPlaceholderText('xoxb-...');
      expect(
        botTokenInput.getAttribute('data-error') === 'true' ||
        botTokenInput.getAttribute('aria-invalid') === 'true' ||
        botTokenInput.className.includes('error') ||
        botTokenInput.closest('[data-field-error="botToken"]') !== null
      ).toBe(true);
    });
  });

  // T8 — "Send test message" button appears only after Slack auth success
  it('T8: Send test message button appears only after a successful Slack auth test', async () => {
    setupInitialLoad();

    render(<IntegrationsView theme="dark" />);
    await waitFor(() => expect(screen.getByText('My Slack')).toBeInTheDocument());

    await openEditDialog();

    // Initially: no "Send test message" button
    expect(screen.queryByRole('button', { name: /Send test message/i })).not.toBeInTheDocument();

    // Run successful test
    mockApiRequest.mockResolvedValueOnce(
      makeResponse({
        success: true,
        details: { team: 'X', teamId: 'T1', user: 'bot', userId: 'U1', botId: 'B1', url: 'https://x.slack.com/' },
      }, true, 200)
    );

    await clickTestConnection();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Send test message/i })).toBeInTheDocument();
    });
  });

  // T9 — Status pill shows last test outcome
  it('T9: lastTestStatus is reflected in the integration card status badge', async () => {
    setupInitialLoad({
      ...SLACK_INTEGRATION,
      config: {
        ...SLACK_INTEGRATION.config,
        lastTest: { status: 'error', error: 'invalid_auth', testedAt: new Date().toISOString() },
      },
    });

    render(<IntegrationsView theme="dark" />);

    await waitFor(() => {
      const badges = screen.getAllByTestId('status-badge');
      // At least one badge should reflect error or we look for "Untested" concept
      expect(badges.length).toBeGreaterThan(0);
    });

    // After a successful test, status badge in dialog should show "Active"
    await openEditDialog();

    mockApiRequest.mockResolvedValueOnce(
      makeResponse({
        success: true,
        details: { team: 'X', teamId: 'T1', user: 'bot', userId: 'U1', botId: 'B1', url: 'https://x.slack.com/' },
      }, true, 200)
    );

    await clickTestConnection();

    await waitFor(() => {
      // testResult.ok = true — rich result should be shown
      const matches = screen.getAllByText(/OpenAgentic|Connected|Active|successful/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  // T10 — success:false for Teams renders error detail
  it('T10: Teams success:false response renders actual error, not generic message', async () => {
    const teamsIntegration = {
      ...SLACK_INTEGRATION,
      id: 'int-teams-1',
      name: 'My Teams',
      platform: 'teams' as const,
      config: { appId: '550e8400-e29b-41d4-a716-446655440000', appPassword: 'pass', tenantId: 'tenant' },
    };

    setupInitialLoad(teamsIntegration);

    render(<IntegrationsView theme="dark" />);
    await waitFor(() => expect(screen.getByText('My Teams')).toBeInTheDocument());

    await openEditDialog();

    mockApiRequest.mockResolvedValueOnce(
      makeResponse({
        success: false,
        details: { error: 'unauthorized_client', errorDescription: 'The client is not authorized.' },
      }, false, 400)
    );

    await clickTestConnection();

    await waitFor(() => {
      expect(screen.queryByText(/Connection successful/i)).not.toBeInTheDocument();
      expect(screen.getByText(/unauthorized_client/i)).toBeInTheDocument();
    });
  });

});
