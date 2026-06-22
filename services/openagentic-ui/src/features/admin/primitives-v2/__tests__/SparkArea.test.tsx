import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SparkArea } from '../SparkArea'

describe('SparkArea', () => {
  it('renders an svg with two paths (area + stroke) when given data', () => {
    const { container } = render(<SparkArea data={[1, 2, 3, 4, 5]} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
  })

  it('returns null for empty data', () => {
    const { container } = render(<SparkArea data={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('uses the provided color', () => {
    const { container } = render(<SparkArea data={[1, 2, 3]} color="#abcdef" />)
    const paths = container.querySelectorAll('path')
    expect(paths[0].getAttribute('fill')).toBe('#abcdef')
    expect(paths[1].getAttribute('stroke')).toBe('#abcdef')
  })
})
