/**
 * #806 Sev-0 — OllamaProvider outbound sanitization of tool_calls.arguments.
 *
 * Smoking gun (chat-dev 2026-05-13T20:10:58, session_1778703012207_7lrdug1on):
 *
 *   errorText: "error parsing tool call: raw='{\"}' err=unexpected end of JSON input"
 *
 * gpt-oss:20b emitted a truncated JSON-arguments string mid-stream on a prior
 * tool_call (`{"`). OllamaProvider's parseInlineJsonToolCalls path accepts
 * arguments as object-or-string and passes the malformed string through. The
 * malformed args persist into chat-loop history. On the NEXT outbound turn the
 * full history is serialized into Ollama's /api/chat body — and Ollama's
 * server-side tool-call parser 500s on the malformed args before the model is
 * even invoked. Pipeline dies.
 *
 * Contract: before fetch, OllamaProvider MUST walk
 * ollamaRequest.messages[].tool_calls[].function.arguments and replace any
 * non-parseable JSON-string with '{}' so the request body is wire-valid.
 *
 * Tests pin the sanitizer behavior at the request-body level by exposing the
 * helper directly (preferred — keeps the test fast + deterministic, no fetch
 * mocking).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeOutboundToolCallArgs } from '../OllamaProvider.js';

describe('OllamaProvider.sanitizeOutboundToolCallArgs (#806 + #812)', () => {
  // #812 — contract flipped from "JSON-string" to "object" because the Native
  // Ollama `/api/chat` endpoint we hit expects `function.arguments` as an
  // object. The OpenAI-compat string shape broke turn-2 with a 400
  // ("Value looks like object, but can't find closing '}' symbol").
  it('replaces malformed JSON arguments string with empty OBJECT', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'k8s_list_pods', arguments: '{"}' },
          },
        ],
      },
      { role: 'tool', content: 'pods=10' },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out[2].tool_calls[0].function.arguments).toEqual({});
  });

  it('hydrates a valid JSON arguments string back to an object', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'azure_list_subscriptions',
              arguments: '{"tenantId":"abc-123"}',
            },
          },
        ],
      },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out[0].tool_calls[0].function.arguments).toEqual({ tenantId: 'abc-123' });
  });

  it('leaves object-shaped arguments as objects (no stringify)', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'aws_list_buckets',
              arguments: { region: 'us-east-1' },
            },
          },
        ],
      },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out[0].tool_calls[0].function.arguments).toEqual({ region: 'us-east-1' });
  });

  it('replaces null/undefined arguments with empty OBJECT', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'a',
            type: 'function',
            function: { name: 't', arguments: null },
          },
          {
            id: 'b',
            type: 'function',
            function: { name: 't', arguments: undefined },
          },
        ],
      },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out[0].tool_calls[0].function.arguments).toEqual({});
    expect(out[0].tool_calls[1].function.arguments).toEqual({});
  });

  it('leaves messages without tool_calls alone', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'irrelevant' },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out).toEqual(messages);
  });

  it('handles multiple parallel tool_calls in one assistant message', () => {
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'k8s_list_pods', arguments: '{"namespace":"x"}' },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'k8s_list_services', arguments: '{"}' }, // malformed
          },
          {
            id: 'c3',
            type: 'function',
            function: { name: 'k8s_list_deployments', arguments: {} }, // empty object
          },
        ],
      },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out[0].tool_calls[0].function.arguments).toEqual({ namespace: 'x' });
    expect(out[0].tool_calls[1].function.arguments).toEqual({});
    expect(out[0].tool_calls[2].function.arguments).toEqual({});
  });

  it('preserves message order and shape', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 't', arguments: '{"}' },
          },
        ],
      },
      { role: 'tool', content: 'r1', tool_call_id: 'c1' },
    ];
    const out = sanitizeOutboundToolCallArgs(messages);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'u1' });
    expect(out[2].role).toBe('assistant');
    expect(out[3]).toEqual({ role: 'tool', content: 'r1', tool_call_id: 'c1' });
  });
});
