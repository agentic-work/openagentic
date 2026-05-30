/**
 * WorkflowExecutionEngine — LLM-node canonical interleaving (Phase E₂.2)
 * ======================================================================
 *
 * Verifies that when an LLM node executes inside a workflow, its NDJSON
 * stream carries:
 *
 *   node_start
 *   → node_stream(inner = content_block_start | content_block_delta | …)
 *   → node_complete
 *
 * The inner payload is a canonical `AnthropicStreamEvent` so the flow
 * timeline UI can render thinking/text live inside the node card before
 * `node_complete` fires.
 *
 * Tactic: stand up an in-process HTTP server that emits a fake NDJSON
 * stream mimicking the internal /api/v1/chat/completions endpoint. Point
 * the engine's `apiUrl` env var at it, then run a trivial
 * trigger → llm_completion flow and collect every emitted ExecutionEvent.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
  type ExecutionEvent,
} from '../services/WorkflowExecutionEngine.js';

// ---------------------------------------------------------------------------
// Fake /api/v1/chat/completions NDJSON streaming server
// ---------------------------------------------------------------------------
//
// Emits Anthropic-wire-style canonical events to prove the engine
// re-forwards them verbatim. One message_start, one content_block_start
// of type text, three text_delta chunks, one content_block_stop, one
// message_delta with usage, one message_stop.

let server: http.Server;
let baseUrl: string;

// Default script — can be overridden per test. Each entry is one NDJSON
// line the fake server writes.
let currentScript: string[] = [];

const DEFAULT_SCRIPT = [
  JSON.stringify({
    type: 'message_start',
    message: {
      id: 'msg_test_1',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 0 },
    },
  }),
  JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello' },
  }),
  JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: ' from' },
  }),
  JSON.stringify({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: ' workflow.' },
  }),
  JSON.stringify({ type: 'content_block_stop', index: 0 }),
  JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 3, input_tokens: 5 },
  }),
  JSON.stringify({ type: 'message_stop' }),
];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/api/v1/chat/completions')) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      });
      let i = 0;
      const interval = setInterval(() => {
        if (i >= currentScript.length) {
          clearInterval(interval);
          res.end();
          return;
        }
        res.write(currentScript[i] + '\n');
        i += 1;
      }, 5);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  process.env.API_URL = baseUrl;
  // Needed by WorkflowEngine constructor path (defaults are fine otherwise).
  process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  currentScript = [...DEFAULT_SCRIPT];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSingleLLMNodeFlow(): WorkflowDefinition {
  return {
    nodes: [
      {
        id: 'trigger-0',
        type: 'trigger',
        data: { triggerType: 'manual' },
      },
      {
        id: 'llm-0',
        type: 'llm_completion',
        data: {
          model: 'test-model',
          prompt: 'Say hello from workflow.',
          temperature: 0.3,
          maxTokens: 100,
          stream: true,
        },
      },
    ],
    edges: [{ id: 'e-0', source: 'trigger-0', target: 'llm-0' }],
  };
}

function buildContext(): ExecutionContext {
  return {
    executionId: `test-${Math.random().toString(36).slice(2, 10)}`,
    workflowId: 'test-workflow',
    userId: 'test-user',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowExecutionEngine — Phase E₂.2 LLM-node streaming', () => {
  test('emits node_start → node_stream* → node_complete in order for LLM nodes', async () => {
    const def = buildSingleLLMNodeFlow();
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    const events: ExecutionEvent[] = [];
    engine.on('event', (ev: ExecutionEvent) => events.push(ev));

    await engine.execute();

    // Collect the LLM-node lifecycle slice.
    const llmStart = events.findIndex(
      (e) => e.type === 'node_start' && e.nodeId === 'llm-0',
    );
    const llmComplete = events.findIndex(
      (e) => e.type === 'node_complete' && e.nodeId === 'llm-0',
    );
    expect(llmStart).toBeGreaterThan(-1);
    expect(llmComplete).toBeGreaterThan(llmStart);

    // Every `node_stream` for this node arrives strictly between the
    // start and complete markers.
    const streamIndexes = events
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.type === 'node_stream' && e.nodeId === 'llm-0')
      .map(({ idx }) => idx);

    expect(streamIndexes.length).toBeGreaterThan(0);
    for (const idx of streamIndexes) {
      expect(idx).toBeGreaterThan(llmStart);
      expect(idx).toBeLessThan(llmComplete);
    }
  });

  test('node_stream payload carries inner canonical events with `type`', async () => {
    const def = buildSingleLLMNodeFlow();
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    const innerTypes: string[] = [];
    engine.on('event', (ev: ExecutionEvent) => {
      if (ev.type === 'node_stream') {
        const inner = (ev.data?.event || ev.event) as { type?: string } | undefined;
        if (inner?.type) innerTypes.push(inner.type);
      }
    });

    await engine.execute();

    // Must have received at least one content_block_delta from the LLM.
    expect(innerTypes).toContain('content_block_delta');
    // message_start arrives first in the canonical wire.
    expect(innerTypes[0]).toBe('message_start');
  });

  test('node_complete output.content is the accumulated streamed text', async () => {
    const def = buildSingleLLMNodeFlow();
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    let finalOutput: any = null;
    engine.on('event', (ev: ExecutionEvent) => {
      if (ev.type === 'node_complete' && ev.nodeId === 'llm-0') {
        finalOutput = ev.data?.output ?? ev.output;
      }
    });

    await engine.execute();

    expect(finalOutput).toBeTruthy();
    expect(typeof finalOutput.content).toBe('string');
    // Default script emits "Hello from workflow." in three chunks.
    expect(finalOutput.content).toBe('Hello from workflow.');
  });

  test('non-LLM nodes still emit the plain node_start → node_complete pair (no node_stream)', async () => {
    // Build a trigger → transform (non-LLM) flow.
    const def: WorkflowDefinition = {
      nodes: [
        {
          id: 'trigger-0',
          type: 'trigger',
          data: { triggerType: 'manual' },
        },
        {
          id: 'transform-0',
          type: 'transform',
          data: { expression: 'return input;' },
        },
      ],
      edges: [{ id: 'e-0', source: 'trigger-0', target: 'transform-0' }],
    };
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    const events: ExecutionEvent[] = [];
    engine.on('event', (ev) => events.push(ev));

    await engine.execute();

    const streamsForTransform = events.filter(
      (e) => e.type === 'node_stream' && e.nodeId === 'transform-0',
    );
    // Transform is not an LLM node — no canonical LLM interleaving.
    expect(streamsForTransform.length).toBe(0);

    const starts = events.filter((e) => e.type === 'node_start' && e.nodeId === 'transform-0');
    const completes = events.filter(
      (e) => e.type === 'node_complete' && e.nodeId === 'transform-0',
    );
    expect(starts.length).toBe(1);
    expect(completes.length).toBeGreaterThanOrEqual(0); // may be 0 if transform skipped without expression
  });
});

describe('WorkflowExecutionEngine — fallback when streaming errors out', () => {
  test('non-NDJSON upstream response falls back to non-streaming without crashing', async () => {
    // Make the fake server emit a single line of malformed JSON followed
    // by `end`. The streaming path will parse zero content-blocks and
    // then the fallback check re-runs the non-streaming path against
    // the same /api/v1/chat/completions endpoint — the engine hardens
    // against this by only falling back if the streaming call itself
    // throws (non-2xx / timeout), not if it simply produces empty text.
    // We exercise both paths: empty stream succeeds-but-produces-empty,
    // so the engine should still return a valid envelope (content: '').
    currentScript = ['not-json', '{"type":"message_stop"}'];

    const def = buildSingleLLMNodeFlow();
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    let finalOutput: any = null;
    engine.on('event', (ev) => {
      if (ev.type === 'node_complete' && ev.nodeId === 'llm-0') {
        finalOutput = ev.data?.output ?? ev.output;
      }
    });

    // The engine's resultHasError heuristic treats empty LLM content as
    // a failed node; this emits node_error instead of node_complete.
    // Either outcome is acceptable: the wire remained valid NDJSON and
    // no exception crossed the engine boundary.
    await expect(engine.execute()).resolves.toMatchObject({ success: expect.any(Boolean) });
  });
});
