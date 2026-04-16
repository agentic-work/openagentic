/**
 * Structured Error Classification for LLM Provider Failover
 *
 * Provides typed error classification so that agents, workflows, and the
 * ProviderManager can make smart retry/failover decisions instead of
 * parsing error strings.
 */

// ---------------------------------------------------------------------------
// Failover reason taxonomy
// ---------------------------------------------------------------------------

export type FailoverReason =
  | 'auth'              // 401/403, bad API key, expired token
  | 'billing'           // 402, quota exhausted, account suspended
  | 'rate_limit'        // 429, too many requests
  | 'timeout'           // ETIMEDOUT, ESOCKETTIMEDOUT, AbortError
  | 'format'            // Malformed request / unsupported param
  | 'model_not_found'   // Model ID doesn't exist on provider
  | 'context_length'    // Input too long for model
  | 'content_filter'    // Content policy violation
  | 'server_error'      // 5xx from provider
  | 'network'           // DNS, TCP, TLS failures
  | 'unknown';

export interface FailoverClassification {
  reason: FailoverReason;
  retryable: boolean;
  /** Suggested delay before retry in ms (0 = don't retry) */
  retryAfterMs: number;
  /** Should we try a different provider instead of retrying same one? */
  shouldFailover: boolean;
  /** Human-readable summary */
  message: string;
  /** Original error for logging */
  originalError: unknown;
  /** HTTP status if available */
  httpStatus?: number;
  /** Provider that generated the error */
  provider?: string;
}

// ---------------------------------------------------------------------------
// Classification logic — 5-layer approach
// ---------------------------------------------------------------------------

/**
 * Classify an error into a FailoverClassification.
 *
 * Layers:
 *  1. HTTP status code (if available)
 *  2. Error code / error type string
 *  3. Error message patterns
 *  4. Error class / name
 *  5. Fallback to 'unknown'
 */
export function classifyError(error: unknown, provider?: string): FailoverClassification {
  const base = {
    originalError: error,
    provider,
    httpStatus: extractHttpStatus(error),
  };

  // Layer 1: HTTP status
  const status = base.httpStatus;
  if (status) {
    const byStatus = classifyByStatus(status, error);
    if (byStatus) return { ...base, ...byStatus } as FailoverClassification;
  }

  // Layer 2: Error code
  const code = extractErrorCode(error);
  if (code) {
    const byCode = classifyByCode(code, error);
    if (byCode) return { ...base, ...byCode } as FailoverClassification;
  }

  // Layer 3: Message patterns
  const msg = extractMessage(error);
  if (msg) {
    const byMsg = classifyByMessage(msg, error);
    if (byMsg) return { ...base, ...byMsg } as FailoverClassification;
  }

  // Layer 4: Error class
  const byClass = classifyByClass(error);
  if (byClass) return { ...base, ...byClass } as FailoverClassification;

  // Layer 5: Fallback
  return {
    ...base,
    reason: 'unknown',
    retryable: false,
    retryAfterMs: 0,
    shouldFailover: true,
    message: `Unknown error: ${msg || String(error)}`,
  };
}

// ---------------------------------------------------------------------------
// Layer implementations
// ---------------------------------------------------------------------------

function classifyByStatus(status: number, error: unknown): Partial<FailoverClassification> | null {
  if (status === 401 || status === 403) {
    return {
      reason: 'auth',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: `Authentication failed (HTTP ${status})`,
    };
  }
  if (status === 402) {
    return {
      reason: 'billing',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: 'Billing/quota issue — try a different provider',
    };
  }
  if (status === 429) {
    const retryAfter = extractRetryAfter(error);
    return {
      reason: 'rate_limit',
      retryable: true,
      retryAfterMs: retryAfter,
      shouldFailover: retryAfter > 10_000, // failover if wait > 10s
      message: `Rate limited — retry after ${retryAfter}ms`,
    };
  }
  if (status === 404) {
    return {
      reason: 'model_not_found',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: 'Model or endpoint not found (HTTP 404)',
    };
  }
  if (status === 400) {
    const msg = extractMessage(error)?.toLowerCase() || '';
    if (msg.includes('context') || msg.includes('token') || msg.includes('too long') || msg.includes('maximum')) {
      return {
        reason: 'context_length',
        retryable: false,
        retryAfterMs: 0,
        shouldFailover: false,
        message: 'Input exceeds model context length',
      };
    }
    if (msg.includes('content') && (msg.includes('filter') || msg.includes('policy') || msg.includes('safety'))) {
      return {
        reason: 'content_filter',
        retryable: false,
        retryAfterMs: 0,
        shouldFailover: false,
        message: 'Content policy violation',
      };
    }
    return {
      reason: 'format',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: `Bad request (HTTP 400): ${msg.slice(0, 120)}`,
    };
  }
  if (status >= 500) {
    return {
      reason: 'server_error',
      retryable: true,
      retryAfterMs: 2000,
      shouldFailover: true,
      message: `Provider server error (HTTP ${status})`,
    };
  }
  return null;
}

function classifyByCode(code: string, _error: unknown): Partial<FailoverClassification> | null {
  const c = code.toLowerCase();
  if (c === 'econnrefused' || c === 'enotfound' || c === 'econnreset' || c === 'epipe') {
    return {
      reason: 'network',
      retryable: true,
      retryAfterMs: 1000,
      shouldFailover: true,
      message: `Network error: ${code}`,
    };
  }
  if (c === 'etimedout' || c === 'esockettimedout' || c === 'econnaborted') {
    return {
      reason: 'timeout',
      retryable: true,
      retryAfterMs: 2000,
      shouldFailover: true,
      message: `Timeout: ${code}`,
    };
  }
  if (c === 'err_canceled' || c === 'abort_err') {
    return {
      reason: 'timeout',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: 'Request was aborted',
    };
  }
  if (c.includes('throttl') || c.includes('rate')) {
    return {
      reason: 'rate_limit',
      retryable: true,
      retryAfterMs: 5000,
      shouldFailover: true,
      message: `Rate limited: ${code}`,
    };
  }
  return null;
}

function classifyByMessage(msg: string, error: unknown): Partial<FailoverClassification> | null {
  const m = msg.toLowerCase();

  // Auth patterns
  if (m.includes('unauthorized') || m.includes('invalid api key') || m.includes('invalid token')
      || m.includes('access denied') || m.includes('forbidden')) {
    return {
      reason: 'auth',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: `Auth error: ${msg.slice(0, 120)}`,
    };
  }

  // Model not found patterns
  if (m.includes('model not found') || m.includes('resource not found')
      || m.includes('does not exist') || m.includes('no match for platform')
      || m.includes('is not available') || m.includes('not currently available')) {
    return {
      reason: 'model_not_found',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: `Model not found: ${msg.slice(0, 120)}`,
    };
  }

  // Context length patterns
  if (m.includes('context length') || m.includes('token limit') || m.includes('maximum context')
      || m.includes('too many tokens') || m.includes('input is too long')) {
    return {
      reason: 'context_length',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: `Context length exceeded: ${msg.slice(0, 120)}`,
    };
  }

  // Content filter patterns
  if (m.includes('content filter') || m.includes('content policy') || m.includes('safety filter')
      || m.includes('responsible ai')) {
    return {
      reason: 'content_filter',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: `Content filter triggered: ${msg.slice(0, 120)}`,
    };
  }

  // Rate limit patterns
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('throttl')
      || m.includes('quota exceeded')) {
    const retryAfter = extractRetryAfter(error);
    return {
      reason: 'rate_limit',
      retryable: true,
      retryAfterMs: retryAfter,
      shouldFailover: retryAfter > 10_000,
      message: `Rate limited: ${msg.slice(0, 120)}`,
    };
  }

  // Billing patterns
  if (m.includes('insufficient_quota') || m.includes('billing') || m.includes('payment required')
      || m.includes('account suspended')) {
    return {
      reason: 'billing',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: true,
      message: `Billing issue: ${msg.slice(0, 120)}`,
    };
  }

  // Timeout patterns
  if (m.includes('timeout') || m.includes('timed out') || m.includes('deadline exceeded')) {
    return {
      reason: 'timeout',
      retryable: true,
      retryAfterMs: 2000,
      shouldFailover: true,
      message: `Timeout: ${msg.slice(0, 120)}`,
    };
  }

  return null;
}

function classifyByClass(error: unknown): Partial<FailoverClassification> | null {
  if (error instanceof TypeError) {
    return {
      reason: 'format',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: `Type error: ${(error as Error).message?.slice(0, 120)}`,
    };
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return {
      reason: 'timeout',
      retryable: false,
      retryAfterMs: 0,
      shouldFailover: false,
      message: 'Request aborted',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utility extractors
// ---------------------------------------------------------------------------

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as any;
  return e.status ?? e.statusCode ?? e.response?.status ?? e.response?.statusCode ?? undefined;
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as any;
  return e.code ?? e.error?.code ?? e.body?.error?.code ?? undefined;
}

function extractMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return undefined;
  const e = error as any;
  return e.message ?? e.error?.message ?? e.body?.error?.message ?? e.body?.message ?? undefined;
}

function extractRetryAfter(error: unknown): number {
  if (!error || typeof error !== 'object') return 5000;
  const e = error as any;
  const header = e.headers?.['retry-after'] ?? e.response?.headers?.['retry-after'];
  if (header) {
    const seconds = parseFloat(header);
    if (!isNaN(seconds)) return Math.min(seconds * 1000, 60_000);
  }
  return 5000; // Default 5s
}

// ---------------------------------------------------------------------------
// Convenience: should we retry this error on the *same* provider?
// ---------------------------------------------------------------------------

export function shouldRetry(classification: FailoverClassification): boolean {
  return classification.retryable && !classification.shouldFailover;
}

// ---------------------------------------------------------------------------
// Convenience: wrap an error into a FailoverError class
// ---------------------------------------------------------------------------

export class FailoverError extends Error {
  readonly classification: FailoverClassification;

  constructor(classification: FailoverClassification) {
    super(classification.message);
    this.name = 'FailoverError';
    this.classification = classification;
  }

  get reason(): FailoverReason { return this.classification.reason; }
  get retryable(): boolean { return this.classification.retryable; }
  get shouldFailover(): boolean { return this.classification.shouldFailover; }
  get retryAfterMs(): number { return this.classification.retryAfterMs; }
  get httpStatus(): number | undefined { return this.classification.httpStatus; }
  get provider(): string | undefined { return this.classification.provider; }
}

/**
 * Classify and wrap an error in one step.
 */
export function toFailoverError(error: unknown, provider?: string): FailoverError {
  const classification = classifyError(error, provider);
  return new FailoverError(classification);
}
