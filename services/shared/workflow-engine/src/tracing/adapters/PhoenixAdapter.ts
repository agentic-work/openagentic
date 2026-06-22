/**
 * PhoenixAdapter — POSTs OTel-style spans to Arize Phoenix.
 *
 * T3: POST to {PHOENIX_HOST}/v1/traces with OTel span payload.
 *     Auth: api-key header from PHOENIX_API_KEY env.
 *     Batches spans per flush cycle (same 100/5s pattern as Langfuse).
 *
 * Fail-open: flush() swallows HTTP errors and never propagates.
 */

import axios from 'axios';
import type { LLMCallRecord, TracingAdapter } from '../LLMTracingService.js';

const DEFAULT_HOST = 'http://localhost:6006';
const BATCH_MAX = 100;
const FLUSH_INTERVAL_MS = 5000;

export class PhoenixAdapter implements TracingAdapter {
  private batch: LLMCallRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private host: string;
  private apiKey: string;

  constructor() {
    this.host = (process.env.PHOENIX_HOST || DEFAULT_HOST).replace(/\/$/, '');
    this.apiKey = process.env.PHOENIX_API_KEY ?? '';
    this.scheduleFlush();
  }

  async record(rec: LLMCallRecord): Promise<void> {
    this.batch.push(rec);
    if (this.batch.length >= BATCH_MAX) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const toSend = this.batch.splice(0);
    if (toSend.length === 0) return;

    const body = this.toOtelPayload(toSend);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    try {
      await axios.post(`${this.host}/v1/traces`, body, { headers, timeout: 10000 });
    } catch (err) {
      console.warn('[PhoenixAdapter] flush error (swallowed):', err);
    }

    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => { /* swallow */ });
    }, FLUSH_INTERVAL_MS);
    if (typeof this.flushTimer === 'object' && this.flushTimer !== null && 'unref' in this.flushTimer) {
      (this.flushTimer as any).unref();
    }
  }

  private toOtelPayload(records: LLMCallRecord[]): Record<string, unknown> {
    const spans = records.map(rec => this.toSpan(rec));
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
              scope: { name: 'openagentic.llm_tracing', version: '1.0.0' },
              spans,
            },
          ],
        },
      ],
    };
  }

  private toSpan(rec: LLMCallRecord): Record<string, unknown> {
    const startNs = BigInt(Date.now() - rec.latencyMs) * 1_000_000n;
    const endNs = BigInt(Date.now()) * 1_000_000n;

    const attributes = [
      { key: 'gen_ai.system', value: { stringValue: 'openagentic' } },
      { key: 'gen_ai.request.model', value: { stringValue: rec.model } },
      { key: 'gen_ai.response.model', value: { stringValue: rec.model } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: rec.promptTokens } },
      { key: 'gen_ai.usage.output_tokens', value: { intValue: rec.completionTokens } },
      { key: 'llm.cost_usd', value: { doubleValue: rec.costUsd } },
      { key: 'llm.latency_ms', value: { intValue: rec.latencyMs } },
      { key: 'openagentic.workflow_id', value: { stringValue: rec.workflowId } },
      { key: 'openagentic.node_id', value: { stringValue: rec.nodeId } },
      { key: 'openagentic.execution_id', value: { stringValue: rec.executionId } },
    ];

    if (rec.tenantId) {
      attributes.push({ key: 'openagentic.tenant_id', value: { stringValue: rec.tenantId } });
    }
    if (rec.prompt) {
      attributes.push({ key: 'gen_ai.prompt', value: { stringValue: rec.prompt } });
    }
    if (rec.completion) {
      attributes.push({ key: 'gen_ai.completion', value: { stringValue: rec.completion } });
    }
    if (rec.error) {
      attributes.push({ key: 'error.message', value: { stringValue: rec.error } });
    }

    return {
      traceId: rec.executionId,
      spanId: `${rec.nodeId}-${Date.now()}`,
      name: 'llm_call',
      kind: 3, // SPAN_KIND_CLIENT
      startTimeUnixNano: startNs.toString(),
      endTimeUnixNano: endNs.toString(),
      attributes,
      status: rec.error
        ? { code: 2, message: rec.error }  // STATUS_CODE_ERROR
        : { code: 1 },                      // STATUS_CODE_OK
    };
  }
}
