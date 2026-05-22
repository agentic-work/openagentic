import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { SystemTextMessage } from '../SystemTextMessage';

afterEach(() => {
  cleanup();
});

describe('SystemTextMessage', () => {
  it('renders bridge_status with status text', () => {
    const { container } = render(
      <SystemTextMessage
        message={{
          subtype: 'bridge_status',
          content: 'Bridge connected to relay',
        }}
      />,
    );
    expect(
      container.querySelector('[data-part="system_bridge_status"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Bridge connected to relay/)).toBeInTheDocument();
  });

  it('renders turn_duration with elapsed time', () => {
    const { container } = render(
      <SystemTextMessage
        message={{ subtype: 'turn_duration', content: 'Turn took 12.4s' }}
      />,
    );
    expect(
      container.querySelector('[data-part="system_turn_duration"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Turn took 12\.4s/)).toBeInTheDocument();
  });

  it('renders thinking subtype', () => {
    const { container } = render(
      <SystemTextMessage
        message={{ subtype: 'thinking', content: 'Reasoning…' }}
      />,
    );
    expect(
      container.querySelector('[data-part="system_thinking"]'),
    ).not.toBeNull();
  });

  it('renders memory_saved with body', () => {
    const { container } = render(
      <SystemTextMessage
        message={{ subtype: 'memory_saved', content: 'Saved to CLAUDE.md' }}
      />,
    );
    expect(
      container.querySelector('[data-part="system_memory_saved"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Saved to CLAUDE\.md/)).toBeInTheDocument();
  });

  it('renders stop_hook_summary with summary', () => {
    const { container } = render(
      <SystemTextMessage
        message={{
          subtype: 'stop_hook_summary',
          content: '2 hooks ran in 850ms',
        }}
      />,
    );
    expect(
      container.querySelector('[data-part="system_stop_hook_summary"]'),
    ).not.toBeNull();
  });

  it('renders api_retry with attempt count', () => {
    const { container } = render(
      <SystemTextMessage
        message={{
          subtype: 'api_retry',
          content: 'Retrying after rate limit (attempt 1/3)',
        }}
      />,
    );
    expect(container.querySelector('[data-part="system_api_retry"]')).not.toBeNull();
  });

  it('renders generic system text for unknown subtype', () => {
    const { container } = render(
      <SystemTextMessage
        message={{ subtype: 'random_subtype', content: 'fallback body' }}
      />,
    );
    expect(container.querySelector('[data-part="system_generic"]')).not.toBeNull();
    expect(screen.getByText(/fallback body/)).toBeInTheDocument();
  });

  it('returns null for empty content with unknown subtype', () => {
    const { container } = render(
      <SystemTextMessage message={{ subtype: 'unknown' }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
