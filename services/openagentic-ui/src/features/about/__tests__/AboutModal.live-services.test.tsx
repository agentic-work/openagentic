/**
 * AboutModal — static behavior contract (OSS).
 *
 * The modal must NOT call any API — version info is static (build-time
 * __APP_VERSION__, derived from package.json = the canonical release). It
 * lists the 5 public platform services, shows the single platform version,
 * a copyright + Apache-2.0 line, and links to agenticwork.io.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/utils/api', () => ({
  apiEndpoint: (p: string) => (p.startsWith('/api') ? p : `/api${p}`),
}));

vi.mock('@/shared/components/OpenAgenticWordmark', () => ({
  OpenAgenticWordmark: () => <div data-testid="wordmark">[openagentic]</div>,
}));

afterEach(() => cleanup());

let AboutModal: typeof import('../AboutModal').default;
beforeEach(async () => {
  // Stub global.fetch so we can assert it is never called.
  global.fetch = vi.fn() as any;
  AboutModal = (await import('../AboutModal')).default;
});

describe('AboutModal — static (no live probes)', () => {
  it('renders without calling fetch', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renders the wordmark', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('wordmark')).toBeInTheDocument();
  });

  it('renders a version label in the header', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    // Header contains "v<version>" — at least "v1" should be present
    const vLabels = screen.getAllByText(/^v\d/);
    expect(vLabels.length).toBeGreaterThan(0);
  });

  it('shows the canonical 1.0.0 release version', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    // The build constant is not injected under vitest, so the modal renders
    // its canonical fallback — which must be the real release, not a stale
    // 0.x / dev sentinel.
    const vLabels = screen.getAllByText('v1.0.0');
    expect(vLabels.length).toBeGreaterThan(0);
  });

  it('lists the core services', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('UI')).toBeInTheDocument();
    expect(screen.getByText('MCP Proxy')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('shows a copyright + license line', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Agenticwork LLC/i)).toBeInTheDocument();
    expect(screen.getByText(/Apache License 2\.0/i)).toBeInTheDocument();
  });

  it('does NOT reference Code Mode', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText(/code mode/i)).not.toBeInTheDocument();
  });

  it('links to agenticwork.io', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    // createPortal renders into document.body — query from there
    const anchors = Array.from(document.body.querySelectorAll('a'));
    const agenticworkLinks = anchors.filter(a =>
      (a.getAttribute('href') ?? '').includes('agenticwork.io')
    );
    expect(agenticworkLinks.length).toBeGreaterThan(0);
  });

  it('does NOT link to gnomus.ai or openagentic.io', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    const anchors = Array.from(document.body.querySelectorAll('a'));
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      expect(href).not.toContain('gnomus.ai');
      expect(href).not.toContain('openagentic.io');
    }
  });

  it('does NOT render Gnomus or Umbrella text', () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByText(/Gnomus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Umbrella/i)).not.toBeInTheDocument();
  });

  it('renders nothing when isOpen=false', () => {
    const { container } = render(<AboutModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
