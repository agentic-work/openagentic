/**
 * TraceSigner — signed, replay-identical execution traces (Pillar 2).
 *
 * Workflow runs accumulate a list of TraceEvent. On completion the list
 * is canonicalized (deterministic JSON — recursive key sort, array
 * order preserved), hashed (SHA-256), and signed (HMAC-SHA256) with
 * a shared signing secret. Verification recomputes both — any tamper
 * to events, hash, or signature flips the verification.
 *
 * The signing secret comes from `process.env.SIGNING_SECRET` in the
 * engine, but the API surface here takes it as a parameter so unit
 * tests don't depend on global env state.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface TraceEvent {
  type: string;
  [k: string]: unknown;
}

export interface SignedTrace {
  /** Hex SHA-256 of canonical(events). */
  contentHash: string;
  /** Hex HMAC-SHA256 of contentHash, keyed by the secret. */
  signature: string;
  /** Always 'hmac-sha256' for this version — bumped if we rotate algorithms. */
  algorithm: 'hmac-sha256';
}

/**
 * Recursively sort object keys; arrays keep their order. JSON-stringify
 * the result with no whitespace. Two value-equal traces emitted on
 * different machines or by different engines produce identical bytes.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

/** Hex SHA-256 of canonicalize(events). */
export function hashTrace(events: TraceEvent[]): string {
  return createHash('sha256').update(canonicalize(events)).digest('hex');
}

/** Sign a trace — produces {contentHash, signature, algorithm}. */
export function signTrace(events: TraceEvent[], secret: string): SignedTrace {
  const contentHash = hashTrace(events);
  const signature = createHmac('sha256', secret).update(contentHash).digest('hex');
  return { contentHash, signature, algorithm: 'hmac-sha256' };
}

/**
 * Verify a (events, signature, contentHash) triple under `secret`.
 *
 * Returns false on:
 *  - hash recomputed from events doesn't match `contentHash`
 *  - HMAC of `contentHash` under `secret` doesn't match `signature`
 *  - any decoding error (malformed signature/hash hex)
 *
 * Uses `timingSafeEqual` so callers can't time-attack the signature.
 */
export function verifyTrace(
  events: TraceEvent[],
  signature: string,
  contentHash: string,
  secret: string,
): boolean {
  try {
    const recomputedHash = hashTrace(events);
    if (recomputedHash !== contentHash) return false;
    const expected = createHmac('sha256', secret).update(contentHash).digest('hex');
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
