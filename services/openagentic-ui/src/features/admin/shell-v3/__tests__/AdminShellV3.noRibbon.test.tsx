/**
 * Phase B'-9 — admin shell must NOT render the Ribbon row.
 *
 * User feedback: the colored "LIVE" strip across the top is noise
 * that cares about data the user does not. Removed entirely.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../Ribbon', () => ({
  Ribbon: () => <div data-testid="legacy-ribbon" />,
}))

vi.mock('@/components/CompanyLogo', () => ({
  CompanyLogo: () => <div data-testid="logo" />,
}))

vi.mock('../Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}))

import { AdminShell } from '../AdminShell'

describe('Phase B-prime · AdminShell does NOT render the Ribbon strip', () => {
  it('omits the Ribbon component from its layout', () => {
    const { queryByTestId } = render(
      <AdminShell
        active="dashboard"
        onActiveChange={() => {}}
        renderPage={() => <div>page</div>}
      />,
    )
    expect(queryByTestId('legacy-ribbon')).toBeNull()
  })
})
