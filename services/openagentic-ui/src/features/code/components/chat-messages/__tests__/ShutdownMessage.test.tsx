import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  ShutdownRequestDisplay,
  ShutdownRejectedDisplay,
  tryRenderShutdownMessage,
  getShutdownMessageSummary,
} from '../ShutdownMessage';

afterEach(() => {
  cleanup();
});

describe('ShutdownRequestDisplay', () => {
  it('renders requester and reason', () => {
    const { container } = render(
      <ShutdownRequestDisplay
        request={{
          type: 'shutdown_request',
          from: 'leader',
          reason: 'cleaning up',
        }}
      />,
    );
    expect(container.querySelector('[data-part="shutdown_request"]')).not.toBeNull();
    expect(screen.getByText(/Shutdown request from leader/)).toBeInTheDocument();
    expect(screen.getByText(/cleaning up/)).toBeInTheDocument();
  });
});

describe('ShutdownRejectedDisplay', () => {
  it('renders rejecter and reason', () => {
    const { container } = render(
      <ShutdownRejectedDisplay
        response={{ type: 'shutdown_rejected', from: 'alice', reason: 'busy' }}
      />,
    );
    expect(container.querySelector('[data-part="shutdown_rejected"]')).not.toBeNull();
    expect(screen.getByText(/Shutdown rejected by alice/)).toBeInTheDocument();
  });
});

describe('tryRenderShutdownMessage', () => {
  it('returns a request node for shutdown_request JSON', () => {
    const json = JSON.stringify({ type: 'shutdown_request', from: 'a', reason: 'b' });
    expect(tryRenderShutdownMessage(json)).not.toBeNull();
  });

  it('returns null for shutdown_approved', () => {
    const json = JSON.stringify({ type: 'shutdown_approved', from: 'a' });
    expect(tryRenderShutdownMessage(json)).toBeNull();
  });

  it('returns null for unrelated content', () => {
    expect(tryRenderShutdownMessage('plain')).toBeNull();
  });
});

describe('getShutdownMessageSummary', () => {
  it('summarizes a request', () => {
    const json = JSON.stringify({ type: 'shutdown_request', from: 'a', reason: 'r' });
    expect(getShutdownMessageSummary(json)).toMatch(/Shutdown Request/);
  });
});
