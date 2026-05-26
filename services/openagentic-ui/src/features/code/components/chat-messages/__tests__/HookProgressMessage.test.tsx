import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { HookProgressMessage } from '../HookProgressMessage';

afterEach(() => {
  cleanup();
});

describe('HookProgressMessage', () => {
  it('renders nothing when inProgressCount is 0', () => {
    const { container } = render(
      <HookProgressMessage hookEvent="Stop" inProgressCount={0} resolvedCount={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a transcript-mode summary for PreToolUse', () => {
    const { container } = render(
      <HookProgressMessage
        hookEvent="PreToolUse"
        inProgressCount={2}
        resolvedCount={2}
        isTranscriptMode={true}
      />,
    );
    expect(container.querySelector('[data-part="hook_progress"]')).not.toBeNull();
    expect(screen.getByText(/PreToolUse/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('returns null for PostToolUse outside transcript mode', () => {
    const { container } = render(
      <HookProgressMessage
        hookEvent="PostToolUse"
        inProgressCount={2}
        resolvedCount={1}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the running indicator for non-pre/post hooks when not all resolved', () => {
    const { container } = render(
      <HookProgressMessage
        hookEvent="Stop"
        inProgressCount={3}
        resolvedCount={1}
      />,
    );
    expect(container.querySelector('[data-part="hook_progress"]')).not.toBeNull();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/Stop/)).toBeInTheDocument();
  });

  it('renders nothing when all hooks have resolved', () => {
    const { container } = render(
      <HookProgressMessage
        hookEvent="Stop"
        inProgressCount={3}
        resolvedCount={3}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
