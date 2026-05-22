/**
 * F2 — OTel GenAI v1.37 semantic conventions for chat + tool + agent spans.
 *
 * Two specs covered:
 *   - core gen-ai semconv (v1.37):
 *       https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *       gen_ai.operation.name ∈ {'chat', 'execute_tool', 'invoke_agent'}
 *   - gen-ai agent spans:
 *       https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
 *       invoke_agent spans carry gen_ai.agent.{id,name,description}
 *
 * Why this exists: Datadog / Honeycomb / Langfuse / Tempo / Phoenix ingest
 * gen_ai.* attrs natively as of v1.37. Emitting them gives operators
 * cache-hit attribution, per-tool latency, sub-agent fan-out, and FCA-floor
 * routing decisions without any custom dashboard glue.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { GenAITracer } from '../GenAITracer.js';

describe('GenAITracer — OTel GenAI v1.37 semconv', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('emits chat span with gen_ai.* v1.37 attrs + usage', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan(
      { model: 'claude-sonnet-4-6', system: 'You are X.' },
      async (span) => {
        tracer.recordUsage(span, {
          input: 100,
          output: 50,
          cacheRead: 80,
          cacheWrite: 0,
        });
      },
    );
    const [parent] = exporter.getFinishedSpans();
    expect(parent.name).toBe('chat claude-sonnet-4-6');
    expect(parent.attributes['gen_ai.operation.name']).toBe('chat');
    expect(parent.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    expect(parent.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(parent.attributes['gen_ai.usage.output_tokens']).toBe(50);
    expect(parent.attributes['gen_ai.usage.cache_read_input_tokens']).toBe(80);
    expect(parent.attributes['gen_ai.usage.cache_write_input_tokens']).toBe(0);
  });

  it('attaches system_instructions and response.id when supplied', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan(
      { model: 'gpt-5.4', system: 'be helpful', responseId: 'resp_abc' },
      async () => {},
    );
    const [parent] = exporter.getFinishedSpans();
    expect(parent.attributes['gen_ai.system_instructions']).toBe('be helpful');
    expect(parent.attributes['gen_ai.response.id']).toBe('resp_abc');
  });

  it('emits child execute_tool span with gen_ai.tool.* attrs', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan({ model: 'claude-sonnet-4-6' }, async () => {
      await tracer.withToolSpan(
        { name: 'tool_search', callId: 'call_123' },
        async () => {},
      );
    });
    const child = exporter
      .getFinishedSpans()
      .find((s) => s.attributes['gen_ai.tool.name']);
    expect(child).toBeDefined();
    expect(child!.name).toBe('execute_tool tool_search');
    expect(child!.attributes['gen_ai.operation.name']).toBe('execute_tool');
    expect(child!.attributes['gen_ai.tool.name']).toBe('tool_search');
    expect(child!.attributes['gen_ai.tool.call.id']).toBe('call_123');
  });

  it('emits child invoke_agent span with gen_ai.agent.* attrs (sub-agent dispatch)', async () => {
    // Per https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
    // sub-agent dispatch is its own span type — distinct from execute_tool.
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan({ model: 'claude-sonnet-4-6' }, async () => {
      await tracer.withAgentSpan(
        {
          agentId: 'cloud_operations',
          agentName: 'Cloud Operations',
          agentDescription: 'Cross-cloud IAM + cost audit specialist',
          callId: 'toolu_42',
        },
        async () => {},
      );
    });
    const child = exporter
      .getFinishedSpans()
      .find((s) => s.attributes['gen_ai.agent.id']);
    expect(child).toBeDefined();
    expect(child!.name).toBe('invoke_agent cloud_operations');
    expect(child!.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(child!.attributes['gen_ai.agent.id']).toBe('cloud_operations');
    expect(child!.attributes['gen_ai.agent.name']).toBe('Cloud Operations');
    expect(child!.attributes['gen_ai.agent.description']).toBe(
      'Cross-cloud IAM + cost audit specialist',
    );
    expect(child!.attributes['gen_ai.tool.call.id']).toBe('toolu_42');
  });

  it('records error status on thrown exception (chat span)', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await expect(
      tracer.withChatSpan({ model: 'gpt-oss:20b' }, async () => {
        throw new Error('upstream timeout');
      }),
    ).rejects.toThrow('upstream timeout');
    const [parent] = exporter.getFinishedSpans();
    expect(parent.status.code).toBe(2); // ERROR
    expect(parent.status.message).toBe('upstream timeout');
  });

  it('records error status on thrown exception (tool span)', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan({ model: 'claude-sonnet-4-6' }, async () => {
      await expect(
        tracer.withToolSpan({ name: 'broken', callId: 'c1' }, async () => {
          throw new Error('dispatch failed');
        }),
      ).rejects.toThrow('dispatch failed');
    });
    const toolSpan = exporter
      .getFinishedSpans()
      .find((s) => s.attributes['gen_ai.tool.name'] === 'broken');
    expect(toolSpan!.status.code).toBe(2);
  });

  it('child spans are parented under the chat span (single trace)', async () => {
    const tracer = new GenAITracer(provider.getTracer('test'));
    await tracer.withChatSpan({ model: 'claude-sonnet-4-6' }, async () => {
      await tracer.withToolSpan({ name: 'a', callId: 'c1' }, async () => {});
      await tracer.withAgentSpan(
        { agentId: 'b', agentName: 'B', agentDescription: '', callId: 'toolu_2' },
        async () => {},
      );
    });
    const all = exporter.getFinishedSpans();
    expect(all.length).toBe(3);
    const parent = all.find((s) => s.attributes['gen_ai.operation.name'] === 'chat');
    const tool = all.find((s) => s.attributes['gen_ai.operation.name'] === 'execute_tool');
    const agent = all.find((s) => s.attributes['gen_ai.operation.name'] === 'invoke_agent');
    expect(tool!.parentSpanContext?.spanId).toBe(parent!.spanContext().spanId);
    expect(agent!.parentSpanContext?.spanId).toBe(parent!.spanContext().spanId);
    // Same traceId — emergent property of nested startActiveSpan.
    expect(tool!.spanContext().traceId).toBe(parent!.spanContext().traceId);
    expect(agent!.spanContext().traceId).toBe(parent!.spanContext().traceId);
  });
});
