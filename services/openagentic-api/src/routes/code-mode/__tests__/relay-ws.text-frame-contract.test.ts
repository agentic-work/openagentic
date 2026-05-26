/**
 * Contract: the relay MUST forward the pod daemon's stream-json NDJSON as
 * TEXT WebSocket frames, not binary. The browser-side hook
 * (`useCodeModeChat.onmessage`) branches on `typeof event.data === 'string'`
 * and drops anything else — so binary frames silently kill streaming.
 *
 * Observed live: daemon emits text lines, Node `ws` forwards a `Buffer`
 * (RawData) as a BINARY frame by default. Browser receives Blob. Hook
 * returns early. User sees "Analyzing..." forever even though the round-
 * trip is otherwise healthy.
 *
 * Fix: coerce RawData → UTF-8 string before `browserWs.send()`.
 */

import { describe, it, expect, vi } from 'vitest';
import { forwardDaemonFrameToBrowser } from '../relay-ws.handler.js';

describe('relay-ws: daemon → browser frame forwarding', () => {
  it('forwards a Buffer as a string (text frame), not binary', () => {
    const browserWs = {
      readyState: 1, // OPEN
      send: vi.fn(),
    };
    const ndjsonLine = '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}}\n';
    const bufFromDaemon = Buffer.from(ndjsonLine, 'utf8');

    forwardDaemonFrameToBrowser(bufFromDaemon, browserWs as any);

    expect(browserWs.send).toHaveBeenCalledTimes(1);
    const arg = browserWs.send.mock.calls[0][0];
    expect(typeof arg).toBe('string');
    expect(arg).toBe(ndjsonLine);
  });

  it('forwards an ArrayBuffer as a string too', () => {
    const browserWs = { readyState: 1, send: vi.fn() };
    const txt = '{"type":"result","total_cost_usd":0.0001}\n';
    const ab = new TextEncoder().encode(txt).buffer;

    forwardDaemonFrameToBrowser(ab, browserWs as any);

    expect(browserWs.send).toHaveBeenCalledTimes(1);
    expect(browserWs.send.mock.calls[0][0]).toBe(txt);
  });

  it('skips send when browserWs is not OPEN', () => {
    const browserWs = { readyState: 3, send: vi.fn() }; // CLOSED
    forwardDaemonFrameToBrowser(Buffer.from('{}'), browserWs as any);
    expect(browserWs.send).not.toHaveBeenCalled();
  });

  it('tolerates send() throwing without propagating', () => {
    const browserWs = {
      readyState: 1,
      send: vi.fn(() => { throw new Error('socket gone'); }),
    };
    expect(() =>
      forwardDaemonFrameToBrowser(Buffer.from('{}'), browserWs as any),
    ).not.toThrow();
  });

  it('handles array-of-buffers RawData by concatenating and decoding', () => {
    const browserWs = { readyState: 1, send: vi.fn() };
    const a = Buffer.from('{"type":"str', 'utf8');
    const b = Buffer.from('eam_event"}\n', 'utf8');
    forwardDaemonFrameToBrowser([a, b], browserWs as any);
    expect(browserWs.send).toHaveBeenCalledWith('{"type":"stream_event"}\n');
  });
});
