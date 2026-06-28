import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExplainerCard } from '../ExplainerCard'

describe('ExplainerCard', () => {
  it('renders title and body', () => {
    render(<ExplainerCard title="What is this?" body={<p>It's a thing</p>} />)
    expect(screen.getByText('What is this?')).toBeInTheDocument()
    expect(screen.getByText("It's a thing")).toBeInTheDocument()
  })

  it('renders the why-it-matters block when provided', () => {
    render(<ExplainerCard title="X" body="b" why="because reasons" />)
    expect(screen.getByText(/because reasons/)).toBeInTheDocument()
  })

  it('respects suppressed prop and hides itself', () => {
    const { container } = render(<ExplainerCard title="X" body="b" suppressed />)
    expect(container.firstChild).toBeNull()
  })

  it('hide button calls onSuppress', () => {
    let called = false
    render(<ExplainerCard title="X" body="b" onSuppress={() => { called = true }} />)
    fireEvent.click(screen.getByRole('button', { name: /hide/i }))
    expect(called).toBe(true)
  })
})
