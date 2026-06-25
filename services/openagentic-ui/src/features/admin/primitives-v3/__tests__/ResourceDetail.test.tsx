/**
 * Phase B · primitive — `<ResourceDetail>` standardized resource template.
 *
 * Every detail panel (Provider, Model, Agent, Workflow, User, MCP server)
 * gets the same anatomy + same tab-order. This is the single biggest UX
 * win for muscle memory in the admin shell.
 *
 * Mandatory tab order (omit any tab the resource doesn't have, but never
 * REORDER):
 *   1. Overview     — KV pairs left, mini-charts/health right.
 *   2. Details      — full configuration / spec.
 *   3. Permissions  — IAM, scopes, group access. (optional)
 *   4. Logs         — recent operation log filtered to this resource.
 *   5. Monitoring   — extended metric charts. (optional)
 *   6. History      — version / change log. (optional)
 *
 * Test contract: feeding tabs in any order yields the canonical order
 * in the rendered tab strip.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResourceDetail, type ResourceTabId } from '../ResourceDetail'

const ALL_TABS: ResourceTabId[] = [
  'overview',
  'details',
  'permissions',
  'logs',
  'monitoring',
  'history',
]

describe('ResourceDetail — mandatory tab-order + sticky header anatomy', () => {
  it('renders title + meta strip', () => {
    render(
      <ResourceDetail
        title="Azure OpenAI · gpt-5.4"
        meta="provider · added 2d ago · 3 tools · v2"
        tabs={[{ id: 'overview', label: 'Overview', body: <span>x</span> }]}
        activeTab="overview"
        onTabChange={() => {}}
      />,
    )
    expect(screen.getByText('Azure OpenAI · gpt-5.4')).toBeInTheDocument()
    expect(
      screen.getByText('provider · added 2d ago · 3 tools · v2'),
    ).toBeInTheDocument()
  })

  it('canonicalizes tab order regardless of input order', () => {
    // Pass tabs in a SCRAMBLED order — implementation must reorder.
    const { container } = render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[
          { id: 'history',     label: 'History',     body: <span>h</span> },
          { id: 'logs',        label: 'Logs',        body: <span>l</span> },
          { id: 'overview',    label: 'Overview',    body: <span>o</span> },
          { id: 'permissions', label: 'Permissions', body: <span>p</span> },
          { id: 'details',     label: 'Details',     body: <span>d</span> },
          { id: 'monitoring',  label: 'Monitoring',  body: <span>m</span> },
        ]}
        activeTab="overview"
        onTabChange={() => {}}
      />,
    )
    const tabButtons = container.querySelectorAll('.aw-resource-detail__tab')
    const renderedIds = [...tabButtons].map((b) => b.getAttribute('data-tab-id'))
    expect(renderedIds).toEqual(ALL_TABS)
  })

  it('omits tabs the caller did not supply but preserves the order', () => {
    const { container } = render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[
          { id: 'monitoring', label: 'Monitoring', body: <span>m</span> },
          { id: 'overview',   label: 'Overview',   body: <span>o</span> },
          { id: 'logs',       label: 'Logs',       body: <span>l</span> },
        ]}
        activeTab="overview"
        onTabChange={() => {}}
      />,
    )
    const ids = [...container.querySelectorAll('.aw-resource-detail__tab')]
      .map((b) => b.getAttribute('data-tab-id'))
    expect(ids).toEqual(['overview', 'logs', 'monitoring'])
  })

  it('renders the active tab body and hides the others', () => {
    render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[
          { id: 'overview', label: 'Overview', body: <span>OV-BODY</span> },
          { id: 'details',  label: 'Details',  body: <span>DT-BODY</span> },
        ]}
        activeTab="details"
        onTabChange={() => {}}
      />,
    )
    expect(screen.getByText('DT-BODY')).toBeInTheDocument()
    expect(screen.queryByText('OV-BODY')).toBeNull()
  })

  it('fires onTabChange with the canonical tab id when a tab is clicked', () => {
    let clicked: string | null = null
    render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[
          { id: 'overview', label: 'Overview', body: <span>o</span> },
          { id: 'details',  label: 'Details',  body: <span>d</span> },
        ]}
        activeTab="overview"
        onTabChange={(id) => {
          clicked = id
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(clicked).toBe('details')
  })

  it('exposes headerActions slot on the right of the sticky header', () => {
    const { container } = render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[{ id: 'overview', label: 'Overview', body: <span>o</span> }]}
        activeTab="overview"
        onTabChange={() => {}}
        headerActions={<button data-testid="edit-action">edit</button>}
      />,
    )
    expect(container.querySelector('[data-testid="edit-action"]')).toBeTruthy()
    // The header-actions slot must be inside .aw-resource-detail__head__right
    const right = container.querySelector('.aw-resource-detail__head__right')
    expect(right?.querySelector('[data-testid="edit-action"]')).toBeTruthy()
  })

  it('marks the active tab via data-active=true (drives CSS underline)', () => {
    const { container } = render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[
          { id: 'overview', label: 'Overview', body: <span>o</span> },
          { id: 'logs',     label: 'Logs',     body: <span>l</span> },
        ]}
        activeTab="logs"
        onTabChange={() => {}}
      />,
    )
    const active = container.querySelector('.aw-resource-detail__tab[data-active="true"]')
    expect(active?.getAttribute('data-tab-id')).toBe('logs')
  })

  it('roots under .aw-resource-detail so the override layer can scope it', () => {
    const { container } = render(
      <ResourceDetail
        title="x"
        meta="y"
        tabs={[{ id: 'overview', label: 'Overview', body: <span>o</span> }]}
        activeTab="overview"
        onTabChange={() => {}}
      />,
    )
    expect(container.querySelector('.aw-resource-detail')).toBeTruthy()
    expect(container.querySelector('.aw-resource-detail__head')).toBeTruthy()
    expect(container.querySelector('.aw-resource-detail__tabs')).toBeTruthy()
    expect(container.querySelector('.aw-resource-detail__body')).toBeTruthy()
  })
})
