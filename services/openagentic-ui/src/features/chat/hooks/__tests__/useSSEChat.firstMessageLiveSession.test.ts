/**
 * useSSEChat — first-message-of-a-new-chat live-render regression.
 *
 * THE BUG (OSS): on the FIRST send of a brand-new chat, ChatContainer's
 * `activeSessionId` closure is still '' because createNewSession() sets the
 * store's activeSessionId asynchronously (it hasn't re-rendered the hook yet).
 * The hook used to post that stale '' on the wire (or bail on the empty-id
 * guard), so the backend never streamed and the user saw a spinner until they
 * reloaded — at which point the id was already hydrated.
 *
 * THE UPSTREAM FIX (agenticwork useChatStream.ts:409-412 → ported to
 * useSSEChat.ts): inside sendMessage, resolve the session id LIVE from the
 * store (`useChatStore.getState().activeSessionId`) and SHADOW the prop, so the
 * /chat/stream POST targets the freshly-created session and the streamed
 * content (currentMessage) is associated with it — never ''.
 *
 * This spec drives the REAL hook with renderHook + a mocked fetch streaming SSE
 * frames, with the prop deliberately '' (mimicking the first-send closure) and
 * the store holding the just-created active session. It asserts:
 *   1. the /chat/stream POST body carries the NEW session id, not ''
 *   2. the empty-id guard does NOT bail (a stream is actually started)
 *   3. the streamed delta lands in currentMessage (associated with the send)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── mock auth so sendMessage gets a token without an AuthProvider ────────────
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
    user: { id: 'u1' },
  }),
}));

// useSSEChat retired — the streaming engine is now useChatStream, which
// re-exports `useSSEChat` as a back-compat alias and carries the same
// first-message live-session (effectiveSessionId) fix this asserts.
import { useSSEChat } from '../useChatStream';
import { useChatStore } from '@/stores/useChatStore';

const NEW_SESSION_ID = 'sess_freshly_created_123';

// ── helper: build a fetch Response whose body streams the given frames ───────
// The ported streaming engine (useChatStream) consumes the v0.6.6 NDJSON wire
// format: one typed JSON object `{type, ...payload}` per `\n`-terminated line
// (NOT the legacy `event:`/`data:` SSE framing). `frame()` emits that shape.
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function frame(event: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({ type: event, ...data })}\n`;
}

describe('useSSEChat — first message of a new chat targets the live session id', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset the chat store, then seed it the way createNewSession() does on the
    // first send: the brand-new session exists AND is the active session, while
    // the hook is still mounted with the stale '' prop (the closure race).
    useChatStore.setState({
      sessions: {
        [NEW_SESSION_ID]: {
          id: NEW_SESSION_ID,
          title: 'New Chat',
          messages: [],
          messageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      },
      activeSessionId: NEW_SESSION_ID,
    } as any);

    // Canonical NDJSON delta envelope: the ported engine's single text writer
    // is `content_block_delta` (OpenAgentic format: blockType:'text' + content),
    // which fires onStream(content). The legacy `content_delta` arm is a no-op.
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      sseResponse([
        frame('content_block_delta', { index: 0, blockType: 'text', content: 'Hello' }),
        frame('content_block_delta', { index: 0, blockType: 'text', content: ' world' }),
        frame('done', { content: 'Hello world' }),
      ]) as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState({ sessions: {}, activeSessionId: null } as any);
  });

  it('posts the freshly-created session id (not "") and streams its content live', async () => {
    // Capture the streamed-and-finalized assistant content for THIS send. The
    // hook surfaces live tokens in `currentMessage` mid-stream and finalizes via
    // onMessage on `done` (then clears currentMessage), so onMessage is the
    // stable proof that the streamed content was produced for this send.
    const seenContent: string[] = [];
    const onMessage = vi.fn((m: any) => {
      if (m?.role === 'assistant' && typeof m.content === 'string') {
        seenContent.push(m.content);
      }
    });
    let liveSawHello = false;
    const onStream = vi.fn((c: string) => {
      if (typeof c === 'string' && c.includes('Hello')) liveSawHello = true;
    });

    // Mount the hook with the STALE '' prop — exactly the first-send closure state.
    const { result } = renderHook(() =>
      useSSEChat({ sessionId: '', onMessage, onStream }),
    );

    await act(async () => {
      await result.current.sendMessage('first message of a brand new chat');
    });

    // 1. A stream was actually started — the empty-id guard did NOT short-circuit.
    expect(fetchSpy).toHaveBeenCalled();
    const streamCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/stream'),
    );
    expect(streamCall, 'expected a POST to /chat/stream').toBeTruthy();

    // 2. The POST body carries the NEW (live-resolved) session id, NEVER ''.
    //    This is the core of the upstream fix — the send targets the freshly-
    //    created session even though the prop closure is still ''.
    const body = JSON.parse((streamCall![1] as RequestInit).body as string);
    expect(body.sessionId).toBe(NEW_SESSION_ID);
    expect(body.sessionId).not.toBe('');

    // 3. The streamed deltas are associated with this send (rendered live — the
    //    thing that used to require a reload). Either the live currentMessage
    //    carried the token mid-stream (onStream) or it was finalized via
    //    onMessage on done.
    await waitFor(() => {
      const finalizedHasHello = seenContent.some((c) => c.includes('Hello'));
      expect(liveSawHello || finalizedHasHello).toBe(true);
    });
  });

  it('bails (no stream) when neither the prop nor the store has a session id', async () => {
    // Defense-in-depth: with no resolvable id anywhere, the guard must still bail
    // rather than post a '' session — proving the live-resolve is a real id, not
    // an accidental always-send.
    useChatStore.setState({ sessions: {}, activeSessionId: null } as any);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSSEChat({ sessionId: '', onError }),
    );

    await act(async () => {
      await result.current.sendMessage('no session anywhere');
    });

    const streamCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/chat/stream'),
    );
    expect(streamCall).toBeFalsy();
    expect(onError).toHaveBeenCalled();
  });
});
