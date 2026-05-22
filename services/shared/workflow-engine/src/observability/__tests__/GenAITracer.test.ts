/**
 * Phase G1 (TDD RED-first) — OTel GenAI v1.37 helper for workflow-engine AI nodes.
 *
 * Specs:
 *   - Core gen_ai semconv (v1.37):
 *     https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   - Standard metric instruments:
 *     - gen_ai.client.token.usage   histogram, attr gen_ai.token.type=input|output
 *     - gen_ai.client.operation.duration   histogram, seconds
 *
 * This helper differs from the chatmode-side GenAITracer (in openagentic-api)
 * in two ways:
 *   1. It emits the two STANDARD OTel metric instruments
 *      (gen_ai.client.token.usage + gen_ai.client.operation.duration) so
 *      external collectors that auto-discover OTel GenAI signal pick up the
 *      data WITHOUT needing the prom-client mirror.
 *   2. It uses a single `withGenAISpan` entry point covering chat / embeddings /
 *      agent / task_execution operations. The workflow node executors are
 *      uniform in shape (call provider, await result, return) so a single
 *      wrapper covers all 16 AI executor sites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  MeterProvider,
  InMemoryMetricExporter,
  AggregationTemporality,
  PeriodicExportingMetricReader,
  DataPointType,
} from '@opentelemetry/sdk-metrics';
import { metrics as metricsApi, trace as traceApi } from '@opentelemetry/api';
import {
  withGenAISpan,
  withToolCallSpan,
  _resetGenAITracerForTests,
} from '../GenAITracer.js';

describe('GenAITracer (workflow-engine) — OTel GenAI v1.37', () => {
  let spanExporter: InMemorySpanExporter;
  let traceProvider: NodeTracerProvider;
  let metricExporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider;
  let metricReader: PeriodicExportingMetricReader;

  beforeEach(() => {
    spanExporter = new InMemorySpanExporter();
    traceProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    traceProvider.register();

    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    });
    meterProvider = new MeterProvider({ readers: [metricReader] });
    metricsApi.setGlobalMeterProvider(meterProvider);

    _resetGenAITracerForTests();
  });

  afterEach(async () => {
    await traceProvider.shutdown();
    await meterProvider.shutdown();
    // Disable the global providers so the next test's register() actually
    // installs its fresh provider rather than no-op'ing on top of the disposed one.
    traceApi.disable();
    metricsApi.disable();
  });

  it('emits chat span with all required gen_ai.* v1.37 attributes', async () => {
    await withGenAISpan(
      {
        operation: 'chat',
        system: 'ollama',
        requestModel: 'gpt-oss:20b',
        maxTokens: 2000,
        temperature: 0.7,
        topP: 0.95,
      },
      async () => ({
        result: 'ok',
        meta: {
          responseModel: 'gpt-oss:20b',
          responseId: 'resp_xyz',
          finishReasons: ['stop'],
          inputTokens: 123,
          outputTokens: 45,
        },
      }),
    );

    const [span] = spanExporter.getFinishedSpans();
    expect(span.name).toBe('gen_ai.chat');
    expect(span.attributes['gen_ai.operation.name']).toBe('chat');
    expect(span.attributes['gen_ai.system']).toBe('ollama');
    expect(span.attributes['gen_ai.request.model']).toBe('gpt-oss:20b');
    expect(span.attributes['gen_ai.request.max_tokens']).toBe(2000);
    expect(span.attributes['gen_ai.request.temperature']).toBe(0.7);
    expect(span.attributes['gen_ai.request.top_p']).toBe(0.95);
    expect(span.attributes['gen_ai.response.model']).toBe('gpt-oss:20b');
    expect(span.attributes['gen_ai.response.id']).toBe('resp_xyz');
    expect(span.attributes['gen_ai.response.finish_reasons']).toBe(
      JSON.stringify(['stop']),
    );
    expect(span.attributes['gen_ai.usage.input_tokens']).toBe(123);
    expect(span.attributes['gen_ai.usage.output_tokens']).toBe(45);
  });

  it('records gen_ai.client.token.usage histogram with input/output labels', async () => {
    await withGenAISpan(
      {
        operation: 'chat',
        system: 'ollama',
        requestModel: 'gpt-oss:20b',
      },
      async () => ({
        result: 'ok',
        meta: { inputTokens: 100, outputTokens: 50 },
      }),
    );

    await metricReader.forceFlush();
    const collected = metricExporter.getMetrics();
    const allMetrics = collected.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
    const tokenUsage = allMetrics.find(
      (m) => m.descriptor.name === 'gen_ai.client.token.usage',
    );
    expect(tokenUsage).toBeDefined();
    expect(tokenUsage!.dataPointType).toBe(DataPointType.HISTOGRAM);

    const dps = tokenUsage!.dataPoints as unknown as Array<{
      attributes: Record<string, unknown>;
      value: { sum: number };
    }>;
    const inputDp = dps.find((d) => d.attributes['gen_ai.token.type'] === 'input');
    const outputDp = dps.find((d) => d.attributes['gen_ai.token.type'] === 'output');
    expect(inputDp).toBeDefined();
    expect(outputDp).toBeDefined();
    expect(inputDp!.value.sum).toBe(100);
    expect(outputDp!.value.sum).toBe(50);
    expect(inputDp!.attributes['gen_ai.operation.name']).toBe('chat');
    expect(inputDp!.attributes['gen_ai.system']).toBe('ollama');
    expect(inputDp!.attributes['gen_ai.request.model']).toBe('gpt-oss:20b');
  });

  it('records gen_ai.client.operation.duration histogram in seconds', async () => {
    await withGenAISpan(
      {
        operation: 'chat',
        system: 'ollama',
        requestModel: 'gpt-oss:20b',
      },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { result: 'ok', meta: { inputTokens: 1, outputTokens: 1 } };
      },
    );

    await metricReader.forceFlush();
    const collected = metricExporter.getMetrics();
    const allMetrics = collected.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
    const duration = allMetrics.find(
      (m) => m.descriptor.name === 'gen_ai.client.operation.duration',
    );
    expect(duration).toBeDefined();
    expect(duration!.descriptor.unit).toBe('s');
    expect(duration!.dataPointType).toBe(DataPointType.HISTOGRAM);

    const dps = duration!.dataPoints as unknown as Array<{
      attributes: Record<string, unknown>;
      value: { sum: number };
    }>;
    expect(dps.length).toBeGreaterThan(0);
    expect(dps[0].value.sum).toBeGreaterThan(0);
    expect(dps[0].value.sum).toBeLessThan(60);
    expect(dps[0].attributes['gen_ai.operation.name']).toBe('chat');
  });

  it('sets ERROR status when callback throws AND still ends span', async () => {
    await expect(
      withGenAISpan(
        {
          operation: 'chat',
          system: 'ollama',
          requestModel: 'gpt-oss:20b',
        },
        async () => {
          throw new Error('upstream 502');
        },
      ),
    ).rejects.toThrow('upstream 502');

    const [span] = spanExporter.getFinishedSpans();
    expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span.status.message).toBe('upstream 502');
    expect(span.ended).toBe(true);
  });

  it('attaches gen_ai.agent.{id,name,description} when operation=agent', async () => {
    await withGenAISpan(
      {
        operation: 'agent',
        system: 'ollama',
        requestModel: 'gpt-oss:20b',
        agentId: 'cloud_operations',
        agentName: 'Cloud Operations',
        agentDescription: 'Cross-cloud IAM + cost audit specialist',
      },
      async () => ({ result: 'ok', meta: { inputTokens: 10, outputTokens: 5 } }),
    );

    const [span] = spanExporter.getFinishedSpans();
    expect(span.attributes['gen_ai.operation.name']).toBe('agent');
    expect(span.attributes['gen_ai.agent.id']).toBe('cloud_operations');
    expect(span.attributes['gen_ai.agent.name']).toBe('Cloud Operations');
    expect(span.attributes['gen_ai.agent.description']).toBe(
      'Cross-cloud IAM + cost audit specialist',
    );
  });

  it('emits child tool-call span with gen_ai.tool.* attributes', async () => {
    await withGenAISpan(
      {
        operation: 'agent',
        system: 'ollama',
        requestModel: 'gpt-oss:20b',
        agentId: 'data_analysis',
        agentName: 'Data Analysis',
      },
      async () => {
        await withToolCallSpan(
          { toolCallId: 'tc_42', toolName: 'splunk_search', toolType: 'mcp' },
          async () => 'tool-result',
        );
        return { result: 'ok', meta: { inputTokens: 10, outputTokens: 5 } };
      },
    );

    const child = spanExporter
      .getFinishedSpans()
      .find((s) => s.attributes['gen_ai.tool.name']);
    expect(child).toBeDefined();
    expect(child!.name).toBe('gen_ai.tool_call');
    expect(child!.attributes['gen_ai.tool.call.id']).toBe('tc_42');
    expect(child!.attributes['gen_ai.tool.name']).toBe('splunk_search');
    expect(child!.attributes['gen_ai.tool.type']).toBe('mcp');
  });

  it('always sets usage attrs (input=0, output=0) when meta does not report tokens', async () => {
    // OTel v1.37 REQUIRES gen_ai.usage.input_tokens + output_tokens — even when zero —
    // so collectors aggregating average tokens-per-op don't skip data points.
    await withGenAISpan(
      {
        operation: 'embeddings',
        system: 'azure.ai.openai',
        requestModel: 'text-embedding-3-small',
      },
      async () => ({ result: [0.1, 0.2], meta: {} }),
    );
    const [span] = spanExporter.getFinishedSpans();
    expect(span.attributes['gen_ai.usage.input_tokens']).toBe(0);
    expect(span.attributes['gen_ai.usage.output_tokens']).toBe(0);
  });

  it('reflects Smart-Router responseModel pick in gen_ai.response.model (not request.model)', async () => {
    // Per feedback_always_smart_router + feedback_db_is_sot_for_providers:
    // when request.model='auto' but the router picks gpt-oss:20b, response.model
    // must carry the chosen id so operators can slice metrics by what actually ran.
    await withGenAISpan(
      {
        operation: 'chat',
        system: 'ollama',
        requestModel: 'auto',
      },
      async () => ({
        result: 'ok',
        meta: {
          responseModel: 'gpt-oss:20b',
          inputTokens: 5,
          outputTokens: 3,
        },
      }),
    );
    const [span] = spanExporter.getFinishedSpans();
    expect(span.attributes['gen_ai.request.model']).toBe('auto');
    expect(span.attributes['gen_ai.response.model']).toBe('gpt-oss:20b');

    await metricReader.forceFlush();
    const collected = metricExporter.getMetrics();
    const allMetrics = collected.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
    const tokenUsage = allMetrics.find(
      (m) => m.descriptor.name === 'gen_ai.client.token.usage',
    );
    const dps = tokenUsage!.dataPoints as unknown as Array<{
      attributes: Record<string, unknown>;
    }>;
    expect(dps[0].attributes['gen_ai.response.model']).toBe('gpt-oss:20b');
  });
});
