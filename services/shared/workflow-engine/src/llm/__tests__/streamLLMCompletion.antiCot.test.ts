/**
 * streamLLMCompletion — anti-CoT sanitizer contract.
 *
 * Blocker A2 (rebuild plan 2026-05-13): gpt-oss:20b and similar small
 * instruction-tuned models leak "The user wants me to ...", "Let me
 * think...", "First, I need to..." preambles into the visible answer.
 * That preamble flowed straight into rendered HTML/markdown in the
 * old 10 templates.
 *
 * Fix is a system-prompt prefix prepended at the streamLLMCompletion
 * boundary so EVERY AI node executor (llm_completion, reasoning,
 * structured_output, agent_*, azure_ai, bedrock, vertex, openagentic_*)
 * gets the directive without per-executor changes.
 *
 * These tests assert the wire body: the first message MUST be a system
 * message containing the anti-CoT directive, regardless of whether the
 * caller supplied their own system prompt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamLLMCompletion } from '../streamLLMCompletion.js';

interface Capture { url?: string; init?: RequestInit }

function mockOk(cap: Capture, content = 'ok'): void {
  const chunks = [
    `data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content } }] })}\n\n`,
    `data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
    cap.url = typeof input === 'string' ? input : (input as Request).url;
    cap.init = init;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('streamLLMCompletion — anti-CoT preamble sanitizer (Blocker A2)', () => {
  it('prepends an anti-CoT system message when caller has NO system prompt', async () => {
    const cap: Capture = {};
    mockOk(cap);
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'Write a haiku about coffee' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-1',
      onCanonical: () => {},
    });
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/return only the answer|do not include phrases|respond directly/i);
  });

  it('prepends anti-CoT directive into the FIRST system message when caller already has one', async () => {
    const cap: Capture = {};
    mockOk(cap);
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-2',
      onCanonical: () => {},
    });
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    // We must NOT inject a duplicate system message — the caller's system message
    // gets the directive prepended in place.
    const systemCount = body.messages.filter((m) => m.role === 'system').length;
    expect(systemCount).toBe(1);
    expect(body.messages[0].role).toBe('system');
    // Both the caller's content AND the directive must be present.
    expect(body.messages[0].content).toContain('You are a helpful assistant.');
    expect(body.messages[0].content).toMatch(/return only the answer|do not include phrases|respond directly/i);
  });

  it('directive explicitly forbids known CoT preamble phrases', async () => {
    const cap: Capture = {};
    mockOk(cap);
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'q' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-3',
      onCanonical: () => {},
    });
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    const sys = body.messages.find((m) => m.role === 'system')!.content;
    // The directive must explicitly list the bad phrases so the model knows what to avoid.
    expect(sys).toMatch(/the user wants/i);
    expect(sys).toMatch(/let me think/i);
    expect(sys).toMatch(/first, i need to|first i need to/i);
  });

  it('preserves the user message verbatim after sanitizer', async () => {
    const cap: Capture = {};
    mockOk(cap);
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'Write a haiku about coffee' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-4',
      onCanonical: () => {},
    });
    const body = JSON.parse(cap.init!.body as string) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('Write a haiku about coffee');
  });
});
