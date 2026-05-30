/**
 * GenAITracer — OTel GenAI v1.37 span emission for chat / tool / agent ops.
 *
 * Specs:
 *   - Core gen_ai semconv (v1.37):
 *     https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   - Agent spans (sub-agent invocation):
 *     https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
 *
 * Three span types — each maps to one `gen_ai.operation.name`:
 *   - `chat`         — wrap the LLM call (one per turn). Records model,
 *                      system instructions, response.id, usage tokens
 *                      including cache_read_input_tokens / cache_write_input_tokens.
 *   - `execute_tool` — wrap MCP / built-in tool dispatch (one per tool_use).
 *                      Records gen_ai.tool.{name,call.id}.
 *   - `invoke_agent` — wrap sub-agent dispatch (Task tool branch). Records
 *                      gen_ai.agent.{id,name,description} per the agent-spans
 *                      spec, plus the originating tool.call.id for trace
 *                      correlation with the parent's tool_use block.
 *
 * Dual emission: every span also increments matching prom-client counters
 * with `gen_ai_*` names (matching the OTel attribute namespace) so the
 * existing /metrics endpoint AND Grafana dashboards keyed on the OTel
 * semconv pick up the data — no separate exporter pipeline required for
 * the in-cluster observability stack. External backends (Datadog,
 * Honeycomb, Tempo) ingest the OTel spans natively when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set at startup.
 *
 * The prom register is OPTIONAL — when omitted (tests), only OTel spans
 * are emitted. Production wires the default register via `getGenAITracer()`.
 *
 * Wired into:
 *   - buildChatV2Deps → RunChatDeps.genAITracer (singleton per process)
 *   - chatLoop wraps streamProvider in withChatSpan
 *   - dispatchChatToolCall wraps tool dispatch in withToolSpan / withAgentSpan
 *
 * Plan: docs/superpowers/plans/2026-05-12-chatmode-industry-bestpractices-followup.md §F2
 */

import {
  type Tracer,
  type Span,
  type Meter,
  type Histogram as OtelHistogram,
  SpanStatusCode,
  trace,
  metrics as metricsApi,
} from '@opentelemetry/api';
import { createRequire } from 'node:module';

// Prom mirror — optional dependency. When set, every span emit increments
// matching counters/histograms so /metrics surfaces the gen_ai.* signal.
import type { Counter, Histogram, Registry } from 'prom-client';

// ESM has no `require` global — synthesize one off `import.meta.url` so the
// singleton accessor below can lazy-load prom-client without making the
// whole module import-time bind on it (unit tests swap registers).
const requireFromHere = createRequire(import.meta.url);

export interface ChatSpanInput {
  model: string;
  /** System prompt text. Emitted as `gen_ai.system_instructions` (v1.37). */
  system?: string;
  /**
   * Provider id per v1.37 `gen_ai.system` enum ('anthropic' | 'openai' |
   * 'azure.ai.openai' | 'aws.bedrock' | 'ollama' | 'vertex' | …).
   * When undefined, the span carries `'openagentic.chat'` so operators can
   * still slice the prom/OTel rollups by-system. Mirrors the workflows-svc
   * tracer's `'openagentic.platform'` fallback (see GenAITracer v1.37
   * parity catalog in
   * `__tests__/architecture/genai-tracer-v1-37-parity.source-regression.test.ts`).
   */
  providerSystem?: string;
  responseId?: string;
  /** v1.37 gen_ai.request.* hyperparams — emitted conditionally. */
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

const DEFAULT_GEN_AI_SYSTEM = 'openagentic.chat';

export interface ToolSpanInput {
  name: string;
  callId: string;
}

/**
 * Sub-agent invocation per the OTel agent-spans spec.
 * - `agentId` is the stable identifier (markdown agent slug:
 *   `cloud_operations`, `data_analysis`, etc).
 * - `agentName` is human-readable.
 * - `agentDescription` is the registry description.
 * - `callId` is the parent's tool_use block id (the Task tool's toolu_*)
 *   so a child invoke_agent span correlates with the parent's
 *   `gen_ai.tool.call.id` on the execute_tool span that triggered it.
 */
export interface AgentSpanInput {
  agentId: string;
  agentName: string;
  agentDescription: string;
  callId: string;
}

export interface UsageInput {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface PromMetrics {
  chatTurns: Counter<string>;
  toolCalls: Counter<string>;
  agentInvocations: Counter<string>;
  inputTokens: Histogram<string>;
  outputTokens: Histogram<string>;
  cacheReadTokens: Histogram<string>;
}

function buildPromMetrics(register: Registry, promClient: typeof import('prom-client')): PromMetrics {
  const { Counter: C, Histogram: H } = promClient;
  // Re-use existing token buckets where they fit; chat turns / tool calls
  // / agent invocations are pure counters.
  const tokenBuckets = [100, 500, 1000, 2000, 5000, 10000, 50000, 100000];
  return {
    chatTurns: new C({
      name: 'gen_ai_chat_turns_total',
      help: 'OTel gen_ai chat operations completed (one per provider stream end)',
      labelNames: ['model'],
      registers: [register],
    }),
    toolCalls: new C({
      name: 'gen_ai_tool_calls_total',
      help: 'OTel gen_ai execute_tool operations completed',
      labelNames: ['tool_name', 'outcome'],
      registers: [register],
    }),
    agentInvocations: new C({
      name: 'gen_ai_agent_invocations_total',
      help: 'OTel gen_ai invoke_agent operations (sub-agent dispatches)',
      labelNames: ['agent_id', 'outcome'],
      registers: [register],
    }),
    inputTokens: new H({
      name: 'gen_ai_usage_input_tokens',
      help: 'OTel gen_ai.usage.input_tokens distribution per chat turn',
      labelNames: ['model'],
      buckets: tokenBuckets,
      registers: [register],
    }),
    outputTokens: new H({
      name: 'gen_ai_usage_output_tokens',
      help: 'OTel gen_ai.usage.output_tokens distribution per chat turn',
      labelNames: ['model'],
      buckets: tokenBuckets,
      registers: [register],
    }),
    cacheReadTokens: new H({
      name: 'gen_ai_usage_cache_read_input_tokens',
      help: 'OTel gen_ai.usage.cache_read_input_tokens distribution per chat turn',
      labelNames: ['model'],
      buckets: tokenBuckets,
      registers: [register],
    }),
  };
}

interface OtelMetricInstruments {
  tokenUsage: OtelHistogram;
  operationDuration: OtelHistogram;
}

/**
 * Build the two REQUIRED v1.37 metric instruments via the OTel meter API.
 * Mirrors workflows-svc's `services/shared/workflow-engine/src/observability/
 * GenAITracer.ts` so dashboards keyed on the OTel semconv pick up signal
 * from both services with identical instrument names + labels.
 */
function buildOtelInstruments(meter: Meter): OtelMetricInstruments {
  return {
    tokenUsage: meter.createHistogram('gen_ai.client.token.usage', {
      description: 'Number of input and output tokens used per GenAI operation',
      unit: 'token',
    }),
    operationDuration: meter.createHistogram('gen_ai.client.operation.duration', {
      description: 'GenAI client operation duration',
      unit: 's',
    }),
  };
}

export class GenAITracer {
  private readonly prom?: PromMetrics;
  private readonly otelMetrics: OtelMetricInstruments;

  constructor(
    private readonly tracer: Tracer,
    promRegister?: { register: Registry; promClient: typeof import('prom-client') },
  ) {
    if (promRegister) {
      this.prom = buildPromMetrics(promRegister.register, promRegister.promClient);
    }
    this.otelMetrics = buildOtelInstruments(
      metricsApi.getMeter('openagentic-chat', '0.7.1'),
    );
  }

  async withChatSpan<T>(
    input: ChatSpanInput,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(`chat ${input.model}`, async (span) => {
      span.setAttribute('gen_ai.operation.name', 'chat');
      span.setAttribute('gen_ai.system', input.providerSystem ?? DEFAULT_GEN_AI_SYSTEM);
      span.setAttribute('gen_ai.request.model', input.model);
      if (input.maxTokens != null) span.setAttribute('gen_ai.request.max_tokens', input.maxTokens);
      if (input.temperature != null) span.setAttribute('gen_ai.request.temperature', input.temperature);
      if (input.topP != null) span.setAttribute('gen_ai.request.top_p', input.topP);
      if (input.topK != null) span.setAttribute('gen_ai.request.top_k', input.topK);
      if (input.system) span.setAttribute('gen_ai.system_instructions', input.system);
      if (input.responseId) span.setAttribute('gen_ai.response.id', input.responseId);
      try {
        const result = await fn(span);
        this.prom?.chatTurns.inc({ model: input.model });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async withToolSpan<T>(
    input: ToolSpanInput,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(`execute_tool ${input.name}`, async (span) => {
      span.setAttribute('gen_ai.operation.name', 'execute_tool');
      span.setAttribute('gen_ai.tool.name', input.name);
      span.setAttribute('gen_ai.tool.call.id', input.callId);
      try {
        const result = await fn(span);
        this.prom?.toolCalls.inc({ tool_name: input.name, outcome: 'ok' });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        this.prom?.toolCalls.inc({ tool_name: input.name, outcome: 'error' });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Sub-agent invocation span per OTel agent-spans spec. Distinct from
   * execute_tool because sub-agents have a longer lifecycle (their own
   * ReAct loop, their own model call, their own dispatches) and operators
   * filter on `gen_ai.operation.name = invoke_agent` to slice the fan-out.
   */
  async withAgentSpan<T>(
    input: AgentSpanInput,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(`invoke_agent ${input.agentId}`, async (span) => {
      span.setAttribute('gen_ai.operation.name', 'invoke_agent');
      span.setAttribute('gen_ai.agent.id', input.agentId);
      span.setAttribute('gen_ai.agent.name', input.agentName);
      if (input.agentDescription) {
        span.setAttribute('gen_ai.agent.description', input.agentDescription);
      }
      span.setAttribute('gen_ai.tool.call.id', input.callId);
      try {
        const result = await fn(span);
        this.prom?.agentInvocations.inc({ agent_id: input.agentId, outcome: 'ok' });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        this.prom?.agentInvocations.inc({ agent_id: input.agentId, outcome: 'error' });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Manual-lifecycle chat span. Use when the caller can't run inside an
   * `async fn` callback (e.g. chatLoop's per-turn `for await` body that
   * mutates outer scope + uses `continue` / `break`). Returns a handle
   * with `recordUsage(usage)` and `end(error?)`.
   *
   * Caller MUST call `.end()` in a finally block. Pairs with the prom
   * mirror counters on success (no double-count if end() is called twice).
   */
  startChat(input: ChatSpanInput): {
    recordUsage: (usage: UsageInput) => void;
    end: (error?: Error, meta?: { finishReasons?: string[]; responseModel?: string }) => void;
  } {
    const span = this.tracer.startSpan(`chat ${input.model}`);
    const system = input.providerSystem ?? DEFAULT_GEN_AI_SYSTEM;
    span.setAttribute('gen_ai.operation.name', 'chat');
    span.setAttribute('gen_ai.system', system);
    span.setAttribute('gen_ai.request.model', input.model);
    if (input.maxTokens != null) span.setAttribute('gen_ai.request.max_tokens', input.maxTokens);
    if (input.temperature != null) span.setAttribute('gen_ai.request.temperature', input.temperature);
    if (input.topP != null) span.setAttribute('gen_ai.request.top_p', input.topP);
    if (input.topK != null) span.setAttribute('gen_ai.request.top_k', input.topK);
    if (input.system) span.setAttribute('gen_ai.system_instructions', input.system);
    if (input.responseId) span.setAttribute('gen_ai.response.id', input.responseId);
    const t0 = performance.now();
    let ended = false;
    let succeeded = false;
    return {
      recordUsage: (usage: UsageInput) => {
        this.recordUsage(span, usage, { system, model: input.model });
        succeeded = true;
      },
      end: (error, meta) => {
        if (ended) return;
        ended = true;
        if (meta?.responseModel) {
          span.setAttribute('gen_ai.response.model', meta.responseModel);
        }
        if (meta?.finishReasons && meta.finishReasons.length > 0) {
          span.setAttribute(
            'gen_ai.response.finish_reasons',
            JSON.stringify(meta.finishReasons),
          );
        }
        if (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        } else if (succeeded) {
          this.prom?.chatTurns.inc({ model: input.model });
        }
        // v1.37 REQUIRED metric: gen_ai.client.operation.duration. Always
        // recorded (success + error) so SLO dashboards count failed latency.
        const labels: Record<string, string> = {
          'gen_ai.operation.name': 'chat',
          'gen_ai.system': system,
          'gen_ai.request.model': input.model,
          'gen_ai.response.model': meta?.responseModel ?? input.model,
        };
        if (error) labels['error.type'] = error.name || 'Error';
        this.otelMetrics.operationDuration.record(
          (performance.now() - t0) / 1000,
          labels,
        );
        span.end();
      },
    };
  }

  recordUsage(
    span: Span,
    usage: UsageInput,
    otelLabels?: { system?: string; model?: string },
  ): void {
    span.setAttribute('gen_ai.usage.input_tokens', usage.input);
    span.setAttribute('gen_ai.usage.output_tokens', usage.output);
    if (usage.cacheRead !== undefined) {
      span.setAttribute('gen_ai.usage.cache_read_input_tokens', usage.cacheRead);
    }
    if (usage.cacheWrite !== undefined) {
      span.setAttribute('gen_ai.usage.cache_write_input_tokens', usage.cacheWrite);
    }
    // v1.37 REQUIRED metric: gen_ai.client.token.usage with token.type label.
    if (otelLabels?.model) {
      const base = {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': otelLabels.system ?? DEFAULT_GEN_AI_SYSTEM,
        'gen_ai.request.model': otelLabels.model,
      };
      this.otelMetrics.tokenUsage.record(usage.input, {
        ...base,
        'gen_ai.token.type': 'input',
      });
      this.otelMetrics.tokenUsage.record(usage.output, {
        ...base,
        'gen_ai.token.type': 'output',
      });
    }
    if (this.prom) {
      // Pull the model label off the span's attributes for the histograms.
      // OTel API doesn't expose attributes on Span — but our caller flow
      // always pairs recordUsage with a span we just opened in withChatSpan
      // where model is in scope. We accept the label gap here as a small
      // tax; the histograms still bucket the distribution by model when
      // observed inside withChatSpan's fn callback (model is attr of the
      // parent span). See production wire-in for the parameterized observe.
      const model = ((span as unknown as { attributes?: Record<string, unknown> })
        .attributes?.['gen_ai.request.model'] as string | undefined) ?? 'unknown';
      this.prom.inputTokens.observe({ model }, usage.input);
      this.prom.outputTokens.observe({ model }, usage.output);
      if (usage.cacheRead !== undefined) {
        this.prom.cacheReadTokens.observe({ model }, usage.cacheRead);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Process singleton accessor — production callers reach for this.
// ---------------------------------------------------------------------------

let _instance: GenAITracer | undefined;

/**
 * Default tracer wired against the global OTel provider (set up by the
 * OTel SDK at startup if OTEL_EXPORTER_OTLP_ENDPOINT or similar env is
 * configured; otherwise the API returns a no-op tracer and spans go
 * nowhere — which is the correct behavior for unconfigured environments
 * like local dev / unit tests).
 *
 * The first call constructs a singleton with the prom-client default
 * register attached so /metrics surfaces gen_ai_* counters/histograms.
 */
export function getGenAITracer(): GenAITracer {
  if (!_instance) {
    // Lazy-load prom-client via createRequire — keeps the test-isolation
    // contract (unit tests mock out the import) while staying ESM-safe.
    const promClient = requireFromHere('prom-client') as typeof import('prom-client');
    _instance = new GenAITracer(
      trace.getTracer('openagentic-chat', '0.7.1'),
      { register: promClient.register, promClient },
    );
  }
  return _instance;
}

/** Test-only — reset the singleton between vitest cases that swap registers. */
export function _resetGenAITracerForTests(): void {
  _instance = undefined;
}
