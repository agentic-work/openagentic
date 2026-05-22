/**
 * LangfuseAdapter — batches LLM call records and POSTs them to Langfuse.
 *
 * T2: Posts to Langfuse Cloud (https://us.cloud.langfuse.com/api/public/ingestion)
 *     or self-hosted via LANGFUSE_HOST env.
 *     Auth: Basic auth using LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY.
 *     Batch: up to 100 records or 5s window, whichever comes first.
 *
 * Fail-open: flush() swallows HTTP errors and never propagates.
 */

import axios from 'axios';
import type { LLMCallRecord, TracingAdapter } from '../LLMTracingService.js';

const DEFAULT_HOST = 'https://us.cloud.langfuse.com';
const BATCH_MAX = 100;
const FLUSH_INTERVAL_MS = 5000;

export class LangfuseAdapter implements TracingAdapter {
  private batch: LLMCallRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private host: string;
  private authToken: string;

  constructor() {
    this.host = (process.env.LANGFUSE_HOST || DEFAULT_HOST).replace(/\/$/, '');
    const pub = process.env.LANGFUSE_PUBLIC_KEY ?? '';
    const sec = process.env.LANGFUSE_SECRET_KEY ?? '';
    this.authToken = Buffer.from(`${pub}:${sec}`).toString('base64');
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

    const body = {
      batch: toSend.map(rec => this.toEvent(rec)),
    };

    try {
      await axios.post(
        `${this.host}/api/public/ingestion`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${this.authToken}`,
          },
          timeout: 10000,
        },
      );
    } catch (err) {
      console.warn('[LangfuseAdapter] flush error (swallowed):', err);
    }

    // Re-schedule for next window if there are still records coming.
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => { /* swallow */ });
    }, FLUSH_INTERVAL_MS);
    // Allow Node process to exit even if timer is pending.
    if (typeof this.flushTimer === 'object' && this.flushTimer !== null && 'unref' in this.flushTimer) {
      (this.flushTimer as any).unref();
    }
  }

  private toEvent(rec: LLMCallRecord): Record<string, unknown> {
    const id = `${rec.executionId}-${rec.nodeId}-${Date.now()}`;
    return {
      id,
      type: 'generation-create',
      timestamp: new Date().toISOString(),
      body: {
        id,
        traceId: rec.executionId,
        name: `llm_node:${rec.nodeId}`,
        model: rec.model,
        usage: {
          input: rec.promptTokens,
          output: rec.completionTokens,
          totalCost: rec.costUsd,
        },
        latency: rec.latencyMs,
        metadata: {
          workflowId: rec.workflowId,
          tenantId: rec.tenantId,
          nodeId: rec.nodeId,
        },
        input: rec.prompt,
        output: rec.completion,
        level: rec.error ? 'ERROR' : 'DEFAULT',
        statusMessage: rec.error,
      },
    };
  }
}
