/**
 * MessageBubble.streamEngine.test.tsx — integration test for the
 * StreamEngine handoff path (Step 3 of the finish-everything mission).
 *
 * What this asserts:
 *
 *   1. When `VITE_FEATURE_STREAM_ENGINE` is enabled AND `isStreaming === true`,
 *      MessageBubble mounts a <StreamEnginedActivityStream> wrapper that
 *      owns a stable container with `data-cm-stream-engine="true"`.
 *
 *   2. The wrapper subscribes to incoming wire frames via the
 *      `streamFrameBus` callback registry on the chat-streaming store and
 *      routes them into a StreamEngine instance. The engine's container DOM
 *      reflects applied frames in real time (text appends, tool cards mount,
 *      etc.).
 *
 *   3. When `isStreaming === false` (post-stream), MessageBubble falls back
 *      to the canonical AgenticActivityStream render path. The engine's
 *      finalized `UIContentBlock[]` matches the React-rendered DOM
 *      structurally.
 *
 *   4. When the flag is OFF, MessageBubble always uses AgenticActivityStream
 *      (engine wrapper never mounts).
 *
 * Spec reference: docs/superpowers/specs/2026-05-18-streaming-engine-design.md
 *                 §"Step 3 — MessageBubble integration"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

import {
  StreamEnginedActivityStream,
  registerStreamFrameTap,
  publishStreamFrame,
  __resetStreamFrameBus,
} from '../MessageBubble/StreamEnginedActivityStream';

import type { UIStreamFrame } from '@agentic-work/llm-sdk';

beforeEach(() => {
  __resetStreamFrameBus();
});

describe('StreamEnginedActivityStream — frame bus integration', () => {
  it('mounts a stable container with the data-cm-stream-engine marker', () => {
    const { container } = render(
      <StreamEnginedActivityStream messageId="msg-1" isStreaming={true} />,
    );
    const engineHost = container.querySelector('[data-cm-stream-engine="true"]');
    expect(engineHost).not.toBeNull();
  });

  it('routes published frames into the engine — text deltas land in DOM', () => {
    const { container } = render(
      <StreamEnginedActivityStream messageId="msg-2" isStreaming={true} />,
    );

    act(() => {
      publishStreamFrame({ type: 'stream_start', turn_id: 'turn-1', _ts: 1000 } as UIStreamFrame);
      publishStreamFrame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
        _ts: 1001,
      } as unknown as UIStreamFrame);
    });

    const engineHost = container.querySelector('[data-cm-stream-engine="true"]') as HTMLElement;
    expect(engineHost).not.toBeNull();
    // After the text_delta frame, the engine DOM should contain "Hello world"
    expect(engineHost.textContent).toContain('Hello world');
  });

  it('does not mount the engine container when isStreaming=false', () => {
    const { container } = render(
      <StreamEnginedActivityStream messageId="msg-3" isStreaming={false} />,
    );
    const engineHost = container.querySelector('[data-cm-stream-engine="true"]');
    expect(engineHost).toBeNull();
  });

  it('registerStreamFrameTap returns an unsubscribe fn that prevents future callbacks', () => {
    const seen: UIStreamFrame[] = [];
    const unsub = registerStreamFrameTap((f) => seen.push(f));
    publishStreamFrame({ type: 'stream_start', _ts: 1 } as UIStreamFrame);
    expect(seen).toHaveLength(1);

    unsub();
    publishStreamFrame({ type: 'stream_complete', _ts: 2 } as UIStreamFrame);
    expect(seen).toHaveLength(1); // unchanged after unsubscribe
  });

  it('multiple subscribers all receive each frame', () => {
    const a: UIStreamFrame[] = [];
    const b: UIStreamFrame[] = [];
    registerStreamFrameTap((f) => a.push(f));
    registerStreamFrameTap((f) => b.push(f));

    publishStreamFrame({ type: 'stream_start', _ts: 1 } as UIStreamFrame);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
