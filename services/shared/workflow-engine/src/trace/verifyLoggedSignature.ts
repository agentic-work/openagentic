/**
 * verifyLoggedSignature
 *
 * Pillar 2 verification helper. Operators retrieve the engine's
 * "Run trace signed (Pillar 2)" log line and the matching event list
 * (e.g. from workflow_execution_logs), and call this to confirm the
 * stored run actually matches the signature in logs.
 *
 * Returns a {ok, reason} result so the caller can branch on the
 * specific failure mode:
 *   - bad_log              — log shape didn't include signedTrace
 *   - hash_mismatch        — events were tampered after signing
 *   - signature_mismatch   — signing secret rotated or wrong key
 */

import { hashTrace, type TraceEvent } from './TraceSigner.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifyReason = 'bad_log' | 'hash_mismatch' | 'signature_mismatch';

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyReason;
}

interface SignedTraceShape {
  contentHash?: unknown;
  signature?: unknown;
  algorithm?: unknown;
}

interface LogShape {
  signedTrace?: SignedTraceShape;
}

export function verifyLoggedSignature(
  logEntry: unknown,
  events: TraceEvent[],
  secret: string,
): VerifyResult {
  // Accept either a parsed object or a raw JSON string.
  let parsed: LogShape;
  if (typeof logEntry === 'string') {
    try {
      parsed = JSON.parse(logEntry);
    } catch {
      return { ok: false, reason: 'bad_log' };
    }
  } else if (logEntry && typeof logEntry === 'object') {
    parsed = logEntry as LogShape;
  } else {
    return { ok: false, reason: 'bad_log' };
  }

  const t = parsed.signedTrace;
  if (
    !t ||
    typeof t.contentHash !== 'string' ||
    typeof t.signature !== 'string'
  ) {
    return { ok: false, reason: 'bad_log' };
  }

  const recomputedHash = hashTrace(events);
  if (recomputedHash !== t.contentHash) {
    return { ok: false, reason: 'hash_mismatch' };
  }

  const expected = createHmac('sha256', secret)
    .update(t.contentHash)
    .digest('hex');
  if (expected.length !== t.signature.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  try {
    const ok = timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(t.signature, 'hex'),
    );
    return ok
      ? { ok: true }
      : { ok: false, reason: 'signature_mismatch' };
  } catch {
    return { ok: false, reason: 'signature_mismatch' };
  }
}
