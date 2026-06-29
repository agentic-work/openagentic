/**
 * Phase B'-2 — admin shell-v3 Sidebar uses the SHARED SettingsMenu
 * from chat (not its own inline-styled popover).
 *
 * The user's request was explicit: "the Settings & More to be the exact
 * same one from chatmode, flows, codemode". This test asserts the
 * chat component is rendered inside the admin Sidebar's bottom slot.
 *
 * NOTE: We do NOT assert on internal markup of SettingsMenu (theme/accent
 * submenus, etc.) — that's owned by the chat component's own tests. We
 * just assert the integration: the Sidebar imports + renders it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
)

// Mock the SettingsMenu to keep the test fast + isolated. The mock
// asserts that the admin sidebar IS calling it, with the right wiring.
let lastSettingsMenuProps: any = null
vi.mock('@/features/chat/components/SettingsMenu', () => ({
  default: (props: any) => {
    lastSettingsMenuProps = props
    return <div data-testid="shared-settings-menu" />
  },
}))

// Stub the chat ThemeContext so SettingsMenu's parent providers resolve.
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', changeTheme: () => {} }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  accentColors: [],
}))

vi.mock('@/stores/useUIVisibilityStore', () => ({
  useUIVisibilityStore: (selector: any) => selector({ open: () => {}, close: () => {} }),
}))

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ user: { displayName: 'Test User', email: 't@example.com' } }),
}))

import { Sidebar } from '../Sidebar'

describe('Phase B-prime · Sidebar uses shared SettingsMenu', () => {
  it('renders the shared chat SettingsMenu in the bottom slot', () => {
    render(
      wrap(<Sidebar active="dashboard" onSelect={() => {}} onSignOut={() => {}} />),
    )
    expect(screen.getByTestId('shared-settings-menu')).toBeInTheDocument()
  })

  it('does NOT render the legacy inline-styled "Settings & more" button anymore', () => {
    render(
      wrap(<Sidebar active="dashboard" onSelect={() => {}} onSignOut={() => {}} />),
    )
    // The legacy implementation rendered <button>Settings &amp; more</button>
    // inline. After B'-2, that should be gone — the SettingsMenu owns the
    // trigger button.
    expect(screen.queryByText(/^Settings & more$/)).toBeNull()
  })

  it('passes onLogout through to SettingsMenu (wiring contract)', () => {
    lastSettingsMenuProps = null
    const handler = vi.fn()
    render(
      wrap(<Sidebar active="dashboard" onSelect={() => {}} onSignOut={handler} />),
    )
    expect(lastSettingsMenuProps).not.toBeNull()
    expect(lastSettingsMenuProps.onLogout).toBe(handler)
  })
})
