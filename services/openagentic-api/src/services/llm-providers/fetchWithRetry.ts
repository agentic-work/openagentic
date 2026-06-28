/**
 * fetchWithRetry — retry wrapper for upstream LLM provider HTTP calls that
 * survives transient 429s (TPM throttling) and 5xx without surfacing failover
 * to the user.
 *
 * Why: AzureAIFoundryProvider issues raw fetch() to the AIF deployment
 * endpoint. AIF throttles by tokens-per-minute at the deployment level and
 * returns 429 with a Retry-After header. The previous code had no retry —
 * a single 429 raised "All providers failed" because there's only one gpt-5.4
 * deployment to fail over to. This is the missing retry layer.
 *
 * Behaviour:
 *   - 200..399: pass through unchanged.
 *   - 429: read Retry-After header (seconds), wait clamp(retryAfter, [1,30])s,
 *     retry. If header missing, exponential backoff baseBackoffMs * 2^attempt
 *     with full jitter.
 *   - 5xx (except 501/505): treat like 429.
 *   - Other 4xx: pass through (do not retry — caller decides).
 *   - Network error (TypeError from fetch): treat like 429.
 *   - After maxRetries exhausted: throw with the last response or error.
 *
 * Caller-tunable defaults: maxRetries=3, baseBackoffMs=500.
 */

import type { Logger } from 'pino';

export interface FetchWithRetryOptions {
  maxRetries?: number;
  baseBackoffMs?: number;
  logger?: Logger;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 500;
const MIN_RETRY_AFTER_S = 1;
const MAX_RETRY_AFTER_S = 30;

const RETRYABLE_5XX = new Set([500, 502, 503, 504]);

function shouldRetryStatus(status: number): boolean {
  return status === 429 || RETRYABLE_5XX.has(status);
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.min(Math.max(parsed, MIN_RETRY_AFTER_S), MAX_RETRY_AFTER_S);
}

function backoffWithJitter(attempt: number, baseMs: number): number {
  // "Equal jitter" — between exp/2 and exp. Guarantees a non-trivial wait
  // (avoids the full-jitter case where attempt 0 sleeps 0ms and we retry
  // instantly, which throttles harder).
  const exp = baseMs * Math.pow(2, attempt);
  const half = Math.floor(exp / 2);
  return half + Math.floor(Math.random() * half);
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const logger = opts.logger;

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return response;
      }
      if (!shouldRetryStatus(response.status)) {
        return response;
      }
      lastResponse = response;
      if (attempt >= maxRetries) {
        break;
      }
      const retryAfterS = parseRetryAfter(response.headers);
      const waitMs = retryAfterS !== null
        ? retryAfterS * 1000
        : backoffWithJitter(attempt, baseBackoffMs);
      logger?.warn?.(
        { url: typeof url === 'string' ? url : url.toString(), status: response.status, attempt: attempt + 1, waitMs, retryAfterS },
        '[fetchWithRetry] retrying after upstream throttle/5xx',
      );
      await sleep(waitMs);
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) {
        break;
      }
      const waitMs = backoffWithJitter(attempt, baseBackoffMs);
      logger?.warn?.(
        { url: typeof url === 'string' ? url : url.toString(), err: (err as Error)?.message, attempt: attempt + 1, waitMs },
        '[fetchWithRetry] retrying after network error',
      );
      await sleep(waitMs);
    }
  }

  if (lastResponse) {
    const errText = await lastResponse.clone().text().catch(() => '');
    throw new Error(
      `fetchWithRetry: upstream returned ${lastResponse.status} after ${maxRetries} retries — ${errText.substring(0, 200)}`,
    );
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchWithRetry: failed after ${maxRetries} retries`);
}
