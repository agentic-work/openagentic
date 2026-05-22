/**
 * #811 — IssueTokenModal must include admin users in the picker.
 *
 * Pre-#811: the modal filtered admins out client-side (line 71 of
 * IssueTokenModal.tsx pre-fix), based on a stale comment that the
 * back-end refused admin token creation. The back-end at
 * admin-api-tokens.ts:166 only LOGS a warn; it does not refuse. The
 * filter blocked legit admin workflows (e.g. CI key for a system
 * admin) and made the picker look broken when an org had mostly
 * admin users.
 *
 * Contract pinned here:
 *  1. All users (admin + non-admin) appear in the <option> list
 *  2. Admin users are sorted last
 *  3. Admin <option> labels include the "(admin)" suffix
 *  4. Selecting an admin user surfaces an inline warn banner
 */
import * as React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../../hooks/useUserManagement', () => ({
  useUserManagement: () => ({
    data: {
      users: [
        { id: 'u-admin-1', email: 'admin1@example.com', name: 'Admin One', is_admin: true },
        { id: 'u-svc-1', email: 'svc1@example.com', name: 'Svc One', is_admin: false },
        { id: 'u-admin-2', email: 'admin2@example.com', name: 'Admin Two', is_admin: true },
        { id: 'u-svc-2', email: 'svc2@example.com', name: 'Svc Two', is_admin: false },
      ],
    },
    isLoading: false,
  }),
  asUsers: (data: any) => data?.users ?? [],
}))

vi.mock('../../../hooks/useAdminQuery', () => ({
  useAdminMutation: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
  }),
}))

import { IssueTokenModal } from '../IssueTokenModal'

const renderWithClient = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('#811 IssueTokenModal — admin users in dropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders ALL users (admin + non-admin) in the picker', () => {
    renderWithClient(<IssueTokenModal open={true} onClose={() => {}} />)
    expect(screen.getByText(/Admin One.*admin1@example.com/)).toBeInTheDocument()
    expect(screen.getByText(/Admin Two.*admin2@example.com/)).toBeInTheDocument()
    expect(screen.getByText(/Svc One.*svc1@example.com/)).toBeInTheDocument()
    expect(screen.getByText(/Svc Two.*svc2@example.com/)).toBeInTheDocument()
  })

  it('appends "(admin)" suffix to admin user labels', () => {
    renderWithClient(<IssueTokenModal open={true} onClose={() => {}} />)
    const adminOption = screen.getByText(/Admin One.*admin1@example.com.*\(admin\)/)
    expect(adminOption).toBeInTheDocument()
    // Non-admin must NOT have the suffix
    const svcOption = screen.getByText(/Svc One.*svc1@example.com/)
    expect(svcOption.textContent).not.toContain('(admin)')
  })

  it('sorts admin users last', () => {
    renderWithClient(<IssueTokenModal open={true} onClose={() => {}} />)
    // FormRow's <label> doesn't have htmlFor → can't use getByRole+name.
    // The user picker is the first <select> rendered in the form.
    const select = document.querySelectorAll('select')[0] as HTMLSelectElement
    const optionTexts = Array.from(select.querySelectorAll('option'))
      .map((o) => o.textContent || '')
      .filter((t) => t && !t.startsWith('—') && !t.startsWith('loading'))
    // First two should be non-admin, last two admin
    expect(optionTexts[0]).toMatch(/svc/i)
    expect(optionTexts[1]).toMatch(/svc/i)
    expect(optionTexts[2]).toMatch(/admin/i)
    expect(optionTexts[3]).toMatch(/admin/i)
  })

  it('surfaces a warn banner when an admin user is selected', () => {
    renderWithClient(<IssueTokenModal open={true} onClose={() => {}} />)
    // FormRow's <label> doesn't have htmlFor → can't use getByRole+name.
    // The user picker is the first <select> rendered in the form.
    const select = document.querySelectorAll('select')[0] as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'u-admin-1' } })
    expect(screen.getByText(/admin key/i)).toBeInTheDocument()
    expect(screen.getByText(/audit-logged/i)).toBeInTheDocument()
  })

  it('does NOT show the warn banner when a non-admin user is selected', () => {
    renderWithClient(<IssueTokenModal open={true} onClose={() => {}} />)
    // FormRow's <label> doesn't have htmlFor → can't use getByRole+name.
    // The user picker is the first <select> rendered in the form.
    const select = document.querySelectorAll('select')[0] as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'u-svc-1' } })
    expect(screen.queryByText(/admin key/i)).toBeNull()
  })
})
