/**
 * Phase 3 of universal-anatomy parity — ToolCard expanded-by-default.
 *
 * Mock 10:257-282 shows the completed `azure_cost_management_query` tool
 * card EXPANDED with INPUT + RESULT JSON panels visible. Current default
 * collapses ok'd tools — flip the default so the most recent ok tool with
 * structured data is open.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCard } from '../ToolCard';

beforeEach(() => {
  // Wipe persisted state from earlier tests to avoid bleed.
  try { sessionStorage.clear(); } catch { /* noop */ }
});

describe('ToolCard expanded-by-default for ok+structured (mock 10:257-282)', () => {
  it('renders aria-expanded=true when status=ok and result is an object', () => {
    const { container } = render(
      <ToolCard
        name="azure_cost_management_query"
        status="ok"
        durationLabel="1.84s"
        input={{ subscriptions: ['prod'] }}
        result={{ rows: [{ rg: 'core-api', usd: 12450 }] }}
      />,
    );
    const root = container.querySelector('.cm-tool');
    expect(root).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders aria-expanded=true when status=ok and result is an array', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="ok"
        result={[{ a: 1 }, { a: 2 }]}
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders aria-expanded=false when status=ok but result is plain string', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="ok"
        result="plain text result"
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders both INPUT + RESULT cm-t-section panels when expanded', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="ok"
        input={{ q: 1 }}
        result={{ a: 1 }}
      />,
    );
    expect(container.querySelector('[data-testid="tool-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-result"]')).not.toBeNull();
  });

  it('respects explicit defaultExpanded=false override', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="ok"
        result={{ a: 1 }}
        defaultExpanded={false}
      />,
    );
    expect(container.querySelector('.cm-tool')).toHaveAttribute('aria-expanded', 'false');
  });
});
