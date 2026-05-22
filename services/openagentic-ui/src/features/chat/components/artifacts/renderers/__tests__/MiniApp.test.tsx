/**
 * #781 Phase C6 — MiniApp renderer tests.
 *
 * Sandbox-backed executable mini-app: iframe to /api/synth/mini-app/<exec_id>
 * + provenance panel (capabilities[], CPU/RAM caps, TTL countdown, exec id).
 * Stripe/Linear/Figma technical-light aesthetic (mock 10).
 *
 * Contract: capabilities outside declared list = structured error in body,
 * not silent execution. TTL expiry = "Session expired" CTA, not silent fail.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MiniApp } from '../MiniApp.js';

describe('MiniApp renderer — #781 Phase C6', () => {
  it('renders an iframe pointing at /api/synth/mini-app/<exec_id>', () => {
    const { container } = render(
      <MiniApp
        execId="synth-abc-123"
        capabilities={['cost-query']}
        caps={{ cpu: 1.0, ramMiB: 256, ttlSec: 300 }}
      />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', '/api/synth/mini-app/synth-abc-123');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  });

  it('renders the provenance panel with capabilities + CPU + RAM + TTL', () => {
    render(
      <MiniApp
        execId="x"
        capabilities={['cost-query', 'data']}
        caps={{ cpu: 0.5, ramMiB: 128, ttlSec: 240 }}
      />,
    );
    expect(screen.getByTestId('miniapp-provenance')).toBeInTheDocument();
    expect(screen.getByText(/cost-query/)).toBeInTheDocument();
    expect(screen.getByText(/data/)).toBeInTheDocument();
    expect(screen.getByText(/0\.5/)).toBeInTheDocument();
    expect(screen.getByText(/128/)).toBeInTheDocument();
    expect(screen.getByText(/240/)).toBeInTheDocument();
  });

  it('shows TTL countdown that decrements every second', () => {
    vi.useFakeTimers();
    render(
      <MiniApp execId="x" capabilities={[]} caps={{ cpu: 1, ramMiB: 256, ttlSec: 10 }} />,
    );
    expect(screen.getByTestId('miniapp-ttl')).toHaveTextContent('10');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('miniapp-ttl')).toHaveTextContent('7');
    vi.useRealTimers();
  });

  it('shows session-expired CTA after TTL hits 0', () => {
    vi.useFakeTimers();
    render(
      <MiniApp execId="x" capabilities={[]} caps={{ cpu: 1, ramMiB: 256, ttlSec: 2 }} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('miniapp-expired')).toBeInTheDocument();
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('error prop shows structured error in body', () => {
    render(
      <MiniApp
        execId="x"
        capabilities={['gcp']}
        caps={{ cpu: 1, ramMiB: 256, ttlSec: 300 }}
        error="Capability 'gcp' not in declared scope"
      />,
    );
    expect(screen.getByTestId('miniapp-error')).toBeInTheDocument();
    expect(screen.getByText(/not in declared scope/)).toBeInTheDocument();
  });
});
