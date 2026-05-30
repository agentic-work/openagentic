/**
 * ToolCard cost-summary preview (mocks/UX/AI/Chatmode/end-state-07 lines
 * 77-79, 190, 201, 212). When a tool is in the cost family and the
 * result has the {last30, prior30} shape:
 *   - head shows "· $X last 30d" instead of the generic resultSummary
 *   - RESULT panel renders the 4-span strip (30d / prior / Δ / pct)
 *   - JsonView is suppressed for that section
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  ToolCard,
  classifyToolCategory,
  extractCostDelta,
  formatCostDeltaPreview,
  isCostTool,
} from '../ToolCard';

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* noop */ }
});

describe('ToolCard mock-07 cost preview (helpers)', () => {
  it('extractCostDelta accepts {last30, prior30}', () => {
    expect(extractCostDelta({ last30: 42118, prior30: 28943 })).toEqual({
      last30: 42118,
      prior30: 28943,
    });
  });

  it('extractCostDelta accepts {window_total, prior_window_total}', () => {
    expect(
      extractCostDelta({ window_total: 100, prior_window_total: 80 }),
    ).toEqual({ last30: 100, prior30: 80 });
  });

  it('extractCostDelta returns null on missing fields', () => {
    expect(extractCostDelta({ last30: 42 })).toBeNull();
    expect(extractCostDelta(null)).toBeNull();
    expect(extractCostDelta('not an object')).toBeNull();
    expect(extractCostDelta({ subscriptions: [] })).toBeNull();
  });

  it('isCostTool matches cost/billing/spend (case-insensitive)', () => {
    expect(isCostTool('azure_cost_query')).toBe(true);
    expect(isCostTool('aws_cost_explorer')).toBe(true);
    expect(isCostTool('gcp_billing_query')).toBe(true);
    expect(isCostTool('something_about_spend')).toBe(true);
    expect(isCostTool('AZURE_LIST_SUBSCRIPTIONS')).toBe(false);
    expect(isCostTool('')).toBe(false);
  });

  it('classifyToolCategory routes by prefix', () => {
    expect(classifyToolCategory('azure_cost_query')).toBe('azure');
    expect(classifyToolCategory('aws_cost_explorer')).toBe('aws');
    expect(classifyToolCategory('gcp_billing_query')).toBe('gcp');
    expect(classifyToolCategory('k8s_get_pods')).toBe('k8s');
    expect(classifyToolCategory('kubectl_top')).toBe('k8s');
    expect(classifyToolCategory('vertex_predict')).toBe('gcp');
    expect(classifyToolCategory('unknown_tool')).toBe('default');
    expect(classifyToolCategory('')).toBe('default');
  });

  it('formatCostDeltaPreview returns null when shape misses', () => {
    expect(formatCostDeltaPreview({ subscriptions: [] })).toBeNull();
  });
});

describe('ToolCard mock-07 cost preview (render contract)', () => {
  it('renders the cost-delta strip inside RESULT for cost tools', () => {
    const { getByTestId } = render(
      <ToolCard
        name="azure_cost_query"
        status="ok"
        result={{ last30: 42118, prior30: 28943 }}
      />,
    );
    const strip = getByTestId('cost-delta-preview');
    expect(strip.textContent).toContain('30d');
    expect(strip.textContent).toContain('$42,118');
    expect(strip.textContent).toContain('prior');
    expect(strip.textContent).toContain('$28,943');
    expect(strip.textContent).toContain('Δ');
    expect(strip.textContent).toContain('+$13,175');
    expect(strip.textContent).toContain('+45.5%');
  });

  it('puts a "$X last 30d" pill in the head status', () => {
    const { getByTestId } = render(
      <ToolCard
        name="aws_cost_explorer"
        status="ok"
        result={{ last30: 61402, prior30: 43810 }}
      />,
    );
    expect(getByTestId('cost-head-summary').textContent).toMatch(
      /\$61,402 last 30d/,
    );
  });

  it('paints data-tool-cat=azure on .cm-tool for azure_* tools', () => {
    const { container } = render(
      <ToolCard name="azure_cost_query" status="ok" result={{}} />,
    );
    const card = container.querySelector('.cm-tool');
    expect(card?.getAttribute('data-tool-cat')).toBe('azure');
  });

  it('paints data-tool-cat=aws on .cm-tool for aws_* tools', () => {
    const { container } = render(
      <ToolCard name="aws_cost_explorer" status="ok" result={{}} />,
    );
    expect(container.querySelector('.cm-tool')?.getAttribute('data-tool-cat')).toBe('aws');
  });

  it('falls back to default category + JsonView for non-cost tools', () => {
    const { queryByTestId, container } = render(
      <ToolCard
        name="azure_list_subscriptions"
        status="ok"
        result={{ subscriptions: [{ id: 'a' }, { id: 'b' }] }}
      />,
    );
    expect(queryByTestId('cost-delta-preview')).toBeNull();
    expect(queryByTestId('cost-head-summary')).toBeNull();
    // The non-cost path keeps the generic resultSummary pill.
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/2 subscriptions/);
  });
});
