/**
 * TraceSigner — produces signed, replay-identical traces of workflow runs.
 *
 * Each event the engine emits is appended to a buffer; on completion the
 * buffer is canonicalized (deterministic JSON), hashed (SHA-256), and
 * signed (HMAC) with a shared signing secret. A verifier function
 * recomputes both the hash and the signature; a tamper anywhere in the
 * trace flips both.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  hashTrace,
  signTrace,
  verifyTrace,
  type TraceEvent,
} from '../TraceSigner';

const SECRET = 'test-signing-secret-do-not-use-in-prod';

const sampleEvents: TraceEvent[] = [
  { type: 'execution_start', executionId: 'r-1', timestamp: '2026-04-26T10:00:00Z' },
  { type: 'node_start', executionId: 'r-1', nodeId: 'n1', timestamp: '2026-04-26T10:00:01Z' },
  { type: 'node_complete', executionId: 'r-1', nodeId: 'n1', output: { ok: true }, timestamp: '2026-04-26T10:00:02Z' },
  { type: 'execution_complete', executionId: 'r-1', timestamp: '2026-04-26T10:00:03Z' },
];

describe('TraceSigner', () => {
  describe('canonicalize', () => {
    it('produces stable bytes regardless of key insertion order', () => {
      const a = canonicalize([
        { type: 'node_start', executionId: 'r-1', nodeId: 'n1', timestamp: 't' },
      ]);
      const b = canonicalize([
        { timestamp: 't', nodeId: 'n1', executionId: 'r-1', type: 'node_start' },
      ]);
      expect(a).toBe(b);
    });

    it('preserves array order — events stay in the order emitted', () => {
      const a = canonicalize(sampleEvents);
      const b = canonicalize([...sampleEvents].reverse());
      expect(a).not.toBe(b);
    });

    it('canonicalizes nested objects deterministically (recursive key sort)', () => {
      const a = canonicalize([
        { type: 'node_complete', output: { z: 1, a: 2, m: { y: 1, x: 2 } }, ts: 't' },
      ]);
      const b = canonicalize([
        { ts: 't', type: 'node_complete', output: { m: { x: 2, y: 1 }, a: 2, z: 1 } },
      ]);
      expect(a).toBe(b);
    });
  });

  describe('hashTrace', () => {
    it('returns a 64-char hex SHA-256 of the canonicalized trace', () => {
      const h = hashTrace(sampleEvents);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different events → different hash', () => {
      const h1 = hashTrace(sampleEvents);
      const h2 = hashTrace([
        ...sampleEvents,
        { type: 'rogue', executionId: 'r-1', timestamp: 't-extra' },
      ]);
      expect(h1).not.toBe(h2);
    });
  });

  describe('signTrace + verifyTrace', () => {
    it('signs deterministically — same events + same secret → same signature', () => {
      const s1 = signTrace(sampleEvents, SECRET);
      const s2 = signTrace(sampleEvents, SECRET);
      expect(s1.signature).toBe(s2.signature);
      expect(s1.contentHash).toBe(s2.contentHash);
      expect(s1.algorithm).toBe('hmac-sha256');
    });

    it('verifies a fresh signature successfully', () => {
      const signed = signTrace(sampleEvents, SECRET);
      expect(
        verifyTrace(sampleEvents, signed.signature, signed.contentHash, SECRET),
      ).toBe(true);
    });

    it('rejects a verification when ANY event was tampered', () => {
      const signed = signTrace(sampleEvents, SECRET);
      const tampered: TraceEvent[] = sampleEvents.map((e, i) =>
        i === 2 ? { ...e, output: { ok: false } } : e,
      );
      expect(
        verifyTrace(tampered, signed.signature, signed.contentHash, SECRET),
      ).toBe(false);
    });

    it('rejects when contentHash mismatches the events', () => {
      const signed = signTrace(sampleEvents, SECRET);
      const tampered: TraceEvent[] = [...sampleEvents, { type: 'extra', timestamp: 'x' } as any];
      expect(
        verifyTrace(tampered, signed.signature, signed.contentHash, SECRET),
      ).toBe(false);
    });

    it('rejects when the signing secret differs', () => {
      const signed = signTrace(sampleEvents, SECRET);
      expect(
        verifyTrace(sampleEvents, signed.signature, signed.contentHash, 'other-secret'),
      ).toBe(false);
    });
  });
});
