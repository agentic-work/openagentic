/**
 * Phase 12 — SubAgentCard shows what the sub-agent is actually doing.
 *
 * Current card just shows "X turns Y tok Zs returned" with no insight.
 * Mock 01:1083-1133 + 04 / 06 / 09 show tools-used row + error strip +
 * running indicator + description on the head.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SubAgentCard } from '../SubAgentCard';

describe('SubAgentCard enriched (mocks 01:1083-1133, 04, 06, 09)', () => {
  it('renders cm-sa-tools row with one chip per tool when toolsUsed is present', () => {
    const { container } = render(
      <SubAgentCard
        name="Cost Analysis"
        role="cost-analysis"
        variant="c"
        status="ok"
        stats={{ turns: 5, tokens: 1247, wallMs: 3800 }}
        toolsUsed={['azure_cost_query', 'azure_retail_prices', 'render_diagram_v0']}
      />,
    );
    const tools = container.querySelector('.cm-sa-tools');
    expect(tools).not.toBeNull();
    const chips = container.querySelectorAll('.cm-sa-tool');
    expect(chips.length).toBe(3);
    expect(chips[0]).toHaveTextContent('azure_cost_query');
    expect(chips[2]).toHaveTextContent('render_diagram_v0');
  });

  it('renders running indicator when status is running', () => {
    const { container } = render(
      <SubAgentCard
        name="Cost Analysis"
        role="cost-analysis"
        variant="c"
        status="running"
      />,
    );
    expect(container.querySelector('.cm-sa-running')).not.toBeNull();
  });

  it('renders cm-sa-error strip with the error text when status is error', () => {
    const { container } = render(
      <SubAgentCard
        name="Cost Analysis"
        role="cost-analysis"
        variant="c"
        status="error"
        error="rate-limit exceeded after 3 retries"
      />,
    );
    const err = container.querySelector('.cm-sa-error');
    expect(err).not.toBeNull();
    expect(err).toHaveTextContent('rate-limit exceeded');
  });

  it('renders description when supplied', () => {
    const { container } = render(
      <SubAgentCard
        name="Cost Analysis"
        role="cost-analysis"
        description="right-size 23 idle VMs across 6 subscriptions"
        variant="c"
        status="ok"
      />,
    );
    expect(container.textContent).toContain('right-size 23 idle VMs');
  });

  it('omits cm-sa-tools when toolsUsed is empty', () => {
    const { container } = render(
      <SubAgentCard
        name="x" role="x" variant="c" status="ok"
        toolsUsed={[]}
      />,
    );
    expect(container.querySelector('.cm-sa-tools')).toBeNull();
  });
});
