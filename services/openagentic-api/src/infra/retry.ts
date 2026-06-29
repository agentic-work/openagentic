/**
 * Shared Retry Framework
 *
 * Configurable async retry with exponential backoff, jitter, and
 * AbortSignal awareness.  Integrates with FailoverError for smart
 * "should I retry?" decisions.
 */

import { type FailoverClassification, classifyError } from '../services/llm-providers/FailoverError.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Maximum number of attempts (including the first). min 1 */
  maxAttempts: number;
  /** Base delay in ms between retries */
  baseDelayMs: number;
  /** Maximum delay cap in ms */
  maxDelayMs: number;
  /** Exponential backoff multiplier (1 = constant delay) */
  backoffMultiplier: number;
  /** Jitter factor (0 = none, 1 = full random jitter) */
  jitterFactor: number;
  /**
   * Custom predicate — return `true` to retry, `false` to stop.
   * When omitted, retries any error unless FailoverError says non-retryable.
   */
  shouldRetry?: (error: unknown, attempt: number, classification: FailoverClassification) => boolean;
  /** Called before each retry — useful for logging */
  onRetry?: (error: unknown, attempt: number, delayMs: number, classification: FailoverClassification) => void;
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

export const RETRY_POLICY_LLM: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterFactor: 0.3,
  shouldRetry: (_err, _attempt, c) => c.retryable,
};

export const RETRY_POLICY_MCP: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  shouldRetry: (_err, _attempt, c) => c.retryable && c.reason !== 'auth',
};

export const RETRY_POLICY_INFRA: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  backoffMultiplier: 2,
  jitterFactor: 0.5,
};

export const RETRY_POLICY_K8S: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 2000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterFactor: 0.4,
  shouldRetry: (_err, _attempt, c) => c.retryable || c.reason === 'server_error',
};

// ---------------------------------------------------------------------------
// Core retry function
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with retry according to `policy`.
 *
 * @param fn        The async function to execute.
 * @param policy    Retry policy (or partial — merged with defaults).
 * @param signal    Optional AbortSignal — if aborted, stops retrying immediately.
 * @param provider  Optional provider name for error classification context.
 */
export async function retryAsync<T>(
  fn: (attempt: number, signal?: AbortSignal) => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  signal?: AbortSignal,
  provider?: string,
): Promise<T> {
  const p: RetryPolicy = {
    maxAttempts: policy.maxAttempts ?? 3,
    baseDelayMs: policy.baseDelayMs ?? 1000,
    maxDelayMs: policy.maxDelayMs ?? 30_000,
    backoffMultiplier: policy.backoffMultiplier ?? 2,
    jitterFactor: policy.jitterFactor ?? 0.3,
    shouldRetry: policy.shouldRetry,
    onRetry: policy.onRetry,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    // Abort check
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn(attempt, signal);
    } catch (error) {
      lastError = error;

      // Don't retry if this was the last attempt
      if (attempt >= p.maxAttempts) break;

      // Classify the error
      const classification = classifyError(error, provider);

      // Check if we should retry
      const retry = p.shouldRetry
        ? p.shouldRetry(error, attempt, classification)
        : classification.retryable;

      if (!retry) break;

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = p.baseDelayMs * Math.pow(p.backoffMultiplier, attempt - 1);
      const cappedDelay = Math.min(exponentialDelay, p.maxDelayMs);
      const jitter = cappedDelay * p.jitterFactor * Math.random();
      const delayMs = Math.round(cappedDelay + jitter);

      // Use provider-suggested retry-after if larger
      const effectiveDelay = Math.max(delayMs, classification.retryAfterMs);

      // Notify callback
      p.onRetry?.(error, attempt, effectiveDelay, classification);

      // Wait (abort-aware)
      await abortableDelay(effectiveDelay, signal);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Clean up listener when timer fires normally
      const origResolve = resolve;
      // Note: we need to ensure we remove the listener
      setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
      }, ms + 1);
    }
  });
}
