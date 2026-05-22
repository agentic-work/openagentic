/**
 * #941 — claude.ai-style attach button pin (2026-05-20).
 *
 * Asserts the contract for the chat composer's attach affordance:
 *   - first focusable button in the toolbar
 *   - aria-label matches /attach/i
 *   - renders the `Plus` icon (two perpendicular `<line>` SVG elements,
 *     i.e. the literal `+` glyph)
 *   - the button container is CIRCULAR (rounded-full / 9999px border-radius)
 *     — claude.ai pattern. The post-#940 revert restored the Plus glyph
 *     but left `rounded-lg` (8px corners). User wants a true circular
 *     pill at the left edge of the composer toolbar.
 *   - clicking the button invokes `.click()` on the file input ref
 *     (drag-drop on textarea is preserved by ChatInputBar and orthogonal
 *     to this contract — see #683 / #687).
 *
 * RED before fix: the `rounded-full` assertion fails because the source
 * still ships `rounded-lg`. GREEN after the one-line className swap.
 *
 * Test runner: vitest (NOT bun — uses vi.mock for createPortal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock createPortal so ModelSelectorDropdown doesn't blow up the
// shallow toolbar render. (Same pattern as
// ChatInputToolbar.thinkingToggleMounted.test.tsx.)
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock FileAttachmentThumbnails — image-loading not relevant to this test.
vi.mock('@/features/chat/components/FileAttachmentThumbnails', () => ({
  default: () => null,
}));

import ChatInputToolbar from '@/features/chat/components/ChatInputToolbar';

function makeFileInputRef() {
  // Real <input type="file"> so we can spy on .click().
  const input = document.createElement('input');
  input.type = 'file';
  const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {
    /* noop — jsdom would open a native file picker we can't drive */
  });
  const ref = { current: input } as React.RefObject<HTMLInputElement>;
  return { ref, clickSpy };
}

const baseProps = {
  isAdmin: false,
  availableModels: [],
  onModelChange: vi.fn(),
  disabled: false,
};

describe('ChatInputToolbar — #941 claude.ai-style attach `+` button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the attach button at the LEFT edge with aria-label matching /attach/i', () => {
    const { ref } = makeFileInputRef();
    render(<ChatInputToolbar {...baseProps} fileInputRef={ref} />);

    const attachBtn = screen.getByTestId('chat-attach-button');
    expect(attachBtn).toBeInTheDocument();
    expect(attachBtn.getAttribute('aria-label') ?? '').toMatch(/attach/i);

    // First focusable button in the toolbar = the attach button.
    const allButtons = document.querySelectorAll(
      'button:not([disabled]), [role="switch"]:not([disabled])',
    );
    expect(allButtons.length).toBeGreaterThan(0);
    expect(allButtons[0]).toBe(attachBtn);
  });

  it('renders the `Plus` glyph (two perpendicular SVG `<line>` elements) inside the attach button', () => {
    const { ref } = makeFileInputRef();
    render(<ChatInputToolbar {...baseProps} fileInputRef={ref} />);

    const attachBtn = screen.getByTestId('chat-attach-button');
    const svg = attachBtn.querySelector('svg');
    expect(svg).toBeTruthy();
    const lines = svg!.querySelectorAll('line');
    // The Plus icon is exactly two `<line>` children — vertical + horizontal.
    expect(lines.length).toBe(2);
  });

  it('attach button container is CIRCULAR (rounded-full) — claude.ai pattern', () => {
    const { ref } = makeFileInputRef();
    render(<ChatInputToolbar {...baseProps} fileInputRef={ref} />);

    const attachBtn = screen.getByTestId('chat-attach-button');
    const cls = attachBtn.className;
    // claude.ai-style affordance is a circular pill, not a squared chip.
    expect(cls).toMatch(/\brounded-full\b/);
    expect(cls).not.toMatch(/\brounded-lg\b/);
  });

  it('clicking the attach button invokes .click() on the file input ref (opens picker)', () => {
    const { ref, clickSpy } = makeFileInputRef();
    render(<ChatInputToolbar {...baseProps} fileInputRef={ref} />);

    const attachBtn = screen.getByTestId('chat-attach-button');
    fireEvent.click(attachBtn);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
