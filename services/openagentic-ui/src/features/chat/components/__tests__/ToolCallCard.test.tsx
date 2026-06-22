/**
 * ToolCallCard — v2 adapter contract.
 *
 * The thin adapter at AgenticActivityStream/components/ToolCallCard.tsx
 * forwards inputDeltaContent / toolInput / toolOutput / status / duration
 * into v2/ToolCard. This test pins the v2 contract:
 *   - .cm-tool wrapper with data-tool-status
 *   - INPUT section visible while running
 *   - INPUT carries the streaming JSON content (raw delta or parsed)
 *   - status='success' maps to ToolStatus 'ok'
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCallCard } from '../AgenticActivityStream/components/ToolCallCard';

function getCard(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-tool-card]') as HTMLElement | null;
  if (!el) throw new Error('v2 ToolCard not rendered');
  return el;
}

describe('ToolCallCard (v2 adapter contract)', () => {
  it('renders a v2 .cm-tool with running status while status="calling"', () => {
    const { container } = render(
      <ToolCallCard
        toolName="list_pods"
        toolInput={undefined}
        status="calling"
        inputDeltaContent={'{"ns":'}
        startTime={Date.now()}
      />
    );
    const card = getCard(container);
    expect(card.getAttribute('data-tool-status')).toBe('running');
    expect(card.getAttribute('data-tool-name')).toBe('list_pods');
  });

  it('streams the delta content into the INPUT panel while running', () => {
    render(
      <ToolCallCard
        toolName="list_pods"
        toolInput={undefined}
        status="calling"
        inputDeltaContent={'{"ns":"default"}'}
        startTime={Date.now()}
      />
    );
    const inputSection = screen.getByTestId('tool-input');
    expect(inputSection.textContent).toContain('ns');
    expect(inputSection.textContent).toContain('default');
  });

  it('maps status="success" to v2 ToolStatus "ok"', () => {
    const { container } = render(
      <ToolCallCard
        toolName="list_pods"
        toolInput={{ ns: 'default' }}
        status="success"
        startTime={Date.now()}
        duration={1200}
        toolOutput={{ count: 0 }}
      />
    );
    const card = getCard(container);
    expect(card.getAttribute('data-tool-status')).toBe('ok');
  });

  it('maps status="error" to v2 ToolStatus "err"', () => {
    const { container } = render(
      <ToolCallCard
        toolName="list_pods"
        toolInput={{ ns: 'default' }}
        status="error"
        startTime={Date.now()}
        duration={1200}
      />
    );
    const card = getCard(container);
    expect(card.getAttribute('data-tool-status')).toBe('err');
  });
});
