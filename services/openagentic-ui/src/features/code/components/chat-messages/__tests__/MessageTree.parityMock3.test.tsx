import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { MessageRow } from '../MessageTree';
import type {
  AssistantChatMessage,
  UiTextBlock,
  UiThinkingBlock,
} from '../../../types/uiState';

afterEach(() => {
  cleanup();
});

function asstWith(blocks: AssistantChatMessage['blocks']): AssistantChatMessage {
  return {
    id: 'a-mock3',
    role: 'assistant',
    blocks,
    createdAt: 0,
  };
}

const txt = (s: string): UiTextBlock => ({ kind: 'text', text: s });

function think(s: string): UiThinkingBlock {
  return { kind: 'thinking', thinking: s, streaming: false };
}

describe('MessageTree mock-3 parity — inline stage badges in <li>', () => {
  it('renders OBSERVE: in a list item with the cm-stage observe / react-stage-observe badge', () => {
    const md = [
      'Confirmed two distinct modes:',
      '',
      '- OBSERVE: "What is 2+2?" — model uses content channel for "4"',
      '- OBSERVE: capital of France — model emits answer through thinking channel',
    ].join('\n');
    const m = asstWith([txt(md)]);
    const { container } = render(<MessageRow message={m} />);

    // Two <li> with leading OBSERVE: marker → two badges
    const badges = container.querySelectorAll('.react-stage-observe');
    expect(badges.length).toBe(2);
    // The badge label text:
    expect(badges[0].textContent).toBe('OBSERVE');
  });

  it('renders PLAN/ACT/REFLECT/VERIFY all as li-level stage badges', () => {
    const md = [
      '- PLAN: scope the work',
      '- ACT: write the code',
      '- REFLECT: review against tests',
      '- VERIFY: rerun green',
    ].join('\n');
    const m = asstWith([txt(md)]);
    const { container } = render(<MessageRow message={m} />);

    expect(container.querySelectorAll('.react-stage-plan').length).toBe(1);
    expect(container.querySelectorAll('.react-stage-act').length).toBe(1);
    expect(container.querySelectorAll('.react-stage-reflect').length).toBe(1);
    expect(container.querySelectorAll('.react-stage-verify').length).toBe(1);
  });

  it('does NOT render a badge for non-stage list items', () => {
    const md = '- Hello world\n- Another item';
    const m = asstWith([txt(md)]);
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelectorAll('[class*="react-stage-"]').length).toBe(0);
  });
});

describe('MessageTree mock-3 parity — rainbow inline-code in thinking', () => {
  it('assigns cm-rkw1..7 round-robin to inline `code` spans inside a thinking block', () => {
    // Simulate gpt-oss-style thinking with multiple inline backticks.
    const md = [
      'User reports a `silent-zero-tokens` regression on `/v1/messages` when',
      'the active model is `gpt-oss:20b`. Two channels in `message.content`',
      'and `message.thinking`. Plan: read `OllamaProvider`, then write a',
      'red `vitest` test, then `bun test` to confirm green.',
    ].join(' ');
    const block: UiThinkingBlock = think(md);
    const m = asstWith([block]);
    const { container } = render(<MessageRow message={m} />);

    // 2026-05-07: ThinkingRow now defaults COLLAPSED (matches openagentic
    // TUI's `∴ Thinking <Ctrl-O to expand>` UX). Click the header to
    // expand the body so the rainbow-tinted code spans render.
    const toggle = container.querySelector('button');
    if (toggle) fireEvent.click(toggle);

    // Confirm thinking body rendered (the marker class on the row exists)
    // by finding any cm-rkw* span at all.
    const rainbowSpans = container.querySelectorAll('[class*="cm-rkw"]');
    // Seven distinct backticks above → at least 6 rainbow-tinted spans
    // (we round-robin 1..7 so the seventh wraps back to 1).
    expect(rainbowSpans.length).toBeGreaterThanOrEqual(6);

    // First class should be cm-rkw1, second cm-rkw2 (round-robin).
    const classes = Array.from(rainbowSpans).map((el) => (el as HTMLElement).className);
    expect(classes[0]).toContain('cm-rkw1');
    expect(classes[1]).toContain('cm-rkw2');
    expect(classes[2]).toContain('cm-rkw3');
  });

  it('does NOT rainbow-tint inline-code inside ASSISTANT TEXT (only thinking)', () => {
    const md = 'Quick note about `OllamaProvider` and `gpt-oss:20b`.';
    const m = asstWith([txt(md)]);
    const { container } = render(<MessageRow message={m} />);
    expect(container.querySelectorAll('[class*="cm-rkw"]').length).toBe(0);
  });
});
