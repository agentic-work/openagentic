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
import type { ReactElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let companyLogoCalls: any[] = []
vi.mock('@/components/CompanyLogo', () => ({
  CompanyLogo: (props: any) => {
    companyLogoCalls.push(props)
    return <div data-testid="company-logo" data-variant={props.variant} />
  },
}))

import { TopBar } from '../TopBar'

// TopBar mounts <NotificationsBell>, which uses react-query (useAdminQuery).
// Wrap renders in a client so the bell's query has a provider (it stays
// idle/disabled in tests) instead of throwing "No QueryClient set".
const render = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

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

describe('H7 · TopBar scope chip has no baked-in env/brand default', () => {
  it('does NOT render the scope chip (or any "openagentic" env leak) when no scope is passed', () => {
    companyLogoCalls = []
    const { container } = render(<TopBar crumbs={[{ label: 'admin' }]} />)
    // The live mount (AdminPortalHostV3) passes no scope — the chip must be
    // absent so the shell never bakes in an environment string or the
    // pre-scrub "openagentic" brand name.
    expect(container.querySelector('.aw-topbar__chip')).toBeNull()
    expect(container.textContent ?? '').not.toMatch(/openagentic/)
    expect(container.textContent ?? '').not.toMatch(/us-west/)
  })

  it('renders the env/region chip only when the host supplies a real scope', () => {
    companyLogoCalls = []
    const { container } = render(
      <TopBar crumbs={[{ label: 'admin' }]} scope={{ env: 'production', region: 'eu-central' }} />,
    )
    const chip = container.querySelector('.aw-topbar__chip')
    expect(chip).not.toBeNull()
    expect(chip?.textContent ?? '').toContain('production')
    expect(chip?.textContent ?? '').toContain('eu-central')
  })
})
