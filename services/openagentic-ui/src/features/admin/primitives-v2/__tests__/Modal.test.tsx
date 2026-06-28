/**
 * Modal primitive — RED tests for Phase 1.2 of the admin console overhaul.
 *
 * Spec: docs/admin-console-overhaul/00-existing-state.md §11.4 (Visual CRUD
 * feedback) + §11.2 (copy budget) + §4.1 (typed-confirm gap on 26 destructive
 * useConfirm callsites today).
 *
 * Contract:
 *   - <Modal open onClose title body variant primary secondary requireConfirmText>
 *   - variant: 'confirm' | 'destructive' | 'form'
 *   - Esc + backdrop click invoke onClose
 *   - role="dialog" + aria-modal="true"
 *   - Initial focus moves to the first focusable inside the dialog
 *   - Tab cycles inside the dialog (focus trap)
 *   - requireConfirmText: primary CTA disabled until input matches exactly
 *   - destructive variant uses --ap-err (or --critical) styling on primary CTA
 *   - body sentence-count + word-count are NOT enforced at runtime (lint-only)
 *     but the component must render the body string verbatim
 *   - No hex literals anywhere in the rendered DOM (--ap-* tokens only)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Modal } from '../Modal'

// jsdom + react-dom portal cleanup
afterEach(() => cleanup())

const TITLE = 'Delete MCP server'
const BODY = 'Removing this server stops in-flight tool calls. Audit logs are retained.'

describe('Modal — confirm variant', () => {
  it('renders title, body, primary CTA, and secondary CTA', () => {
    render(
      <Modal
        open
        onClose={vi.fn()}
        title={TITLE}
        body={BODY}
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }}
      />,
    )
    expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(BODY)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('marks the dialog with role=dialog and aria-modal=true', () => {
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }} secondary={{ label: 'No', onClick: vi.fn() }} />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('renders nothing when open=false', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }} secondary={{ label: 'No', onClick: vi.fn() }} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }} secondary={{ label: 'No', onClick: vi.fn() }} />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }} secondary={{ label: 'No', onClick: vi.fn() }} />,
    )
    fireEvent.click(screen.getByTestId('modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when the dialog body itself is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }} secondary={{ label: 'No', onClick: vi.fn() }} />,
    )
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('invokes primary.onClick when the primary CTA is clicked', () => {
    const onPrimary = vi.fn()
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'Delete', onClick: onPrimary }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onPrimary).toHaveBeenCalledTimes(1)
  })

  it('invokes secondary.onClick when the secondary CTA is clicked', () => {
    const onSecondary = vi.fn()
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: onSecondary }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })
})

describe('Modal — destructive variant', () => {
  it('applies the destructive class on the primary CTA', () => {
    render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const primary = screen.getByRole('button', { name: 'Delete' })
    expect(primary).toHaveAttribute('data-variant', 'destructive')
  })

  it('does NOT use destructive styling for the default confirm variant', () => {
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const primary = screen.getByRole('button', { name: 'OK' })
    expect(primary).not.toHaveAttribute('data-variant', 'destructive')
  })
})

describe('Modal — typed-confirm', () => {
  it('disables primary CTA when requireConfirmText is set and input is empty', () => {
    render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="kubernetes-mcp-server"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('renders an input asking the user to type the resource name', () => {
    render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="kubernetes-mcp-server"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const input = screen.getByLabelText(/type.*to confirm/i)
    expect(input).toBeInTheDocument()
  })

  it('enables primary CTA only when the typed text matches exactly', () => {
    render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="kubernetes-mcp-server"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const input = screen.getByLabelText(/type.*to confirm/i)
    const cta = screen.getByRole('button', { name: 'Delete' })

    expect(cta).toBeDisabled()

    fireEvent.change(input, { target: { value: 'kubernetes-mcp-serve' } })
    expect(cta).toBeDisabled()

    fireEvent.change(input, { target: { value: 'kubernetes-mcp-server' } })
    expect(cta).toBeEnabled()

    fireEvent.change(input, { target: { value: 'KUBERNETES-MCP-SERVER' } })
    expect(cta).toBeDisabled() // case-sensitive

    fireEvent.change(input, { target: { value: 'kubernetes-mcp-server ' } })
    expect(cta).toBeDisabled() // trailing space disqualifies
  })

  it('does not invoke primary onClick when CTA is disabled and clicked', () => {
    const onPrimary = vi.fn()
    render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="x"
        primary={{ label: 'Delete', onClick: onPrimary }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('clears typed-confirm input when the dialog re-opens', () => {
    const { rerender } = render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="x"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const input = screen.getByLabelText(/type.*to confirm/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()

    rerender(
      <Modal open={false} variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="x"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    rerender(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="x"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )

    const reopened = screen.getByLabelText(/type.*to confirm/i) as HTMLInputElement
    expect(reopened.value).toBe('')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})

describe('Modal — focus management', () => {
  it('moves focus to the first focusable element on open', async () => {
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    await waitFor(() => {
      const active = document.activeElement
      // First focusable is either the close button or the secondary CTA
      expect(active).not.toBe(document.body)
      expect(screen.getByRole('dialog')).toContainElement(active as HTMLElement)
    })
  })

  it('keeps focus inside the dialog when Tab is pressed at the last element', async () => {
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'OK', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const dialog = screen.getByRole('dialog')
    const focusables = dialog.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
    const last = focusables[focusables.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })
  })
})

describe('Modal — token discipline', () => {
  it('uses no hex literals in rendered DOM', () => {
    const { container } = render(
      <Modal open variant="destructive" onClose={vi.fn()} title={TITLE} body={BODY}
        requireConfirmText="x"
        primary={{ label: 'Delete', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('Modal — form variant', () => {
  it('renders children inside the dialog when variant=form', () => {
    render(
      <Modal open variant="form" onClose={vi.fn()} title="Add MCP server" body=""
        primary={{ label: 'Add', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }}>
        <input data-testid="mcp-name" placeholder="server name" />
      </Modal>,
    )
    expect(screen.getByTestId('mcp-name')).toBeInTheDocument()
  })

  it('still renders body when present alongside children', () => {
    render(
      <Modal open variant="form" onClose={vi.fn()} title="Edit token" body="Tokens are hashed at rest."
        primary={{ label: 'Save', onClick: vi.fn() }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }}>
        <textarea data-testid="token-name" />
      </Modal>,
    )
    expect(screen.getByText('Tokens are hashed at rest.')).toBeInTheDocument()
    expect(screen.getByTestId('token-name')).toBeInTheDocument()
  })
})

describe('Modal — primary CTA loading state', () => {
  it('disables primary and shows aria-busy when loading=true', () => {
    render(
      <Modal open onClose={vi.fn()} title={TITLE} body={BODY}
        primary={{ label: 'Delete', onClick: vi.fn(), loading: true }}
        secondary={{ label: 'Cancel', onClick: vi.fn() }} />,
    )
    const primary = screen.getByRole('button', { name: /Delete/ })
    expect(primary).toBeDisabled()
    expect(primary).toHaveAttribute('aria-busy', 'true')
  })
})
