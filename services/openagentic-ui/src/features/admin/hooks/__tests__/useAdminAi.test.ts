/**
 * RED test for the not-yet-implemented useAdminAi SSE hook.
 *
 * Contract:
 *   - POSTs JSON body { message, sessionId, currentSection, conversationHistory }
 *     to /api/admin/ai/ask with Authorization: Bearer <token>.
 *   - Parses SSE events: completion_start (model), content (token-by-token),
 *     suggestions (string[]), done.
 *   - Calls onModel/onToken/onSuggestions/onDone callbacks accordingly.
 *   - On non-2xx response, calls onError with the response body.
 *   - stopStreaming() aborts an in-flight request and finalizes accumulated.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/utils/api', () => ({
  apiEndpoint: (path: string) => path,
}));

import { useAdminAi } from '../useAdminAi';

function makeSseStream(events: Array<{ event: string; data: any }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
      }
      controller.close();
    },
  });
}

function makeFetchResponse(events: Array<{ event: string; data: any }>) {
  return {
    ok: true,
    status: 200,
    body: makeSseStream(events),
    text: async () => '',
  } as unknown as Response;
}

describe('useAdminAi', () => {
  const onToken = vi.fn();
  const onDone = vi.fn();
  const onSuggestions = vi.fn();
  const onError = vi.fn();
  const onModel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('auth_token', 'test-jwt');
  });

  it('POSTs to /api/admin/ai/ask with auth + body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeFetchResponse([
      { event: 'completion_start', data: { model: 'claude-sonnet-4-6' } },
      { event: 'content', data: { content: 'Open ' } },
      { event: 'content', data: { content: '[Models]' } },
      { event: 'done', data: { sessionId: 's1' } },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAdminAi({ onToken, onDone, onSuggestions, onError, onModel }));
    await act(async () => {
      await result.current.sendMessage({
        message: 'How do I add a model?',
        sessionId: 's1',
        currentSection: 'overview',
        conversationHistory: [],
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/admin/ai/ask');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-jwt');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.message).toBe('How do I add a model?');
    expect(body.sessionId).toBe('s1');
    expect(body.currentSection).toBe('overview');
  });

  it('emits onModel for completion_start, onToken for each content event, onDone with full text', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeFetchResponse([
      { event: 'completion_start', data: { model: 'claude-sonnet-4-6' } },
      { event: 'content', data: { content: 'Open ' } },
      { event: 'content', data: { content: '[Models](#model-management)' } },
      { event: 'suggestions', data: { suggestions: ['How do I disable a provider?'] } },
      { event: 'done', data: { sessionId: 's1' } },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAdminAi({ onToken, onDone, onSuggestions, onError, onModel }));
    await act(async () => {
      await result.current.sendMessage({
        message: 'how do I add models',
        sessionId: 's1',
        currentSection: 'overview',
        conversationHistory: [],
      });
    });

    expect(onModel).toHaveBeenCalledWith('claude-sonnet-4-6');
    expect(onToken).toHaveBeenCalledWith('Open ');
    expect(onToken).toHaveBeenCalledWith('[Models](#model-management)');
    expect(onSuggestions).toHaveBeenCalledWith(['How do I disable a provider?']);
    expect(onDone).toHaveBeenCalledWith('Open [Models](#model-management)');
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'NO_DEFAULT_MODEL',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAdminAi({ onToken, onDone, onSuggestions, onError, onModel }));
    await act(async () => {
      await result.current.sendMessage({
        message: 'hi',
        sessionId: 's1',
        currentSection: 'overview',
        conversationHistory: [],
      });
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/NO_DEFAULT_MODEL|503/);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stopStreaming aborts and finalizes accumulated text', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeFetchResponse([
      { event: 'content', data: { content: 'Half ' } },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAdminAi({ onToken, onDone, onSuggestions, onError, onModel }));
    await act(async () => {
      await result.current.sendMessage({
        message: 'hi',
        sessionId: 's1',
        currentSection: 'overview',
        conversationHistory: [],
      });
    });
    act(() => {
      result.current.stopStreaming();
    });
    // onDone gets called either by stream end or by stop — accumulated must be 'Half '
    expect(onDone).toHaveBeenCalled();
    const lastCall = onDone.mock.calls[onDone.mock.calls.length - 1][0];
    expect(lastCall).toContain('Half');
  });
});
