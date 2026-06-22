/**
 * Phase 23 — StackGrid (mock 09 full-stack SaaS scaffold).
 *
 * Mock 09 anatomy:
 *   <div class="cm-stack-grid">
 *     <div class="cm-s">
 *       <div class="cm-role">Frontend</div>
 *       <div class="cm-t">React 18 + Vite 5</div>
 *       <div class="cm-meta">TanStack Query · Tailwind · Zustand</div>
 *     </div>
 *     ...
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StackGrid } from '../StackGrid';

const sample = [
  { role: 'Frontend', tech: 'React 18 + Vite 5', meta: 'TanStack Query · Tailwind · Zustand' },
  { role: 'Backend', tech: 'Fastify 4 + Prisma 5', meta: 'Zod · pino · graceful-shutdown' },
  { role: 'DB', tech: 'Postgres 16 + RLS', meta: 'tenant_id on every row' },
  { role: 'Cache', tech: 'Redis 7' },
];

describe('StackGrid (mock 09)', () => {
  it('renders cm-stack-grid with one cm-s cell per layer', () => {
    const { container } = render(<StackGrid layers={sample} />);
    expect(container.querySelector('.cm-stack-grid')).not.toBeNull();
    expect(container.querySelectorAll('.cm-stack-grid .cm-s').length).toBe(4);
  });

  it('renders cm-role + cm-t (tech) + cm-meta per cell', () => {
    const { container } = render(<StackGrid layers={sample} />);
    const cells = container.querySelectorAll('.cm-s');
    expect(cells[0].querySelector('.cm-role')).toHaveTextContent('Frontend');
    expect(cells[0].querySelector('.cm-t')).toHaveTextContent('React 18');
    expect(cells[0].querySelector('.cm-meta')).toHaveTextContent('TanStack Query');
  });

  it('omits cm-meta when meta is missing', () => {
    const { container } = render(<StackGrid layers={sample} />);
    const cells = container.querySelectorAll('.cm-s');
    expect(cells[3].querySelector('.cm-meta')).toBeNull();
  });

  it('renders nothing when layers empty', () => {
    const { container } = render(<StackGrid layers={[]} />);
    expect(container.querySelector('.cm-stack-grid')).toBeNull();
  });
});
