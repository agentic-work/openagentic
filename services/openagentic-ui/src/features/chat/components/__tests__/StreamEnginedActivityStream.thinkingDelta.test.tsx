/**
 * 3-Sev-0 Bug #2 companion — engine-side live-thinking render contract.
 *
 * Bug #2 ("streaming is not rendered") was confirmed on the dev environment to be a
 * symptom of Bug #1's dual-render — the user saw two overlapping renders
 * during streaming and perceived the live stream as broken. The fix in
 * MessageBubble.streamEngineDualRenderGuard.test.tsx forces the engine
 * to be the SOLE live painter.
 *
 * This test pins the engine's own painting contract: when a
 * `content_block_delta` frame with `thinking_delta` is published, the
 * engine host MUST contain a thinking-block DOM node carrying the
 * accumulated thinking text. If the engine stops painting thinking, the
 * dual-render guard above leaves the user with NO live render at all —
 * worse than before.
 *
 * RED before: this test passes only because the engine already renders
 * thinking. Treat as a regression cage — the test fails if anyone
 * silently rips the thinking branch from StreamEngine.applyFrame.
 *
 * Sister test: MessageBubble.streamEngine.test.tsx (covers text_delta).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import {
  StreamEnginedActivityStream,
  publishStreamFrame,
  __resetStreamFrameBus,
} from '../MessageBubble/StreamEnginedActivityStream';

import type { UIStreamFrame } from '@agentic-work/llm-sdk';

beforeEach(() => {
  __resetStreamFrameBus();
});

describe('StreamEnginedActivityStream — engine-only live thinking render (3-Sev-0 #2 cage)', () => {
  it('routes thinking_delta frames into the engine host as a thinking block', () => {
    const { container } = render(
      <StreamEnginedActivityStream messageId="msg-thinking" isStreaming={true} />,
    );

    act(() => {
      publishStreamFrame({ type: 'stream_start', turn_id: 'turn-think', _ts: 1000 } as UIStreamFrame);
      publishStreamFrame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Hmm, let me consider RFC 6749' },
        _ts: 1001,
      } as unknown as UIStreamFrame);
    });

    const engineHost = container.querySelector('[data-cm-stream-engine="true"]') as HTMLElement;
    expect(engineHost).not.toBeNull();
    // The engine must produce a thinking-block DOM node carrying the
    // accumulated thinking text — this is the SOLE live painter once the
    // dual-render guard zeros AAS's contentBlocks during streaming.
    const thinkingBlock = engineHost.querySelector('[data-block-type="thinking"]');
    expect(thinkingBlock).not.toBeNull();
    expect((thinkingBlock as HTMLElement).textContent).toContain('Hmm, let me consider RFC 6749');
  });

  it('accumulates multiple thinking deltas into a single thinking block', () => {
    const { container } = render(
      <StreamEnginedActivityStream messageId="msg-acc" isStreaming={true} />,
    );

    act(() => {
      publishStreamFrame({ type: 'stream_start', turn_id: 'turn-acc', _ts: 2000 } as UIStreamFrame);
      publishStreamFrame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'one ' },
        _ts: 2001,
      } as unknown as UIStreamFrame);
      publishStreamFrame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'two ' },
        _ts: 2002,
      } as unknown as UIStreamFrame);
      publishStreamFrame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'three' },
        _ts: 2003,
      } as unknown as UIStreamFrame);
    });

    const engineHost = container.querySelector('[data-cm-stream-engine="true"]') as HTMLElement;
    const thinkingBlocks = engineHost.querySelectorAll('[data-block-type="thinking"]');
    // The engine must accumulate into ONE block, not create three. The body
    // text content must be the full concatenation.
    expect(thinkingBlocks.length).toBe(1);
    expect((thinkingBlocks[0] as HTMLElement).textContent).toContain('one two three');
  });
});
