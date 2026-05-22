/**
 * AboutModal — live cluster services contract.
 *
 * The modal must render real deployed-service rows from
 * GET /api/cluster/services (NOT the static version.json snapshot).
 * Gnomus / umbrella-org references must be gone.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

const FIXTURE = {
  release: {
    version: '0.7.0',
    codename: 'Quasar',
    releaseDate: '2026-04-25',
  },
  namespace: 'agentic-dev',
  scrapedAt: '2026-04-26T12:00:00.000Z',
  services: [
    {
      name: 'openagentic-ui',
      displayName: 'UI',
      kind: 'Deployment',
      image: 'ghcr.io/foo/openagentic-ui:0.7.0-c2fbcc06',
      imageDigest: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      tag: '0.7.0-c2fbcc06',
      shaShort: '12345678',
      replicas: { desired: 2, ready: 2, available: 2 },
      status: 'available',
      lastTransitionTime: null,
      labels: {},
      category: 'core',
      edges: [],
    },
    {
      name: 'openagentic-api',
      displayName: 'API',
      kind: 'Deployment',
      image: 'ghcr.io/foo/openagentic-api:0.7.0-c2fbcc06',
      imageDigest: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      tag: '0.7.0-c2fbcc06',
      shaShort: 'abcdef12',
      replicas: { desired: 1, ready: 1, available: 1 },
      status: 'available',
      lastTransitionTime: null,
      labels: {},
      category: 'core',
      edges: [],
    },
    {
      name: 'openagentic-mcp-proxy',
      displayName: 'MCP Proxy',
      kind: 'Deployment',
      image: 'ghcr.io/foo/openagentic-mcp-proxy:0.7.0-c2fbcc06',
      imageDigest: 'sha256:fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
      tag: '0.7.0-c2fbcc06',
      shaShort: 'fedcba09',
      replicas: { desired: 1, ready: 1, available: 1 },
      status: 'available',
      lastTransitionTime: null,
      labels: {},
      category: 'mcp',
      edges: [],
    },
    {
      name: 'pgvector-postgresql-primary',
      displayName: 'Postgres (pgvector)',
      kind: 'StatefulSet',
      image: 'docker.io/bitnami/postgresql:16.4.0',
      imageDigest: 'sha256:0011223344556677001122334455667700112233445566770011223344556677',
      tag: '16.4.0',
      shaShort: '00112233',
      replicas: { desired: 1, ready: 1, available: 1 },
      status: 'available',
      lastTransitionTime: null,
      labels: {},
      category: 'data',
      edges: [],
    },
  ],
};

afterEach(() => cleanup());

let AboutModal: typeof import('../AboutModal').default;
beforeEach(async () => {
  AboutModal = (await import('../AboutModal')).default;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => FIXTURE,
  }) as any;
});

describe('AboutModal — live cluster services', () => {
  it('renders a row for openagentic-ui with image tag and digest short hex', async () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      // tag is rendered somewhere
      expect(screen.getAllByText(/0\.7\.0-c2fbcc06/).length).toBeGreaterThan(0);
    });
    // digest short — at least 7 hex chars from the imageDigest of openagentic-ui
    // (we render 12 chars: "123456789012")
    expect(screen.getByText(/^123456789/)).toBeInTheDocument();
  });

  it('renders rows from at least 3 different categories', async () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/^CORE$/)).toBeInTheDocument();
    });
    expect(screen.getByText(/^MCP$/)).toBeInTheDocument();
    expect(screen.getByText(/^DATA$/)).toBeInTheDocument();
  });

  it('does NOT render "Built with care by Gnomus"', async () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/0\.7\.0-c2fbcc06/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Built with care by Gnomus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gnomus/i)).not.toBeInTheDocument();
  });

  it('does NOT render "Umbrella" or openagentic.io / gnomus.ai links', async () => {
    const { container } = render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getAllByText(/0\.7\.0-c2fbcc06/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Umbrella/i)).not.toBeInTheDocument();
    const anchors = container.querySelectorAll('a');
    for (const a of Array.from(anchors)) {
      const href = a.getAttribute('href') || '';
      expect(href).not.toContain('gnomus.ai');
      expect(href).not.toContain('openagentic.io');
    }
  });

  it('renders version + codename from response release block in header', async () => {
    render(<AboutModal isOpen={true} onClose={vi.fn()} />);
    // Header renders something like: v0.7.0 "Quasar"
    await waitFor(() => {
      expect(screen.getByText(/v0\.7\.0\s*"Quasar"/)).toBeInTheDocument();
    });
  });
});
