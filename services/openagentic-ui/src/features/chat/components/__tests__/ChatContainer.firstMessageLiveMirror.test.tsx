/**
 * ChatContainer — first-message in-flight CONTENT mirror regression.
 *
 * THE BUG (OSS, downstream of the already-fixed session-id send): the hook's
 * session-id send fix lands the /chat/stream POST on the freshly-created
 * session, and the hook surfaces live tokens in `currentMessage`. But the
 * CONTENT never reached the visible placeholder on the FIRST message of a new
 * chat — only a reload surfaced it.
 *
 * Root cause (ChatContainer.tsx): the in-flight mirror — `renderSessionId`
 * (which selects the rendered `messages` list) and the streaming-writer effect
 * that calls `updateStreamingMessage(...)` — resolved the target session id
 * through `firstSendStreamSessionId`, a `useState`. createNewSession() sets that
 * state via a setter, so it flushes ONE render too late. The first
 * `content_delta` frames update `currentMessage` BEFORE that state flushes, so:
 *   - the writer effect saw `renderSessionId === ''` and bailed on its
 *     `!writeSessionId` guard → updateStreamingMessage never ran, and
 *   - `messages` (derived from sessions[renderSessionId]) was [] so the
 *     placeholder wasn't even in the list to paint blocks into.
 * Net: `placeholder.content` stayed '' until a reload hydrated the id.
 *
 * THE FIX (mirrors agenticwork-ui ChatContainer, which keys this mirror on a
 * render-synchronous active session id): resolve the in-flight session id
 * through the SYNCHRONOUSLY-set `firstSendSessionIdRef.current` (assigned inside
 * sendMessage before the stream starts) — closure → store → ref — so it is
 * non-empty on the very first-delta render. `renderSessionId` now falls back to
 * the ref, and the writer effect resolves via `resolveSessionId()`.
 *
 * This spec drives a FAITHFUL HARNESS of ChatContainer's mirror logic (the real
 * component is 100k+ LOC with heavy dynamic imports and can't mount in jsdom).
 * The harness reproduces, verbatim, the load-bearing pieces:
 *   - the prop `sessionId` is '' (the first-send closure race),
 *   - the store holds the just-created session as the active session, with a
 *     streaming placeholder already added under the new id,
 *   - `firstSendSessionIdRef.current` is set synchronously to the new id,
 *   - `firstSendStreamSessionId` useState is still '' (not yet flushed),
 *   - a `currentMessage` token arrives.
 * It asserts the streamed content mirrors into the placeholder UNDER THE NEW
 * SESSION ID on that first-delta render — the thing that used to need a reload.
 *
 * A negative control proves the OLD (state-gated) resolution would have lost the
 * write to '' — i.e. the test fails without the ref-synchronous fallback.
 *
 * It also pins the source-level contract on the real ChatContainer.tsx so a
 * regression that re-gates the mirror behind the late useState is caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { useEffect, useMemo, useRef } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useChatStore } from '@/stores/useChatStore';

const NEW_SESSION_ID = 'sess_freshly_created_mirror_1';
const PLACEHOLDER_ID = 'assistant_placeholder_1';

/**
 * Faithful reproduction of ChatContainer's in-flight mirror, parameterized by
 * whether it resolves the session id render-SYNCHRONOUSLY via the ref (the fix)
 * or only via the late `firstSendStreamSessionId` useState (the old bug). Both
 * branches use the EXACT same store mutators the real component uses.
 */
function MirrorHarness(props: {
  sessionIdProp: string;            // the closure prop — '' on first send
  firstSendStreamSessionId: string; // the late useState — '' on first-delta render
  currentMessage: string;           // the live streamed token from the hook
  refSessionId: string | null;      // firstSendSessionIdRef.current (set synchronously)
  useRefFallback: boolean;          // true = fixed path, false = old state-only path
}) {
  const { sessions, updateStreamingMessage } = useChatStore();

  const firstSendSessionIdRef = useRef<string | null>(props.refSessionId);
  firstSendSessionIdRef.current = props.refSessionId;

  // renderSessionId — the fixed chain includes the synchronously-set ref BEFORE
  // the late useState; the old chain ended at the useState.
  const renderSessionId = props.useRefFallback
    ? (props.sessionIdProp || firstSendSessionIdRef.current || props.firstSendStreamSessionId || '')
    : (props.sessionIdProp || props.firstSendStreamSessionId || '');

  const resolveSessionId = (): string => {
    if (props.sessionIdProp && props.sessionIdProp.trim()) return props.sessionIdProp;
    const storeId = useChatStore.getState().activeSessionId;
    if (storeId && storeId.trim()) return storeId;
    return firstSendSessionIdRef.current || '';
  };

  const currentSession = useMemo(
    () => (renderSessionId ? (sessions as any)[renderSessionId] : null),
    [renderSessionId, sessions],
  );
  const messages = useMemo(() => currentSession?.messages || [], [currentSession?.messages]);

  // The streaming-writer effect — fixed path resolves render-synchronously via
  // resolveSessionId(); old path keys on renderSessionId only.
  useEffect(() => {
    const writeSessionId = props.useRefFallback ? resolveSessionId() : renderSessionId;
    if (!PLACEHOLDER_ID || !props.currentMessage || !writeSessionId) return;
    const placeholder = messages.find((m: any) => m.id === PLACEHOLDER_ID);
    if (!placeholder || placeholder.status !== 'streaming') return;
    if (placeholder.content !== props.currentMessage) {
      updateStreamingMessage(writeSessionId, PLACEHOLDER_ID, props.currentMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.currentMessage, renderSessionId, messages, updateStreamingMessage]);

  return <div data-testid="render-session-id">{renderSessionId}</div>;
}

function seedFirstSendStore() {
  // Exactly the state createNewSession()+optimistic-add leaves on the first
  // send: the new session is active and already holds the streaming placeholder.
  useChatStore.setState({
    sessions: {
      [NEW_SESSION_ID]: {
        id: NEW_SESSION_ID,
        title: 'New Chat',
        messages: [
          { id: 'user_1', role: 'user', content: 'first message', status: 'sending' },
          { id: PLACEHOLDER_ID, role: 'assistant', content: '', status: 'streaming' },
        ],
        messageCount: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    },
    activeSessionId: NEW_SESSION_ID,
  } as any);
}

describe('ChatContainer — first message mirrors streamed content into the live-session placeholder', () => {
  beforeEach(() => seedFirstSendStore());
  afterEach(() => useChatStore.setState({ sessions: {}, activeSessionId: null } as any));

  it('mirrors currentMessage into the placeholder under the NEW session id on the first-delta render (ref-synchronous fix)', () => {
    // First-send closure race: prop '' AND the late useState still '' — only the
    // synchronously-set ref carries the new id (as it does in real sendMessage).
    act(() => {
      render(
        <MirrorHarness
          sessionIdProp=""
          firstSendStreamSessionId=""
          refSessionId={NEW_SESSION_ID}
          currentMessage="Hello world"
          useRefFallback={true}
        />,
      );
    });

    const placeholder = useChatStore
      .getState()
      .sessions[NEW_SESSION_ID].messages.find((m: any) => m.id === PLACEHOLDER_ID)!;

    // THE PROOF: the streamed content landed in the placeholder LIVE, under the
    // real new-session id — no reload required.
    expect(placeholder.content).toBe('Hello world');
    expect(placeholder.streaming).toBe(true);
  });

  it('negative control: the OLD state-gated resolution loses the write (placeholder stays empty)', () => {
    // Same first-send race, but resolving ONLY through the late useState (still '')
    // — reproduces the original bug: writeSessionId === '' so updateStreamingMessage
    // no-ops against sessions[''] and the placeholder never gets the content.
    act(() => {
      render(
        <MirrorHarness
          sessionIdProp=""
          firstSendStreamSessionId=""
          refSessionId={NEW_SESSION_ID}
          currentMessage="Hello world"
          useRefFallback={false}
        />,
      );
    });

    const placeholder = useChatStore
      .getState()
      .sessions[NEW_SESSION_ID].messages.find((m: any) => m.id === PLACEHOLDER_ID)!;

    expect(placeholder.content).toBe(''); // lost to '' — exactly the reload-only bug
  });

  it('keeps streaming live when more tokens arrive (re-render mirrors the growing content)', () => {
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <MirrorHarness
          sessionIdProp=""
          firstSendStreamSessionId=""
          refSessionId={NEW_SESSION_ID}
          currentMessage="Hello"
          useRefFallback={true}
        />,
      ));
    });

    let placeholder = useChatStore
      .getState()
      .sessions[NEW_SESSION_ID].messages.find((m: any) => m.id === PLACEHOLDER_ID)!;
    expect(placeholder.content).toBe('Hello');

    act(() => {
      rerender(
        <MirrorHarness
          sessionIdProp=""
          firstSendStreamSessionId=""
          refSessionId={NEW_SESSION_ID}
          currentMessage="Hello world"
          useRefFallback={true}
        />,
      );
    });

    placeholder = useChatStore
      .getState()
      .sessions[NEW_SESSION_ID].messages.find((m: any) => m.id === PLACEHOLDER_ID)!;
    expect(placeholder.content).toBe('Hello world');
  });
});

describe('ChatContainer.tsx source — the in-flight mirror is render-synchronous (regression pin)', () => {
  const src = readFileSync(join(__dirname, '..', 'ChatContainer.tsx'), 'utf8');

  it('renderSessionId falls back to the synchronously-set firstSendSessionIdRef BEFORE the late useState', () => {
    // The ref must appear before firstSendStreamSessionId in the resolution chain.
    const m = src.match(
      /const\s+renderSessionId\s*=\s*[\s\S]*?firstSendSessionIdRef\.current[\s\S]*?firstSendStreamSessionId/,
    );
    expect(m, 'renderSessionId must resolve via firstSendSessionIdRef before firstSendStreamSessionId').toBeTruthy();
  });

  it('the streaming-writer effect resolves the target session id via resolveSessionId() (not the bare renderSessionId)', () => {
    const idx = src.indexOf('updateStreamingMessage(');
    // grab the nearest writer-effect occurrence that also reads currentMessage
    const writerIdx = src.indexOf('const writeSessionId = resolveSessionId();');
    expect(writerIdx, 'writer effect must derive writeSessionId from resolveSessionId()').toBeGreaterThan(-1);
    // and it must guard + write on that resolved id
    const slice = src.slice(writerIdx, writerIdx + 1200);
    expect(slice).toContain('!writeSessionId');
    expect(slice).toContain('updateStreamingMessage(writeSessionId,');
    expect(idx).toBeGreaterThan(-1);
  });
});
