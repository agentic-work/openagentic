/**
 * ApprovalAuditLogPage — read-only viewer of the tool-call audit log
 * (GET /api/admin/audit-log, backend commit 7e6637539).
 *
 * Mocks useAdminQuery (hoisted state) + stubs primitives-v3 to inspectable
 * testid'd divs so we can read StatusDot status + the endpoint passed to the
 * query. Mirrors Dashboard.extended-thinking.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// ─── hoist mock state + endpoint capture ──────────────────────────────────────
const { mockState, captured } = vi.hoisted(() => ({
  mockState: { current: { data: undefined as any, isLoading: true, isError: false, isFetching: false, refetch: () => {} } },
  captured: { endpoints: [] as string[], keys: [] as string[][] },
}))

vi.mock('../../hooks/useAdminQuery', () => ({
  useAdminQuery: (key: string[], endpoint: string) => {
    captured.keys.push(key)
    captured.endpoints.push(endpoint)
    return mockState.current
  },
}))

// ─── stub primitives so StatusDot/FeedRow props are inspectable ───────────────
vi.mock('../../primitives-v3', () => ({
  PageHead: ({ title, meta, secondaryActions }: any) => (
    <div data-testid="page-head">{title}{meta ? ` · ${meta}` : ''}{secondaryActions}</div>
  ),
  Panel: ({ children }: any) => <div data-testid="panel">{children}</div>,
  PanelHead: ({ title, count }: any) => (
    <div data-testid="panel-head">{title}{count != null ? ` (${count})` : ''}</div>
  ),
  FilterRow: ({ children, right }: any) => (
    <div data-testid="filter-row">{children}{right}</div>
  ),
  Chip: ({ value, on, onClick }: any) => (
    <button data-testid={`chip-${value}`} data-on={on ? 'true' : 'false'} onClick={onClick}>
      {value}
    </button>
  ),
  Feed: ({ children }: any) => <div data-testid="feed">{children}</div>,
  FeedRow: ({ status, who, act, right }: any) => (
    <div data-testid="feed-row" data-status={status} data-who={who}>
      <span data-testid="feed-act">{act}</span>
      <span data-testid="feed-right">{right}</span>
    </div>
  ),
  EmptyInline: ({ children }: any) => <div data-testid="empty">{children}</div>,
  Btn: ({ children, disabled, onClick }: any) => (
    <button data-testid={`btn-${String(children).replace(/[^a-z]/gi, '').toLowerCase()}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  StatusDot: ({ status }: any) => <span data-testid="status-dot" data-status={status} />,
}))

// ─── import after mocks ───────────────────────────────────────────────────────
import { ApprovalAuditLogPage } from '../ApprovalAuditLogPage'

// ─── fixtures ─────────────────────────────────────────────────────────────────
const rows = [
  { id: 'r1', tool_name: 'aws_s3_delete_bucket', server_name: 'aws', args: { b: 1 }, preview: null, classification: 'MUTATING', decision: 'approved', decided_by: 'admin@x', decided_at: '2026-05-31T00:00:00Z', user_id: 'u1', session_id: 's1', origin: 'chat', created_at: '2026-05-31T00:00:00Z' },
  { id: 'r2', tool_name: 'k8s_delete_pod', server_name: 'kubernetes', args: {}, preview: null, classification: 'MUTATING', decision: 'denied', decided_by: 'admin@x', decided_at: '2026-05-31T00:01:00Z', user_id: 'u1', session_id: 's1', origin: 'chat', created_at: '2026-05-31T00:01:00Z' },
  { id: 'r3', tool_name: 'gh_close_pr', server_name: 'github', args: {}, preview: null, classification: 'MUTATING', decision: 'timed_out', decided_by: null, decided_at: null, user_id: 'u2', session_id: 's2', origin: 'subagent', created_at: '2026-05-31T00:02:00Z' },
  { id: 'r4', tool_name: 'web_search', server_name: 'web', args: {}, preview: null, classification: 'READ', decision: 'auto', decided_by: null, decided_at: null, user_id: 'u2', session_id: 's2', origin: 'chat', created_at: '2026-05-31T00:03:00Z' },
]

function dataState(overrides: any = {}) {
  return {
    data: {
      data: rows,
      pagination: { page: 1, limit: 50, total: 4, totalPages: 1, hasMore: false },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  captured.endpoints.length = 0
  captured.keys.length = 0
  mockState.current = dataState()
})

describe('ApprovalAuditLogPage', () => {
  it('renders a loading state', () => {
    mockState.current = { ...dataState(), data: undefined, isLoading: true }
    render(<ApprovalAuditLogPage />)
    expect(screen.getByTestId('empty').textContent).toMatch(/loading/i)
  })

  it('renders an error state', () => {
    mockState.current = { ...dataState(), data: undefined, isLoading: false, isError: true }
    render(<ApprovalAuditLogPage />)
    expect(screen.getByTestId('empty').textContent).toMatch(/failed/i)
  })

  it('renders one FeedRow per audit row with the tool name', () => {
    render(<ApprovalAuditLogPage />)
    const feedRows = screen.getAllByTestId('feed-row')
    expect(feedRows).toHaveLength(4)
    expect(screen.getByText('aws_s3_delete_bucket')).toBeInTheDocument()
    expect(screen.getByText('k8s_delete_pod')).toBeInTheDocument()
  })

  it('maps decision → StatusDot status (approved=ok, denied=err, timed_out=warn, auto=idle)', () => {
    render(<ApprovalAuditLogPage />)
    const feedRows = screen.getAllByTestId('feed-row')
    const statuses = feedRows.map((r) => r.getAttribute('data-status'))
    expect(statuses).toEqual(['ok', 'err', 'warn', 'idle'])
  })

  it('renders the decision text in the right slot', () => {
    render(<ApprovalAuditLogPage />)
    const rights = screen.getAllByTestId('feed-right').map((r) => r.textContent)
    expect(rights).toContain('approved')
    expect(rights).toContain('timed_out')
  })

  it('shows classification as read/mutating in the act slot', () => {
    render(<ApprovalAuditLogPage />)
    const acts = screen.getAllByTestId('feed-act').map((a) => a.textContent).join(' ')
    expect(acts).toMatch(/mutating/)
    expect(acts).toMatch(/read/)
  })

  it('renders one decision filter chip per decision option', () => {
    render(<ApprovalAuditLogPage />)
    expect(screen.getByTestId('chip-all')).toBeInTheDocument()
    expect(screen.getByTestId('chip-approved')).toBeInTheDocument()
    expect(screen.getByTestId('chip-denied')).toBeInTheDocument()
    expect(screen.getByTestId('chip-timed_out')).toBeInTheDocument()
  })

  it('clicking a decision chip re-keys the query with &decision=<value>', () => {
    render(<ApprovalAuditLogPage />)
    captured.endpoints.length = 0
    fireEvent.click(screen.getByTestId('chip-denied'))
    const last = captured.endpoints[captured.endpoints.length - 1]
    expect(last).toContain('decision=denied')
    // page reset to 1
    expect(last).toContain('page=1')
  })

  it('initial query has no decision filter and page=1', () => {
    render(<ApprovalAuditLogPage />)
    const first = captured.endpoints[0]
    expect(first).toContain('/api/admin/audit-log')
    expect(first).toContain('page=1')
    expect(first).not.toContain('decision=')
  })

  it('hides pagination controls when there is a single page', () => {
    render(<ApprovalAuditLogPage />)
    expect(screen.queryByTestId('btn-prev')).toBeNull()
    expect(screen.queryByTestId('btn-next')).toBeNull()
  })

  it('paginates: prev disabled on page 1, next enabled, clicking next bumps page=2', () => {
    mockState.current = dataState({
      data: {
        data: rows,
        pagination: { page: 1, limit: 50, total: 120, totalPages: 3, hasMore: true },
      },
    })
    render(<ApprovalAuditLogPage />)
    const prev = screen.getByTestId('btn-prev')
    const next = screen.getByTestId('btn-next')
    expect(prev).toBeDisabled()
    expect(next).not.toBeDisabled()
    captured.endpoints.length = 0
    fireEvent.click(next)
    const last = captured.endpoints[captured.endpoints.length - 1]
    expect(last).toContain('page=2')
  })
})
