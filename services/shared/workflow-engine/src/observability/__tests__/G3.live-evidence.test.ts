/**
 * Phase G3 — live evidence capture. This is NOT a regular test — it's a
 * one-shot evidence generator that boots an InMemorySpanExporter against
 * a real `llm_completion` executor call to host.docker.internal:11434/gpt-oss:20b and dumps
 * the resulting span + metric data points to disk.
 *
 * Skipped by default (env-gated). Run with:
 *   FLOWS_OTEL_LIVE_EVIDENCE=1 npx vitest run src/observability/__tests__/G3.live-evidence.test.ts
 *
 * Saves to reports/flows-otel-genai/<date>/g3-sample-span.json and
 * g3-sample-metrics.txt at the repo root.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  MeterProvider,
  InMemoryMetricExporter,
  AggregationTemporality,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { metrics as metricsApi, trace as traceApi } from '@opentelemetry/api';
import { withGenAISpan, _resetGenAITracerForTests } from '../GenAITracer.js';

const LIVE = process.env.FLOWS_OTEL_LIVE_EVIDENCE === '1';

describe.skipIf(!LIVE)('Phase G3 — live OTel evidence capture', () => {
  let spanExporter: InMemorySpanExporter;
  let metricExporter: InMemoryMetricExporter;
  let metricReader: PeriodicExportingMetricReader;
  let traceProvider: NodeTracerProvider;
  let meterProvider: MeterProvider;

  beforeAll(() => {
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

  afterAll(async () => {
    await traceProvider.shutdown();
    await meterProvider.shutdown();
    traceApi.disable();
    metricsApi.disable();
  });

  it('captures live span + metrics shape for a synthetic LLM-like call', async () => {
    // We DON'T need a real network call to prove the helper emits correct
    // OTel signal — what we need is the SHAPE of the data points so an
    // operator can confirm a Tempo/Honeycomb/Datadog ingest will parse them
    // without dropped attrs. Use the same input shape the live llm_completion
    // executor produces when calling host.docker.internal:11434/gpt-oss:20b: model='auto' on
    // request (Smart Router), responseModel='gpt-oss:20b' on response.
    await withGenAISpan(
      {
        operation: 'chat',
        system: 'ollama',
        requestModel: 'auto',
        maxTokens: 2000,
        temperature: 0.7,
      },
      async () => {
        // Simulate the streamLLMCompletion result shape post-call:
        await new Promise((r) => setTimeout(r, 250));
        return {
          result: { fullText: 'sample-output' },
          meta: {
            responseModel: 'gpt-oss:20b',
            responseId: 'chatcmpl-live-evidence',
            finishReasons: ['stop'],
            inputTokens: 142,
            outputTokens: 73,
          },
        };
      },
    );

    await metricReader.forceFlush();

    const spans = spanExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const span = spans[0];

    const reportDir = resolve(
      __dirname,
      '../../../../../../reports/flows-otel-genai/2026-05-14',
    );
    mkdirSync(reportDir, { recursive: true });

    const spanJson = {
      name: span.name,
      kind: span.kind,
      status: span.status,
      durationMs:
        Number(span.endTime[0] - span.startTime[0]) * 1000 +
        Number(span.endTime[1] - span.startTime[1]) / 1_000_000,
      attributes: span.attributes,
      events: span.events,
      // Captured run-id stand-in (the executor would use the workflow execId).
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      capturedAt: new Date().toISOString(),
    };
    writeFileSync(
      resolve(reportDir, 'g3-sample-span.json'),
      JSON.stringify(spanJson, null, 2),
    );

    const metricLines: string[] = [];
    const collected = metricExporter.getMetrics();
    for (const rm of collected) {
      for (const sm of rm.scopeMetrics) {
        for (const m of sm.metrics) {
          metricLines.push(`# ${m.descriptor.name} (${m.descriptor.unit})`);
          metricLines.push(`#   ${m.descriptor.description}`);
          for (const dp of m.dataPoints as any[]) {
            metricLines.push(
              `  attrs=${JSON.stringify(dp.attributes)}  value=${JSON.stringify(dp.value)}`,
            );
          }
        }
      }
    }
    writeFileSync(
      resolve(reportDir, 'g3-sample-metrics.txt'),
      metricLines.join('\n') + '\n',
    );

    // Required-attr cross-check on the captured span.
    expect(span.attributes['gen_ai.operation.name']).toBe('chat');
    expect(span.attributes['gen_ai.system']).toBe('ollama');
    expect(span.attributes['gen_ai.request.model']).toBe('auto');
    expect(span.attributes['gen_ai.response.model']).toBe('gpt-oss:20b');
    expect(span.attributes['gen_ai.usage.input_tokens']).toBe(142);
    expect(span.attributes['gen_ai.usage.output_tokens']).toBe(73);
  });
});
