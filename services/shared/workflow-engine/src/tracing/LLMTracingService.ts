/**
 * LLMTracingService — per-call LLM tracing fan-out to observability providers.
 *
 * Supported providers (OBSERVABILITY_PROVIDER env):
 *   none (default) — no-op
 *   langfuse       — POST to Langfuse Cloud or self-hosted
 *   phoenix        — POST to Arize Phoenix using OTel spans
 *   openllmetry    — OpenTelemetry SDK with OTLP HTTP exporter
 *
 * T1  recordCall({nodeId, executionId, workflowId, tenantId?, model,
 *                 promptTokens, completionTokens, costUsd, latencyMs,
 *                 prompt?, completion?, error?}) — emits to configured provider.
 * T5  Provider selection via OBSERVABILITY_PROVIDER; default 'none'.
 * T6  Fail-open — adapter errors never propagate.
 * T8  Full prompt/completion only when OBSERVABILITY_INCLUDE_CONTENT=true;
 *     otherwise truncate to 200 chars and set promptTruncated / completionTruncated.
 */

export interface LLMCallRecord {
  nodeId: string;
  executionId: string;
  workflowId: string;
  tenantId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  prompt?: string;
  completion?: string;
  error?: string;
  /** Set by the service when prompt is truncated (PII guard). */
  promptTruncated?: boolean;
  /** Set by the service when completion is truncated (PII guard). */
  completionTruncated?: boolean;
}

/** Adapter interface that each provider backend implements. */
export interface TracingAdapter {
  record(rec: LLMCallRecord): Promise<void>;
  flush(): Promise<void>;
}

/** No-op adapter used for the 'none' provider. */
class NoneAdapter implements TracingAdapter {
  async record(_rec: LLMCallRecord): Promise<void> { /* intentional no-op */ }
  async flush(): Promise<void> { /* intentional no-op */ }
}

/** Maximum character length for prompt/completion when content inclusion is off. */
const CONTENT_MAX_LEN = 200;

export interface LLMTracingServiceOptions {
  /** Inject a pre-built adapter (used in tests). Takes precedence over env. */
  adapter?: TracingAdapter;
}

export class LLMTracingService {
  private adapter: TracingAdapter;
  private includeContent: boolean;

  constructor(opts: LLMTracingServiceOptions = {}) {
    this.includeContent = process.env.OBSERVABILITY_INCLUDE_CONTENT === 'true';

    if (opts.adapter) {
      this.adapter = opts.adapter;
    } else {
      this.adapter = LLMTracingService.buildAdapter();
    }
  }

  private static buildAdapter(): TracingAdapter {
    const provider = (process.env.OBSERVABILITY_PROVIDER ?? 'none').toLowerCase();
    switch (provider) {
      case 'langfuse': {
        // Dynamic import to avoid loading Langfuse deps when not configured.
        // We use a lazy singleton resolved at first record() call.
        return new LazyAdapter(() => import('./adapters/LangfuseAdapter.js').then(m => new m.LangfuseAdapter()));
      }
      case 'phoenix': {
        return new LazyAdapter(() => import('./adapters/PhoenixAdapter.js').then(m => new m.PhoenixAdapter()));
      }
      case 'openllmetry': {
        return new LazyAdapter(() => import('./adapters/OpenLLMetryAdapter.js').then(m => new m.OpenLLMetryAdapter()));
      }
      case 'none':
      default:
        return new NoneAdapter();
    }
  }

  /**
   * Record a single LLM call to the configured observability provider.
   * Always resolves — never throws (T6 fail-open).
   */
  async recordCall(raw: LLMCallRecord): Promise<void> {
    const rec = this.applyPiiGuard(raw);
    try {
      await this.adapter.record(rec);
    } catch (err) {
      // T6: fail-open — log at warn, never propagate.
      // We don't have a logger injected here; use console.warn which
      // the engine replaces with pino in prod via process-wide config.
      console.warn('[LLMTracingService] adapter.record error (swallowed):', err);
    }
  }

  /** Flush any pending batches. Used during graceful shutdown. */
  async flush(): Promise<void> {
    try {
      await this.adapter.flush();
    } catch (err) {
      console.warn('[LLMTracingService] adapter.flush error (swallowed):', err);
    }
  }

  /** Apply PII truncation according to OBSERVABILITY_INCLUDE_CONTENT env. */
  private applyPiiGuard(rec: LLMCallRecord): LLMCallRecord {
    if (this.includeContent) {
      // Full content allowed — return as-is (no truncated flags).
      return { ...rec };
    }

    const out: LLMCallRecord = { ...rec };

    if (typeof out.prompt === 'string' && out.prompt.length > CONTENT_MAX_LEN) {
      out.prompt = out.prompt.slice(0, CONTENT_MAX_LEN);
      out.promptTruncated = true;
    }
    if (typeof out.completion === 'string' && out.completion.length > CONTENT_MAX_LEN) {
      out.completion = out.completion.slice(0, CONTENT_MAX_LEN);
      out.completionTruncated = true;
    }

    return out;
  }
}

/**
 * LazyAdapter — wraps a factory that resolves to a real adapter on first use.
 * Allows dynamic import without blocking the constructor.
 */
class LazyAdapter implements TracingAdapter {
  private factory: () => Promise<TracingAdapter>;
  private resolved: TracingAdapter | null = null;
  private resolving: Promise<TracingAdapter> | null = null;

  constructor(factory: () => Promise<TracingAdapter>) {
    this.factory = factory;
  }

  private async getAdapter(): Promise<TracingAdapter> {
    if (this.resolved) return this.resolved;
    if (!this.resolving) {
      this.resolving = this.factory().then(a => {
        this.resolved = a;
        return a;
      });
    }
    return this.resolving;
  }

  async record(rec: LLMCallRecord): Promise<void> {
    const a = await this.getAdapter();
    return a.record(rec);
  }

  async flush(): Promise<void> {
    if (!this.resolved) return; // Nothing loaded yet — nothing to flush.
    return this.resolved.flush();
  }
}
