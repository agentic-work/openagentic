/**
 * OpenLLMetryAdapter — records LLM spans using the OpenTelemetry SDK conventions.
 *
 * T4: Uses OpenTelemetry standard semantic conventions:
 *   gen_ai.system, gen_ai.request.model, gen_ai.response.model,
 *   gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, etc.
 *
 * Implementation strategy: Rather than pulling in the full @opentelemetry/* SDK
 * (which would require package-level changes and complex SDK initialization),
 * we build OTel-formatted JSON spans in-process and export them via OTLP HTTP
 * if OTEL_EXPORTER_OTLP_ENDPOINT is configured. This matches the PhoenixAdapter
 * OTel payload shape but targets a generic OTLP collector.
 *
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set, the spans are collected in-memory
 * (useful for testing) and discarded on flush — zero external dependency.
 *
 * Fail-open: errors never propagate (T6).
 */

import type { LLMCallRecord, TracingAdapter } from '../LLMTracingService.js';

interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  status: { code: number; message?: string };
}

const BATCH_MAX = 100;

export class OpenLLMetryAdapter implements TracingAdapter {
  private pending: OtelSpan[] = [];
  /** Exposed for test inspection (last span's attributes). */
  _lastAttrs: Record<string, unknown> = {};

  async record(rec: LLMCallRecord): Promise<void> {
    try {
      const span = this._startSpan(rec);
      this.pending.push(span);
      if (this.pending.length >= BATCH_MAX) {
        await this.flush();
      }
    } catch (err) {
      console.warn('[OpenLLMetryAdapter] record error (swallowed):', err);
    }
  }

  async flush(): Promise<void> {
    const toSend = this.pending.splice(0);
    if (toSend.length === 0) return;

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
      // No OTLP endpoint configured — discard (in-memory only mode).
      return;
    }

    const payload = this.toOtlpPayload(toSend);
    try {
      // Dynamic import of axios so this adapter can be tested without the module
      const { default: axios } = await import('axios');
      const tracesUrl = endpoint.replace(/\/$/, '') + '/v1/traces';
      await axios.post(tracesUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
    } catch (err) {
      console.warn('[OpenLLMetryAdapter] flush error (swallowed):', err);
    }
  }

  /**
   * Build a single OTel span for the LLM call.
   * Exposed as a non-private method so tests can replace it to simulate errors.
   */
  _startSpan(rec: LLMCallRecord): OtelSpan {
    const startNs = BigInt(Date.now() - rec.latencyMs) * 1_000_000n;
    const endNs = BigInt(Date.now()) * 1_000_000n;

    const attrs: Array<{ key: string; value: Record<string, unknown> }> = [
      { key: 'gen_ai.system', value: { stringValue: 'openagentic' } },
      { key: 'gen_ai.request.model', value: { stringValue: rec.model } },
      { key: 'gen_ai.response.model', value: { stringValue: rec.model } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: rec.promptTokens } },
      { key: 'gen_ai.usage.output_tokens', value: { intValue: rec.completionTokens } },
      { key: 'gen_ai.cost_usd', value: { doubleValue: rec.costUsd } },
      { key: 'gen_ai.latency_ms', value: { intValue: rec.latencyMs } },
      { key: 'openagentic.workflow_id', value: { stringValue: rec.workflowId } },
      { key: 'openagentic.node_id', value: { stringValue: rec.nodeId } },
      { key: 'openagentic.execution_id', value: { stringValue: rec.executionId } },
    ];

    if (rec.tenantId) {
      attrs.push({ key: 'openagentic.tenant_id', value: { stringValue: rec.tenantId } });
    }
    if (rec.prompt) {
      attrs.push({ key: 'gen_ai.prompt', value: { stringValue: rec.prompt } });
    }
    if (rec.completion) {
      attrs.push({ key: 'gen_ai.completion', value: { stringValue: rec.completion } });
    }
    if (rec.error) {
      attrs.push({ key: 'error.message', value: { stringValue: rec.error } });
    }

    // Capture for test inspection.
    this._lastAttrs = Object.fromEntries(
      attrs.map(({ key, value }) => [
        key,
        value.stringValue ?? value.intValue ?? value.doubleValue,
      ]),
    );

    return {
      traceId: rec.executionId,
      spanId: `${rec.nodeId}-${Date.now()}`,
      name: 'gen_ai.completion',
      kind: 3, // SPAN_KIND_CLIENT
      startTimeUnixNano: startNs.toString(),
      endTimeUnixNano: endNs.toString(),
      attributes: attrs,
      status: rec.error
        ? { code: 2, message: rec.error }
        : { code: 1 },
    };
  }

  private toOtlpPayload(spans: OtelSpan[]): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'openagentic-workflows' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'openagentic.openllmetry', version: '1.0.0' },
              spans,
            },
          ],
        },
      ],
    };
  }
}
