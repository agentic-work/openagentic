/**
 * GenAITracer (workflow-engine) — OTel GenAI v1.37 spans + standard metric instruments
 * for every AI node executor in Flows.
 *
 * Specs:
 *   - Core gen_ai semconv (v1.37):
 *     https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   - Agent spans (sub-agent invocation):
 *     https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
 *
 * Single-entrypoint wrapper for the 16 AI node executors in this repo:
 *   - llm_completion, openagentic_chat (alias openagentic_llm)
 *   - azure_ai, bedrock, vertex
 *   - reasoning, structured_output
 *   - agent_single, agent_pool, agent_spawn, agent_supervisor, multi_agent
 *   - synth, embedding, rag_query, guardrails
 *
 * Each executor wraps its provider call in `withGenAISpan({ ... }, async () => {...})`.
 * Tool dispatches inside agent loops use `withToolCallSpan(...)` as child spans.
 *
 * Emits the two REQUIRED OTel GenAI v1.37 metric instruments:
 *   - gen_ai.client.token.usage         histogram, attr gen_ai.token.type=input|output
 *   - gen_ai.client.operation.duration  histogram, seconds
 *
 * Companion helper to the chatmode-side GenAITracer in openagentic-api. Cross-check
 * (G5 of the OTel rollout plan) covers gap analysis between the two.
 */

import {
  trace,
  metrics as metricsApi,
  SpanStatusCode,
  type Tracer,
  type Meter,
  type Histogram,
  type Span,
} from '@opentelemetry/api';

/**
 * Allowed `gen_ai.operation.name` values per v1.37 semconv §gen-ai-spans:
 *   chat | text_completion | embeddings | agent | task_execution
 *
 * Mapping for our 16 AI nodes:
 *   - llm_completion / openagentic_chat / azure_ai / bedrock / vertex /
 *     reasoning / structured_output / synth / guardrails → chat
 *   - embedding / rag_query (embed phase)                → embeddings
 *   - agent_single / agent_pool / agent_spawn / agent_supervisor → agent
 *   - multi_agent (orchestrates sub-agents)              → task_execution
 */
export type GenAIOperation =
  | 'chat'
  | 'text_completion'
  | 'embeddings'
  | 'agent'
  | 'task_execution';

/**
 * `gen_ai.system` values per v1.37 semconv. Includes the values we route to
 * today plus the canonical OTel ids for the major cloud-AI surfaces.
 */
export type GenAISystem =
  | 'anthropic'
  | 'aws.bedrock'
  | 'azure.ai.openai'
  | 'ollama'
  | 'vertex'
  | 'openai'
  // workflow-internal: used by synth / guardrails / rag_query / openagentic-proxy
  // dispatch where the model behind the platform endpoint is opaque to the
  // node. Operators slice the prom mirror with this label to filter out
  // platform-internal calls from per-provider rollups.
  | 'openagentic.platform';

export interface GenAISpanInput {
  operation: GenAIOperation;
  system: GenAISystem;
  /** Model id requested. `'auto'` is valid (Smart Router routes downstream). */
  requestModel: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Sub-agent attrs. Only set when operation='agent' or 'task_execution'. */
  agentId?: string;
  agentName?: string;
  agentDescription?: string;
}

export interface GenAISpanResultMeta {
  /** Model returned by the provider — may differ from request when Smart Router picks. */
  responseModel?: string;
  responseId?: string;
  finishReasons?: string[];
  inputTokens?: number;
  outputTokens?: number;
}

interface MetricInstruments {
  tokenUsage: Histogram;
  operationDuration: Histogram;
}

const TRACER_NAME = 'openagentic.workflows.gen_ai';
const TRACER_VERSION = '1.37.0';

let _tracer: Tracer | undefined;
let _meter: Meter | undefined;
let _instruments: MetricInstruments | undefined;

function getTracer(): Tracer {
  if (!_tracer) _tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
  return _tracer;
}

function getInstruments(): MetricInstruments {
  if (!_instruments) {
    if (!_meter) _meter = metricsApi.getMeter(TRACER_NAME, TRACER_VERSION);
    _instruments = {
      tokenUsage: _meter.createHistogram('gen_ai.client.token.usage', {
        description: 'Number of input and output tokens used per GenAI operation',
        unit: 'token',
      }),
      operationDuration: _meter.createHistogram('gen_ai.client.operation.duration', {
        description: 'GenAI client operation duration',
        unit: 's',
      }),
    };
  }
  return _instruments;
}

/**
 * Test-only — reset the lazy-bound tracer/meter/instruments so each test
 * picks up a freshly registered global provider. Production callers do
 * NOT need to call this.
 */
export function _resetGenAITracerForTests(): void {
  _tracer = undefined;
  _meter = undefined;
  _instruments = undefined;
}

/**
 * Wrap an AI node executor's provider call in a `gen_ai.<operation>` span.
 *
 * REQUIRED attributes (emitted unconditionally):
 *   - gen_ai.operation.name
 *   - gen_ai.system
 *   - gen_ai.request.model
 *   - gen_ai.usage.input_tokens   (always set, 0 when not reported)
 *   - gen_ai.usage.output_tokens  (always set, 0 when not reported)
 *
 * Conditional attributes (set only when meaningful):
 *   - gen_ai.request.{max_tokens,temperature,top_p,top_k}
 *   - gen_ai.response.{model,id,finish_reasons}
 *   - gen_ai.agent.{id,name,description}
 *
 * Also emits both standard OTel metric instruments per call:
 *   - gen_ai.client.token.usage (one observation each for token.type=input and output)
 *   - gen_ai.client.operation.duration (one observation, in seconds)
 *
 * Error path: span.status=ERROR with the thrown error's message; the duration
 * histogram is still recorded so SLO dashboards count the failed call. Token
 * usage histograms only record on success (when tokens are knowable).
 */
export async function withGenAISpan<T>(
  input: GenAISpanInput,
  fn: (span: Span) => Promise<{ result: T; meta: GenAISpanResultMeta }>,
): Promise<T> {
  const tracer = getTracer();
  const { tokenUsage, operationDuration } = getInstruments();

  const attrs: Record<string, string | number> = {
    'gen_ai.operation.name': input.operation,
    'gen_ai.system': input.system,
    'gen_ai.request.model': input.requestModel,
  };
  if (input.maxTokens != null) attrs['gen_ai.request.max_tokens'] = input.maxTokens;
  if (input.temperature != null) attrs['gen_ai.request.temperature'] = input.temperature;
  if (input.topP != null) attrs['gen_ai.request.top_p'] = input.topP;
  if (input.topK != null) attrs['gen_ai.request.top_k'] = input.topK;
  if (input.agentId) attrs['gen_ai.agent.id'] = input.agentId;
  if (input.agentName) attrs['gen_ai.agent.name'] = input.agentName;
  if (input.agentDescription) attrs['gen_ai.agent.description'] = input.agentDescription;

  const t0 = performance.now();

  return tracer.startActiveSpan(
    `gen_ai.${input.operation}`,
    { attributes: attrs },
    async (span) => {
      try {
        const { result, meta } = await fn(span);

        if (meta.responseModel) span.setAttribute('gen_ai.response.model', meta.responseModel);
        if (meta.responseId) span.setAttribute('gen_ai.response.id', meta.responseId);
        if (meta.finishReasons && meta.finishReasons.length > 0) {
          span.setAttribute(
            'gen_ai.response.finish_reasons',
            JSON.stringify(meta.finishReasons),
          );
        }

        const inputTokens = meta.inputTokens ?? 0;
        const outputTokens = meta.outputTokens ?? 0;
        span.setAttribute('gen_ai.usage.input_tokens', inputTokens);
        span.setAttribute('gen_ai.usage.output_tokens', outputTokens);

        const metricLabels = {
          'gen_ai.operation.name': input.operation,
          'gen_ai.system': input.system,
          'gen_ai.request.model': input.requestModel,
          'gen_ai.response.model': meta.responseModel ?? input.requestModel,
        };
        tokenUsage.record(inputTokens, {
          ...metricLabels,
          'gen_ai.token.type': 'input',
        });
        tokenUsage.record(outputTokens, {
          ...metricLabels,
          'gen_ai.token.type': 'output',
        });
        operationDuration.record((performance.now() - t0) / 1000, metricLabels);

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        // Still record duration so operators can SLI on failure latency.
        const metricLabels = {
          'gen_ai.operation.name': input.operation,
          'gen_ai.system': input.system,
          'gen_ai.request.model': input.requestModel,
          'gen_ai.response.model': input.requestModel,
          'error.type': err instanceof Error ? err.name : 'Error',
        };
        operationDuration.record((performance.now() - t0) / 1000, metricLabels);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export interface ToolCallSpanInput {
  toolCallId: string;
  toolName: string;
  /** Optional. Use 'mcp' | 'builtin' | 'function' per v1.37 semconv. */
  toolType?: string;
}

/**
 * Wrap a tool dispatch inside an agent loop in a child `gen_ai.tool_call` span.
 *
 * Per OTel GenAI v1.37 §execute_tool, tool spans carry:
 *   - gen_ai.tool.call.id
 *   - gen_ai.tool.name
 *   - gen_ai.tool.type   (optional)
 *
 * Caller must invoke this INSIDE the parent's `withGenAISpan(fn)` body so the
 * child span attaches to the correct parent in the trace tree.
 */
export async function withToolCallSpan<T>(
  input: ToolCallSpanInput,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const attrs: Record<string, string> = {
    'gen_ai.tool.call.id': input.toolCallId,
    'gen_ai.tool.name': input.toolName,
  };
  if (input.toolType) attrs['gen_ai.tool.type'] = input.toolType;

  return tracer.startActiveSpan(
    'gen_ai.tool_call',
    { attributes: attrs },
    async (span) => {
      try {
        return await fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
