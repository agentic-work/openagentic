import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SIDEBAR_GROUPS } from '../../../shell-v2/sidebar-items'

// Mock the heavy LLMPerformanceMetrics dependency so its data-fetch doesn't
// gate the tab render (we only need to confirm the tab + render hook fire).
vi.mock('../../../components/LLM/LLMPerformanceMetrics', () => ({
  default: () => <div data-testid="perf-metrics-stub">perf-metrics</div>,
  LLMPerformanceMetrics: () => <div data-testid="perf-metrics-stub">perf-metrics</div>,
}))
// Stub other heavy deps that would crash in jsdom.
vi.mock('../../../primitives-v2', async () => {
  const actual = await vi.importActual<any>('../../../primitives-v2')
  return {
    ...actual,
    StatCard: () => <div />,
    BigChart: () => <div />,
  }
})
vi.mock('../../../../utils/api', () => ({
  apiRequest: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
}))
// LLMSankeyModal pulls in ThemeProvider context via useTheme; stub it.
vi.mock('../../../components/LLM/LLMSankeyModal', () => ({
  LLMSankeyModal: () => null,
  default: () => null,
}))

import { DashboardOverview } from '../DashboardOverview'

describe('DashboardOverview: Performance tab moved from Monitoring sidebar', () => {
  it('sidebar Monitoring & Logs no longer has the performance leaf', () => {
    const monitoring = SIDEBAR_GROUPS.find(g => g.id === 'monitoring')
    expect(monitoring).toBeDefined()
    const ids = monitoring!.children.map(c => c.id)
    expect(ids).not.toContain('performance')
  })

  it('DashboardOverview exposes a Performance tab and renders LLMPerformanceMetrics when clicked', async () => {
    render(<DashboardOverview />)
    const tablist = screen.getByTestId('dashboard-tabs')
    const perfButton = [...tablist.querySelectorAll('button')]
      .find(b => /performance/i.test(b.textContent || ''))
    expect(perfButton).toBeTruthy()
    fireEvent.click(perfButton!)
    // Lazy-loaded; resolve through Suspense.
    expect(await screen.findByTestId('perf-metrics-stub')).toBeTruthy()
  })
})
