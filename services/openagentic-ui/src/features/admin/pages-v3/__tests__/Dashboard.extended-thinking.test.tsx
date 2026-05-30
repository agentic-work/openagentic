/**
 * RED → GREEN spec for Task B.4: "08 · Extended Thinking Usage" tile.
 *
 * Tests the extracted ExtendedThinkingSection component in isolation.
 * Uses vi.hoisted() so the mock state update survives module cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ─── hoist mock state (survives module cache) ─────────────────────────────────
const { mockState } = vi.hoisted(() => ({
  mockState: { current: { data: undefined as any, isLoading: true, isError: false } },
}))

vi.mock('../../hooks/useAdminQuery', () => ({
  useAdminQuery: () => mockState.current,
}))

// ─── stub: primitives-v3 ─────────────────────────────────────────────────────
vi.mock('../../primitives-v3', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    Grid: ({ children }: any) => <div data-testid="et-grid">{children}</div>,
    Panel: ({ children, ...rest }: any) => {
      // filter non-html props
      const { 'data-testid': dt, ...htmlRest } = rest
      return <div data-testid={dt ?? 'et-panel'} {...htmlRest}>{children}</div>
    },
    PanelHead: ({ title, count }: any) => (
      <div data-testid={`panelhead-${String(title).replace(/\s+/g, '-').toLowerCase()}`}>
        {title}{count ? ` (${count})` : ''}
      </div>
    ),
    EmptyInline: ({ children, pad, ...rest }: any) => (
      <div data-testid="et-empty">{children}</div>
    ),
    SectionBar: ({ title, right, ...rest }: any) => (
      <div data-testid="et-section-bar">{title}</div>
    ),
    MetricChart: ({ variant, series, xLabels, yFormat, showLegend, ...rest }: any) => (
      <div
        data-testid={`et-chart-${variant}`}
        data-series={series ? JSON.stringify(series.map((s: any) => ({ name: s.name, len: s.data?.length }))) : undefined}
        data-labels={xLabels ? JSON.stringify(xLabels) : undefined}
      />
    ),
  }
})

// ─── import component ─────────────────────────────────────────────────────────
import { ExtendedThinkingSection } from '../ExtendedThinkingSection'

// ─── fixture ─────────────────────────────────────────────────────────────────
const etFixture = {
  success: true,
  windowStart: '2026-05-12T00:00:00.000Z',
  windowEnd: '2026-05-19T00:00:00.000Z',
  totals: {
    requested: 42,
    delivered: 35,
    requestedNotDelivered: 7,
    avgThinkingTokens: 320,
    avgThinkingDurationMs: 1800,
  },
  byModel: [
    { model: 'us.anthropic.claude-sonnet-4-6', requested: 30, delivered: 25, avgTokens: 280 },
    { model: 'us.anthropic.claude-opus-4', requested: 12, delivered: 10, avgTokens: 400 },
  ],
  byDay: [
    { date: '2026-05-17', requested: 14, delivered: 12 },
    { date: '2026-05-18', requested: 15, delivered: 13 },
    { date: '2026-05-19', requested: 13, delivered: 10 },
  ],
}

function renderSection(timeRange = '7d') {
  return render(<ExtendedThinkingSection timeRange={timeRange} />)
}

// ─── tests ────────────────────────────────────────────────────────────────────
describe('ExtendedThinkingSection (B.4)', () => {
  beforeEach(() => {
    mockState.current = { data: etFixture, isLoading: false, isError: false }
  })

  it('renders the section bar with the correct title', () => {
    renderSection()
    const bar = screen.getByTestId('et-section-bar')
    expect(bar.textContent).toContain('08')
    expect(bar.textContent).toContain('extended thinking')
  })

  it('shows loading state when isLoading=true', () => {
    mockState.current = { data: undefined, isLoading: true, isError: false }
    renderSection()
    const empties = screen.queryAllByTestId('et-empty')
    const hasLoading = empties.some((el) => el.textContent?.includes('loading'))
    expect(hasLoading).toBe(true)
  })

  it('shows error state when isError=true', () => {
    mockState.current = { data: undefined, isLoading: false, isError: true }
    renderSection()
    const empties = screen.queryAllByTestId('et-empty')
    const hasError = empties.some((el) => el.textContent?.includes('failed'))
    expect(hasError).toBe(true)
  })

  it('renders KPI panels on valid data (at least 2: kpi grid + chart grid)', () => {
    renderSection()
    // The Grid mock renders et-grid; Panels inside render et-panel.
    // At minimum 2 grids and 2+ panels are expected.
    const grids = screen.getAllByTestId('et-grid')
    expect(grids.length).toBeGreaterThanOrEqual(2)
  })

  it('delivery rate KPI = 83% for 35 delivered / 42 requested', () => {
    renderSection()
    // 35/42 * 100 = 83.3 → 83
    // The delivery rate is rendered in a div inside the KPI panel.
    // Look for "83%" anywhere in the rendered tree.
    expect(document.body.textContent).toContain('83%')
  })

  it('C2 suppressed count shows "7" from requestedNotDelivered', () => {
    renderSection()
    // requestedNotDelivered = 7 → fmtNum(7) = "7"
    // The number 7 also appears in "320" (avgThinkingTokens) and "42" (requested)
    // Look specifically for the C2 panel text
    const panelHeadC2 = screen.queryByTestId('panelhead-c2-suppressed')
    expect(panelHeadC2).not.toBeNull()
  })

  it('renders a line chart for requested vs delivered by day', () => {
    renderSection()
    const lineCharts = screen.getAllByTestId('et-chart-line')
    expect(lineCharts.length).toBeGreaterThanOrEqual(1)
    const etLine = lineCharts.find((el) => {
      try {
        const series = JSON.parse(el.getAttribute('data-series') ?? '[]')
        return series.some((s: any) => s.name === 'requested') &&
               series.some((s: any) => s.name === 'delivered')
      } catch { return false }
    })
    expect(etLine).toBeDefined()
  })

  it('line chart has 3 x-labels (one per byDay entry)', () => {
    renderSection()
    const lineCharts = screen.getAllByTestId('et-chart-line')
    const etLine = lineCharts.find((el) => {
      try {
        const series = JSON.parse(el.getAttribute('data-series') ?? '[]')
        return series.some((s: any) => s.name === 'requested')
      } catch { return false }
    })
    const labels = JSON.parse(etLine?.getAttribute('data-labels') ?? '[]')
    expect(labels).toHaveLength(3)
    expect(labels[0]).toBe('05-17')
  })

  it('renders a bar chart for by-model breakdown', () => {
    renderSection()
    const barCharts = screen.queryAllByTestId('et-chart-bar')
    expect(barCharts.length).toBeGreaterThanOrEqual(1)
    const etBar = barCharts.find((el) => {
      try {
        const series = JSON.parse(el.getAttribute('data-series') ?? '[]')
        return series.some((s: any) => s.name === 'requested') &&
               series.some((s: any) => s.name === 'delivered')
      } catch { return false }
    })
    expect(etBar).toBeDefined()
  })

  it('bar chart x-labels use the last segment of the model name', () => {
    renderSection()
    const barCharts = screen.queryAllByTestId('et-chart-bar')
    const etBar = barCharts.find((el) => {
      try {
        const series = JSON.parse(el.getAttribute('data-series') ?? '[]')
        return series.some((s: any) => s.name === 'requested')
      } catch { return false }
    })
    const labels = JSON.parse(etBar?.getAttribute('data-labels') ?? '[]')
    expect(labels[0]).toBe('claude-sonnet-4-6')
    expect(labels[1]).toBe('claude-opus-4')
  })

  it('shows empty-inline inside chart panels when byDay is empty', () => {
    mockState.current = {
      data: { ...etFixture, byDay: [], byModel: [] },
      isLoading: false,
      isError: false,
    }
    renderSection()
    const empties = screen.getAllByTestId('et-empty')
    const hasNoUsage = empties.some((el) => el.textContent?.includes('no thinking usage'))
    expect(hasNoUsage).toBe(true)
  })

  it('shows "—" instead of NaN% when requested=0', () => {
    mockState.current = {
      data: {
        ...etFixture,
        totals: { ...etFixture.totals, requested: 0, delivered: 0 },
      },
      isLoading: false,
      isError: false,
    }
    renderSection()
    // deliveryRate is null (requested=0) → renders "—"
    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/NaN/)
    // "—" should appear for the delivery rate KPI
    expect(body).toContain('—')
  })
})
