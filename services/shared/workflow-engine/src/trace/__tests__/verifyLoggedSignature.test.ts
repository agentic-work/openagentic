/**
 * verifyLoggedSignature — given a JSON log line emitted by the engine
 * and the matching list of events (e.g. retrieved from the per-step
 * workflow execution log table), recompute and verify the signature.
 *
 * The engine logs:
 *   { signedTrace: { contentHash, signature, algorithm, ... } }
 *
 * Operators reach for this helper when validating that a stored run
 * really matches the signature they recorded — useful for compliance
 * audits and replay-identical mode (Pillar 2).
 *
 * Tests assert it accepts both an already-parsed log object and a
 * raw JSON string, and rejects on every mutation surface.
 */
import { describe, it, expect } from 'vitest';
import { signTrace, type TraceEvent } from '../TraceSigner';
import { verifyLoggedSignature } from '../verifyLoggedSignature';

const SECRET = 'verify-test-secret';

const events: TraceEvent[] = [
  { type: 'execution_start', executionId: 'r-1' },
  { type: 'node_start', nodeId: 'n1' },
  { type: 'node_complete', nodeId: 'n1' },
  { type: 'execution_complete', executionId: 'r-1' },
];

function makeLog() {
  const signed = signTrace(events, SECRET);
  return {
    msg: '[WorkflowEngine] Run trace signed (Pillar 2)',
    signedTrace: signed,
  };
}

describe('verifyLoggedSignature', () => {
  it('returns ok=true for a fresh log + matching events + correct secret', () => {
    const log = makeLog();
    const r = verifyLoggedSignature(log, events, SECRET);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('accepts the log as a raw JSON string', () => {
    const log = makeLog();
    const r = verifyLoggedSignature(JSON.stringify(log), events, SECRET);
    expect(r.ok).toBe(true);
  });

  it('rejects with reason="hash_mismatch" when events were tampered', () => {
    const log = makeLog();
    const tampered: TraceEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, nodeId: 'changed' } : e,
    );
    const r = verifyLoggedSignature(log, tampered, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('hash_mismatch');
  });

  it('rejects with reason="signature_mismatch" when secret is wrong', () => {
    const log = makeLog();
    const r = verifyLoggedSignature(log, events, 'wrong-secret');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  it('rejects with reason="bad_log" when the input has no signedTrace', () => {
    const r = verifyLoggedSignature({ msg: 'unrelated log' }, events, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_log');
  });

  it('rejects with reason="bad_log" on malformed JSON string input', () => {
    const r = verifyLoggedSignature('{not json', events, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_log');
  });
});
