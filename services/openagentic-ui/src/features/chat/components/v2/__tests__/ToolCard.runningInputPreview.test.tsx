/**
 * Sev-0 #4 (Q1 live drive 2026-05-15) — "when tool calls DO run there is
 * still no short summary inline with them". ToolCard while status='running'
 * shows only "Running…" + timer + name — no signal of WHICH args were
 * passed. Mock 01 §863 shows live result summary AFTER ok'd; this test
 * adds a parallel contract for the RUNNING state: a short input preview
 * (e.g., "tenant: prod" / "subscription: abc") derived from the input
 * args so the user reads the gist without expanding mid-stream.
 *
 * The existing test `ToolCard.inlineResultSummary.test.tsx:102-108` pins
 * that the RESULT-derived summary stays OFF while running. This is a
 * separate contract on a separate DOM hook (data-testid="tool-running-
 * preview") so the two coexist without contradiction.
 *
 * Regression of #815.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCard } from '../ToolCard';

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* noop */ }
});

describe('ToolCard running input preview (Sev-0 #4, Q1 live drive 2026-05-15)', () => {
  it('renders preview when status=running and input has short string scalars', () => {
    const { container } = render(
      <ToolCard
        name="azure_list_subscriptions"
        status="running"
        input={{ tenant_id: 'phatold' }}
      />,
    );
    const preview = container.querySelector('[data-testid="tool-running-preview"]');
    expect(preview).toBeInTheDocument();
    expect(preview?.textContent).toMatch(/tenant_id/);
    expect(preview?.textContent).toMatch(/phatold/);
  });

  it('renders preview with multiple args as compact key list', () => {
    const { container } = render(
      <ToolCard
        name="azure_resource_graph_query"
        status="running"
        input={{ subscription_id: 'a', resource_group: 'rg-prod' }}
      />,
    );
    const preview = container.querySelector('[data-testid="tool-running-preview"]');
    expect(preview).toBeInTheDocument();
    // Should show first scalar value as preview, OR comma-list of keys
    const text = preview?.textContent ?? '';
    expect(text).toMatch(/subscription_id|resource_group/);
  });

  it('no preview rendered when status != running (do not pollute ok/err states)', () => {
    const { container: okC } = render(
      <ToolCard name="x" status="ok" input={{ tenant_id: 'foo' }} result={[1]} />,
    );
    expect(okC.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();

    const { container: errC } = render(
      <ToolCard name="x" status="err" input={{ tenant_id: 'foo' }} errorMessage="boom" />,
    );
    expect(errC.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();
  });

  it('no preview rendered when status=running but input is empty/null/undefined', () => {
    const { container: undefC } = render(
      <ToolCard name="x" status="running" />,
    );
    expect(undefC.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();

    const { container: nullC } = render(
      <ToolCard name="x" status="running" input={null} />,
    );
    expect(nullC.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();

    const { container: emptyC } = render(
      <ToolCard name="x" status="running" input={{}} />,
    );
    expect(emptyC.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();
  });

  it('truncates long scalar values so the inline preview stays one line', () => {
    const longVal = 'a'.repeat(200);
    const { container } = render(
      <ToolCard
        name="x"
        status="running"
        input={{ payload: longVal }}
      />,
    );
    const preview = container.querySelector('[data-testid="tool-running-preview"]');
    expect(preview).toBeInTheDocument();
    // Truncation target: 80 chars max for the value portion
    expect(preview?.textContent?.length ?? 0).toBeLessThan(120);
  });

  it('input with only object/array values (no scalars) falls back to key count', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="running"
        input={{ filters: { region: 'eastus' }, options: ['a', 'b'] }}
      />,
    );
    const preview = container.querySelector('[data-testid="tool-running-preview"]');
    expect(preview).toBeInTheDocument();
    // Either shows "2 args" or lists key names
    expect(preview?.textContent).toMatch(/2 args|filters|options/);
  });

  it('does NOT collide with the result-summary contract (existing test stays GREEN)', () => {
    // Existing inlineResultSummary test asserts status='running' + result={items:[1,2]}
    // does NOT show "2 items" in .cm-t-status text. Our new preview uses a
    // SEPARATE testid (tool-running-preview) so the two contracts coexist.
    const { container } = render(
      <ToolCard name="x" status="running" result={{ items: [1, 2] }} />,
    );
    const status = container.querySelector('.cm-t-status')?.textContent ?? '';
    expect(status).not.toMatch(/2 items/);
    // And the preview is absent because input is undefined.
    expect(container.querySelector('[data-testid="tool-running-preview"]')).not.toBeInTheDocument();
  });
});
