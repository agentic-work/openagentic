import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { BigChart } from '../BigChart'

describe('BigChart', () => {
  it('renders one svg with at least 2 paths per series (fill + stroke) + end-marker circle', () => {
    const { container } = render(
      <BigChart series={[{ name: 'test', color: '#4285f4', data: [1, 2, 3, 4, 5] }]} />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('circle')).not.toBeNull()
  })

  it('renders one end-label text element per series with the formatted last value', () => {
    const { container } = render(
      <BigChart
        series={[{ name: 'x', color: '#5cf08f', data: [10, 20, 30] }]}
        yFormat={(v) => v.toFixed(0) + ' req'}
      />,
    )
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent)
    expect(texts).toContain('30 req')
  })

  it('uses explicit label when series.label is provided', () => {
    const { container } = render(
      <BigChart series={[{ name: 'x', color: '#fff', data: [1, 2, 3], label: 'custom' }]} />,
    )
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent)
    expect(texts).toContain('custom')
  })

  it('draws 6 y-gridlines (5 ticks + the baseline)', () => {
    const { container } = render(
      <BigChart series={[{ name: 'x', color: '#fff', data: [1, 2, 3, 4, 5] }]} />,
    )
    const gridLines = container.querySelectorAll('line[stroke-dasharray]')
    expect(gridLines.length).toBe(6)
  })
})
