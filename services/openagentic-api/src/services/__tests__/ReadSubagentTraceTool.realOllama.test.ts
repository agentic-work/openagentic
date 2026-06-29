/**
 * ReadSubagentTraceTool — end-to-end A2 round-trip with REAL gpt-oss:20b
 * output as the transcript content.
 *
 * Pattern: drive gpu-node:11434 in beforeAll to produce a real sub-agent output
 * → stash into an in-memory TraceStore as if TaskTool just wrote it →
 * dispatch read_subagent_trace via executeReadSubagentTrace → verify the
 * full transcript round-trips intact + truncation works.
 *
 * The "data" being tested (the transcript body) is REAL model output. The
 * TraceStore/Reader is an in-memory Map for the test — same dep-injection
 * pattern as TaskTool wire-in tests. Not synthesized fixture data.
 *
 * Memory rule: feedback_no_synthetic_chunks_only_real_provider_captures.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  executeReadSubagentTrace,
  isReadSubagentTraceTool,
  READ_SUBAGENT_TRACE_TOOL,
  type TraceReader,
  type TraceRecord,
} from '../ReadSubagentTraceTool.js';

const HAL_URL = process.env.OLLAMA_HOST || 'http://gpu-node:11434';
const TEST_MODEL = process.env.OLLAMA_TEST_MODEL || 'gpt-oss:20b';

let HAL_OK = false;
let REAL_TRACE: TraceRecord | null = null;

async function probeHal(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5_000);
    const res = await fetch(`${HAL_URL}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function callOllamaText(prompt: string): Promise<string> {
  const res = await fetch(`${HAL_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEST_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

class InMemoryTraceReader implements TraceReader {
  private records = new Map<string, TraceRecord>();

  put(handle: string, rec: TraceRecord): void {
    this.records.set(handle, rec);
  }

  async read(handle: string): Promise<TraceRecord | null> {
    return this.records.get(handle) ?? null;
  }
}

function buildCtx() {
  return {
    sessionId: 'test-session',
    userId: 'test-user',
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

describe('ReadSubagentTraceTool — schema + dispatch unit checks', () => {
  it('exports a valid OpenAI-shape tool definition', () => {
    expect(READ_SUBAGENT_TRACE_TOOL.type).toBe('function');
    expect(READ_SUBAGENT_TRACE_TOOL.function.name).toBe('read_subagent_trace');
    expect(READ_SUBAGENT_TRACE_TOOL.function.parameters.required).toContain('trace_handle');
  });

  it('isReadSubagentTraceTool accepts canonical + camel-case aliases', () => {
    expect(isReadSubagentTraceTool('read_subagent_trace')).toBe(true);
    expect(isReadSubagentTraceTool('readSubagentTrace')).toBe(true);
    expect(isReadSubagentTraceTool('ReadSubagentTrace')).toBe(true);
    expect(isReadSubagentTraceTool('Task')).toBe(false);
    expect(isReadSubagentTraceTool('')).toBe(false);
  });

  it('rejects missing trace_handle', async () => {
    const reader = new InMemoryTraceReader();
    const result = await executeReadSubagentTrace(
      buildCtx(),
      { trace_handle: '' },
      { reader },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('trace_handle is required');
  });

  it('returns ok:false with explanatory error for unknown handle', async () => {
    const reader = new InMemoryTraceReader();
    const result = await executeReadSubagentTrace(
      buildCtx(),
      { trace_handle: 'trace_does_not_exist' },
      { reader },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no trace found/i);
    expect(result.error).toContain('trace_does_not_exist');
  });

  it('surfaces reader.read throw as structured error (no exception leakage)', async () => {
    const failingReader: TraceReader = {
      read: async () => {
        throw new Error('redis connection lost');
      },
    };
    const result = await executeReadSubagentTrace(
      buildCtx(),
      { trace_handle: 'trace_anything' },
      { reader: failingReader },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('reader.read failed');
    expect(result.error).toContain('redis connection lost');
  });
});

describe('ReadSubagentTraceTool — REAL gpt-oss:20b round-trip', () => {
  beforeAll(async () => {
    HAL_OK = await probeHal();
    if (!HAL_OK) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ReadSubagentTraceTool.realOllama] gpu-node:11434 unreachable — skipping.`,
      );
      return;
    }
    const realOutput = await callOllamaText(
      `You are a sub-agent dispatched to enumerate Azure subscriptions. ` +
        `Respond with a 5-step description of what you would do, including which Azure CLI ` +
        `commands you'd invoke. Aim for ~150-200 words total.`,
    );
    REAL_TRACE = {
      sessionId: 'real-test-session',
      userId: 'real-test-user',
      role: 'cloud_operations',
      prompt: 'Enumerate Azure subscriptions',
      output: realOutput,
      stats: {
        turns: 4,
        tokens: Math.ceil(realOutput.length / 4),
        durationMs: 8500,
        toolsUsed: ['azure_list_subscriptions', 'azure_get_subscription'],
      },
    };
    // eslint-disable-next-line no-console
    console.log(
      `[realData] captured real sub-agent transcript: ${realOutput.length} chars, ` +
        `~${Math.ceil(realOutput.length / 4)} tokens`,
    );
  }, 120_000);

  it('round-trips a real transcript intact via handle', async () => {
    if (!HAL_OK || !REAL_TRACE) return;
    const reader = new InMemoryTraceReader();
    reader.put('trace_real_001', REAL_TRACE);
    const result = await executeReadSubagentTrace(
      buildCtx(),
      { trace_handle: 'trace_real_001' },
      { reader },
    );
    expect(result.ok).toBe(true);
    expect(result.trace).toBeDefined();
    expect(result.trace!.output).toBe(REAL_TRACE.output);
    expect(result.trace!.role).toBe('cloud_operations');
    expect(result.trace!.stats.turns).toBe(4);
    expect(result.output_truncated_from).toBeUndefined();
  });

  it('truncates real long transcript to max_output_chars and reports original length', async () => {
    if (!HAL_OK || !REAL_TRACE) return;
    const reader = new InMemoryTraceReader();
    reader.put('trace_real_002', REAL_TRACE);
    const result = await executeReadSubagentTrace(
      buildCtx(),
      { trace_handle: 'trace_real_002', max_output_chars: 200 },
      { reader },
    );
    expect(result.ok).toBe(true);
    expect(result.trace!.output).toMatch(/… \[truncated\]$/);
    expect(result.output_truncated_from).toBe(REAL_TRACE.output!.length);
    expect(result.output_truncated_from).toBeGreaterThan(200);
    // Truncated body should be exactly max_output_chars + truncation marker
    expect(result.trace!.output!.length).toBe(200 + '… [truncated]'.length);
  });

  it('no truncation when output is shorter than cap', async () => {
    if (!HAL_OK || !REAL_TRACE) return;
    const reader = new InMemoryTraceReader();
    reader.put('trace_real_003', REAL_TRACE);
    const result = await executeReadSubagentTrace(
      buildCtx(),
      // Cap LARGER than the actual output length
      { trace_handle: 'trace_real_003', max_output_chars: 999_999 },
      { reader },
    );
    expect(result.ok).toBe(true);
    expect(result.trace!.output).toBe(REAL_TRACE.output);
    expect(result.output_truncated_from).toBeUndefined();
  });
});
