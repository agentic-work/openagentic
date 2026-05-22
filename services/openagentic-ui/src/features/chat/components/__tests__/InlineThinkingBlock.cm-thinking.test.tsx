/**
 * Phase 2 of the cm-v2 mock-parity migration — InlineThinkingBlock.
 *
 * Mock anatomy: chatmode-v2.css:230-252 + mocks/UX/01-cloud-ops.html:230-252
 *   <div class="cm-thinking" aria-expanded="true|false">
 *     <button class="cm-head">
 *       <Icon class="cm-ico" />
 *       <span class="cm-label">Thinking…</span>
 *       <Chevron class="cm-chev" />
 *     </button>
 *     <div class="cm-body"><pre>...</pre></div>
 *   </div>
 *
 * The "natural" variant is the live render path in chatmode (default
 * + only one called by MessageBubble + AgenticActivityStream). This
 * test freezes that path on the cm-thinking class hierarchy so the
 * canonical CSS in chatmode-v2.css fires.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { InlineThinkingBlock } from '../InlineThinkingBlock';

describe('InlineThinkingBlock cm-thinking anatomy (mock 01:230-252)', () => {
  it('renders cm-thinking on the outer container', () => {
    const { container } = render(
      <InlineThinkingBlock
        content="step 1"
        isStreaming={false}
        startedAt={1_000}
        endedAt={3_000}
      />,
    );
    const root = container.querySelector('.cm-thinking');
    expect(root).not.toBeNull();
  });

  it('puts aria-expanded on the cm-thinking outer container', () => {
    const { container } = render(
      <InlineThinkingBlock content="x" isStreaming={false} startedAt={1} endedAt={2} />,
    );
    const root = container.querySelector('.cm-thinking') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders cm-head button + cm-ico + cm-label + cm-chev', () => {
    const { container } = render(
      <InlineThinkingBlock content="x" isStreaming={false} startedAt={1} endedAt={2} />,
    );
    const root = container.querySelector('.cm-thinking') as HTMLElement;
    expect(root.querySelector('.cm-head')).not.toBeNull();
    expect(root.querySelector('.cm-ico')).not.toBeNull();
    expect(root.querySelector('.cm-label')).not.toBeNull();
    expect(root.querySelector('.cm-chev')).not.toBeNull();
  });

  it('toggles aria-expanded + reveals cm-body when the head is clicked', () => {
    const { container, getByTestId } = render(
      <InlineThinkingBlock content="step 1" isStreaming={false} startedAt={1} endedAt={2} />,
    );
    const root = container.querySelector('.cm-thinking') as HTMLElement;
    expect(root).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(getByTestId('inline-thinking-toggle'));
    expect(root).toHaveAttribute('aria-expanded', 'true');
    expect(root.querySelector('.cm-body')).not.toBeNull();
  });
});
