/**
 * Sev-0 (#1071 / Q1-harmony-recovery, 2026-05-24): gpt-oss:20b leaks
 * Harmony chain-of-thought reasoning prose into the tool_call channel on
 * the SYNTHESIS turn, AFTER the tool results are already in history.
 * Ollama's parser returns HTTP 500 "error parsing tool call". The #851
 * soft-recovery then punted to "Please retry" — discarding the real Azure
 * data already fetched.
 *
 * Live capture (api pod openagentic-api-6688c8569d-qvrq6, 2026-05-24T01:29Z):
 *   user: "show me my Azure subscriptions and what is in each resource group"
 *   → azure_list_subscriptions + azure_list_resource_groups returned real data
 *   → next turn: {"error":"error parsing tool call: raw='We need to list
 *      subscriptions and then resource groups in each subscription. Received
 *      subscription list: two subscriptions: id 6ed... and 815a...'"}
 *   → user saw "I had trouble continuing — ... Please retry" with NO answer.
 *
 * Contract pinned here: when the failing request's history ALREADY contains
 * ≥1 tool result, the recovery MUST re-issue ONE Ollama chat call with tools
 * stripped + a synthesis nudge, and yield THAT text as the assistant turn —
 * NOT the "Please retry" punt.
 *
 * This is a stubbed-fetch reproduction of the wire interaction. The
 * authoritative GREEN gate is the live gpt-oss:20b harness at
 * OllamaProvider.harmonySynthesisSalvage.realmodel.test.ts (Rule 7c).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../OllamaProvider.js';
import { PARSE_TOOL_CALL_RECOVERY_TEXT } from '../util/ollamaParseToolCallSoftFailure.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(function (this: any) { return this; }),
} as any;

function tagsResponse(model: string): Response {
  return new Response(JSON.stringify({ models: [{ name: model }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// The exact live 500 body from the capture.
const PARSE_500_BODY = JSON.stringify({
  error:
    "error parsing tool call: raw='We need to list subscriptions and then " +
    'resource groups in each subscription. Received subscription list: two ' +
    "subscriptions: id 6ed... and 815a... (but the second ID is truncated; need full ID)...'",
});

function parseError500(): Response {
  return new Response(PARSE_500_BODY, {
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'application/json' },
  });
}

// Non-streaming /api/chat JSON response (what the salvage re-call reads).
function nonStreamChatResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      model: 'gpt-oss:20b',
      message: { role: 'assistant', content },
      done: true,
      eval_count: 42,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

// A 2-turn history where turn-2 already carries tool results for the two
// Azure tools — mirrors the live synthesis turn.
const HISTORY_WITH_TOOL_RESULTS = [
  { role: 'user', content: 'show me my Azure subscriptions and what is in each resource group' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { function: { name: 'azure_list_subscriptions', arguments: {} } },
      { function: { name: 'azure_list_resource_groups', arguments: {} } },
    ],
  },
  {
    role: 'tool',
    content: JSON.stringify({
      subscriptions: [
        { id: '6ed00000-aaaa', name: 'Prod-Sub' },
        { id: '815a0000-bbbb', name: 'Dev-Sub' },
      ],
    }),
  },
  {
    role: 'tool',
    content: JSON.stringify({
      resourceGroups: [
        { subscription: 'Prod-Sub', name: 'rg-prod-east', location: 'eastus' },
        { subscription: 'Dev-Sub', name: 'rg-dev-west', location: 'westus' },
      ],
    }),
  },
];

describe('OllamaProvider — Harmony synthesis salvage (#1071)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  const MODEL = 'gpt-oss:20b';
  const SALVAGED_TEXT =
    'You have 2 Azure subscriptions: Prod-Sub (rg-prod-east in eastus) and ' +
    'Dev-Sub (rg-dev-west in westus).';

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    // @ts-expect-error stub global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('salvages a text synthesis via a no-tools re-call instead of punting to "Please retry"', async () => {
    // 1. /api/tags (ensureModelExists)
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    // 2. /api/chat synthesis turn → the Harmony-leak 500
    fetchMock.mockResolvedValueOnce(parseError500());
    // 3. /api/chat no-tools salvage re-call → real text answer
    fetchMock.mockResolvedValueOnce(nonStreamChatResponse(SALVAGED_TEXT));

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://hal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: HISTORY_WITH_TOOL_RESULTS as any,
      tools: [
        { type: 'function', function: { name: 'azure_list_subscriptions', description: 'd', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'azure_list_resource_groups', description: 'd', parameters: { type: 'object', properties: {} } } },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    const text = events
      .filter((e) => e?.type === 'content_block_delta' && e?.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');

    // The salvaged text must surface — NOT the punt.
    expect(text).toContain('Prod-Sub');
    expect(text).not.toContain('Please retry');
    expect(text).not.toBe(PARSE_TOOL_CALL_RECOVERY_TEXT);

    // A third fetch (the no-tools re-call) must have happened with tools stripped.
    const chatCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/chat'),
    );
    expect(chatCalls.length, 'expected a salvage re-call to /api/chat').toBe(2);
    const recallBody = JSON.parse((chatCalls[1]![1] as RequestInit).body as string);
    expect(recallBody.tools, 'salvage re-call must strip tools').toBeUndefined();
    // System nudge appended.
    const sysMsgs = (recallBody.messages as any[]).filter((m) => m.role === 'system');
    expect(sysMsgs.some((m) => /FINAL plain-text/i.test(m.content || ''))).toBe(true);

    // Stream still terminates cleanly.
    expect(events.some((e) => e?.type === 'message_stop')).toBe(true);
  });

  it('falls back to the #851 "Please retry" punt only when the salvage re-call also fails', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(parseError500()); // synthesis turn 500
    fetchMock.mockResolvedValueOnce(parseError500()); // salvage re-call ALSO 500

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://hal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: HISTORY_WITH_TOOL_RESULTS as any,
      tools: [
        { type: 'function', function: { name: 'azure_list_subscriptions', description: 'd', parameters: { type: 'object', properties: {} } } },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    const text = events
      .filter((e) => e?.type === 'content_block_delta' && e?.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');

    expect(text).toBe(PARSE_TOOL_CALL_RECOVERY_TEXT);
    expect(events.some((e) => e?.type === 'message_stop')).toBe(true);
  });

  it('keeps the #851 punt when there are NO tool results to synthesize', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(parseError500());

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://hal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'do a thing' }] as any,
      tools: [
        { type: 'function', function: { name: 'some_tool', description: 'd', parameters: { type: 'object', properties: {} } } },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    const text = events
      .filter((e) => e?.type === 'content_block_delta' && e?.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');

    // No tool results → nothing to salvage → original punt, and NO re-call.
    expect(text).toBe(PARSE_TOOL_CALL_RECOVERY_TEXT);
    const chatCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('/api/chat'),
    );
    expect(chatCalls.length, 'no salvage re-call when no tool results').toBe(1);
  });
});
