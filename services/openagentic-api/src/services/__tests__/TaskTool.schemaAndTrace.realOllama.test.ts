/**
 * TaskTool wire-in for S3 (output_schema_name) + A2 (trace_handle).
 *
 * Real-data integration test: the JSON validated by executeTask comes from
 * a live gpt-oss:20b call to hal:11434 captured in beforeAll. No mock
 * provider responses — the runSubagent dep is a thin pass-through that
 * returns the REAL model output we pre-fetched.
 *
 * We can't run the full sub-agent ReAct loop in a unit test (it needs
 * db/redis/milvus/mcp-proxy/openagentic-proxy infrastructure), but we CAN
 * verify the wire-in surface behavior using real model output as the
 * data substrate. The runSubagent dep injection is a test-time seam,
 * not a synthesized provider response — per memory rule
 * `feedback_no_synthetic_chunks_only_real_provider_captures`, the
 * substantive "data" being validated is real.
 *
 * Skip-with-loud-warn when hal:11434 unreachable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  executeTask,
  type TaskDeps,
  type SubagentRunResult,
  type SubagentSpec,
  type TraceStore,
} from '../TaskTool.js';
import { buildSchemaDirective } from '../taskOutputSchemas.js';

const HAL_URL = process.env.OLLAMA_HOST || 'http://hal:11434';
const TEST_MODEL = process.env.OLLAMA_TEST_MODEL || 'gpt-oss:20b';

// #844 (2026-05-14) — every Task call now requires multi_step_justification.
// These tests are exercising S3 (schema validation) + A2 (trace store), not
// the justification gate itself — so each input passes a valid justification.
const VALID_JUST = {
  tool_count_estimate: 5,
  requires_dedicated_context: true,
  why: 'Audit spans multiple subscriptions and resource groups with cost rollup',
  single_tool_alternative: null,
};

let HAL_OK = false;
let REAL_CLOUD_LISTING_JSON = '';
let REAL_INVALID_JSON = '';

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

async function callOllamaJson(prompt: string): Promise<string> {
  const res = await fetch(`${HAL_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEST_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    }),
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

async function callOllamaText(prompt: string): Promise<string> {
  // NO format=json — model emits prose, which fails schema validation
  const res = await fetch(`${HAL_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TEST_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature: 0.1 },
    }),
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

function buildDeps(stubOutput: string, traceStore?: TraceStore): TaskDeps {
  return {
    listSubagentTypes: async () => [],
    runSubagent: async (_spec: SubagentSpec): Promise<SubagentRunResult> => ({
      ok: true,
      output: stubOutput,
      turns: 1,
      tokens: 100,
      durationMs: 10,
      toolsUsed: [],
    }),
    traceStore,
  };
}

function buildCtx() {
  const emitted: Array<{ frame: string; payload: unknown }> = [];
  const ctx = {
    sessionId: 'test-session',
    userId: 'test-user',
    emit: (frame: string, payload: unknown) => emitted.push({ frame, payload }),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
  return { ctx, emitted };
}

class InMemoryTraceStore implements TraceStore {
  public stored: Array<{ handle: string; payload: any }> = [];
  async store(payload: any): Promise<{ handle: string }> {
    const handle = `trace_${Math.random().toString(36).slice(2, 12)}`;
    this.stored.push({ handle, payload });
    return { handle };
  }
}

describe('TaskTool — S3 + A2 wire-in (real gpt-oss:20b output substrate)', () => {
  beforeAll(async () => {
    HAL_OK = await probeHal();
    if (!HAL_OK) {
      // eslint-disable-next-line no-console
      console.warn(
        `[TaskTool.schemaAndTrace] hal:11434 unreachable. ` +
          `Skipping wire-in tests. Per memory rule no-synthetic-chunks: ` +
          `NOT falling back to hand-authored fake JSON.`,
      );
      return;
    }
    // Capture two REAL model outputs ONCE for use across the suite:
    //   - one schema-shaped (used for S3 success path)
    //   - one prose (used for S3 failure path — schema rejects non-JSON)
    REAL_CLOUD_LISTING_JSON = await callOllamaJson(
      buildSchemaDirective('cloud_resource_listing') +
        `\n\nProduce a realistic example: provider="azure", resource_kind="subscription", ` +
        `with exactly 3 items each having id like "11111111-2222-3333-4444-555555555555", name, and region.`,
    );
    REAL_INVALID_JSON = await callOllamaText(
      `In 2-3 sentences, describe what an Azure subscription is. Use prose, not JSON.`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[realData] schema-shaped JSON len=${REAL_CLOUD_LISTING_JSON.length}, prose len=${REAL_INVALID_JSON.length}`,
    );
  }, 60_000);

  it('S3 success — executeTask returns ok:true + parsed data when sub-agent output passes schema', async () => {
    if (!HAL_OK) return;
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        output_schema_name: 'cloud_resource_listing',
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON),
    );
    expect(result.ok).toBe(true);
    expect(result.schema_violation).toBeUndefined();
    expect(result.data).toBeDefined();
    expect((result.data as any).provider).toBe('azure');
    expect((result.data as any).resource_kind).toBe('subscription');
    expect(Array.isArray((result.data as any).items)).toBe(true);
  });

  it('S3 failure — executeTask returns ok:false + schema_violation on bad output', async () => {
    if (!HAL_OK) return;
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        output_schema_name: 'cloud_resource_listing',
        multi_step_justification: VALID_JUST,
      },
      // Real prose output won't parse as JSON, validator surfaces the error
      buildDeps(REAL_INVALID_JSON),
    );
    expect(result.ok).toBe(false);
    expect(result.schema_violation).toBeDefined();
    expect(result.schema_violation!.length).toBeGreaterThan(0);
    // Stats still surface so the parent can audit cost regardless
    expect(result.stats?.turns).toBe(1);
  });

  it('S3 unset — back-compat: existing callers without output_schema_name see unchanged shape', async () => {
    if (!HAL_OK) return;
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        // no output_schema_name,
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON),
    );
    expect(result.ok).toBe(true);
    expect(result.schema_violation).toBeUndefined();
    expect(result.data).toBeUndefined(); // no validation → no parsed data field
    expect(result.output).toBe(REAL_CLOUD_LISTING_JSON);
  });

  it('A2 — trace_handle present when traceStore is configured', async () => {
    if (!HAL_OK) return;
    const store = new InMemoryTraceStore();
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON, store),
    );
    expect(result.ok).toBe(true);
    expect(result.trace_handle).toBeDefined();
    expect(result.trace_handle).toMatch(/^trace_/);
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0].payload.output).toBe(REAL_CLOUD_LISTING_JSON);
    expect(store.stored[0].payload.role).toBe('general-purpose');
    expect(store.stored[0].payload.sessionId).toBe('test-session');
  });

  it('A2 — back-compat: no trace_handle when traceStore is omitted', async () => {
    if (!HAL_OK) return;
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON), // no traceStore
    );
    expect(result.ok).toBe(true);
    expect(result.trace_handle).toBeUndefined();
  });

  it('A2 — traceStore failure is best-effort (does not block the result)', async () => {
    if (!HAL_OK) return;
    const failingStore: TraceStore = {
      store: async () => {
        throw new Error('trace storage unavailable');
      },
    };
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON, failingStore),
    );
    // Result still succeeds; trace_handle just absent
    expect(result.ok).toBe(true);
    expect(result.trace_handle).toBeUndefined();
    expect(result.output).toBe(REAL_CLOUD_LISTING_JSON);
  });

  it('S3 + A2 combined — schema-validated success carries both data and trace_handle', async () => {
    if (!HAL_OK) return;
    const store = new InMemoryTraceStore();
    const { ctx } = buildCtx();
    const result = await executeTask(
      ctx,
      {
        description: 'list azure subs',
        prompt: 'List Azure subscriptions',
        output_schema_name: 'cloud_resource_listing',
        multi_step_justification: VALID_JUST,
      },
      buildDeps(REAL_CLOUD_LISTING_JSON, store),
    );
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.trace_handle).toBeDefined();
    expect(store.stored).toHaveLength(1);
  });
});
