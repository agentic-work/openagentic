/**
 * Phase B'-4 — admin TopBar brand area must match chat / code / flows
 * sidebar header. The user's request: "The header of the left sidebar
 * where Openagentic is written needs to be the same as the main sidebar
 * in code/chat/flows".
 *
 * Chat / code / flows sidebars use the CompanyLogo component
 * (`/components/CompanyLogo.tsx`) at variant="compact". Admin TopBar's
 * brand area should use the same component so the visual identity is
 * consistent across all four product surfaces.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let companyLogoCalls: any[] = []
vi.mock('@/components/CompanyLogo', () => ({
  CompanyLogo: (props: any) => {
    companyLogoCalls.push(props)
    return <div data-testid="company-logo" data-variant={props.variant} />
  },
}))

import { TopBar } from '../TopBar'

describe('Phase B-prime · TopBar brand uses shared CompanyLogo', () => {
  it('renders the shared CompanyLogo component in the brand slot', () => {
    companyLogoCalls = []
    render(<TopBar crumbs={[{ label: 'admin' }]} />)
    expect(screen.getByTestId('company-logo')).toBeInTheDocument()
  })

  it('uses the compact variant — same as chat/code/flows sidebar header', () => {
    companyLogoCalls = []
    render(<TopBar crumbs={[{ label: 'admin' }]} />)
    const logo = screen.getByTestId('company-logo')
    expect(logo.getAttribute('data-variant')).toBe('compact')
  })

  it('does NOT render the legacy bespoke "OPENAGENTIC" text + nested-square mark', () => {
    companyLogoCalls = []
    const { container } = render(<TopBar crumbs={[{ label: 'admin' }]} />)
    // The legacy markup used a span with aw-topbar__brand-name containing
    // literal "OPENAGENTIC" text. After B'-4, it's gone — CompanyLogo owns
    // the brand surface.
    expect(container.querySelector('.aw-topbar__brand-name')).toBeNull()
    expect(container.textContent ?? '').not.toMatch(/OPENAGENTIC/)
  })
})
