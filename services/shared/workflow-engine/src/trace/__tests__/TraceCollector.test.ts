/**
 * TraceCollector — buffers events for one execution and produces a
 * signed trace on completion. This is what the engine wires into its
 * emitEvent path so every run gets a tamper-evident transcript.
 *
 * Tests:
 *   - append() preserves event order
 *   - sign() returns the SignedTrace + a reference to the events
 *   - reset() clears buffer (for re-use across runs)
 *   - sign() before any events returns hash-of-empty-array (still verifies)
 *   - constructor takes a secret + executionId
 */
import { describe, it, expect } from 'vitest';
import { TraceCollector } from '../TraceCollector';
import { verifyTrace } from '../TraceSigner';

const SECRET = 'collector-test-secret';

describe('TraceCollector', () => {
  it('appends events in order and exposes them via getEvents()', () => {
    const c = new TraceCollector('exec-1', SECRET);
    c.append({ type: 'execution_start', executionId: 'exec-1' });
    c.append({ type: 'node_start', nodeId: 'n1' });
    c.append({ type: 'node_complete', nodeId: 'n1' });
    const events = c.getEvents();
    expect(events.map((e) => e.type)).toEqual([
      'execution_start',
      'node_start',
      'node_complete',
    ]);
  });

  it('sign() returns a SignedTrace whose verifyTrace returns true', () => {
    const c = new TraceCollector('exec-2', SECRET);
    c.append({ type: 'execution_start', executionId: 'exec-2' });
    c.append({ type: 'execution_complete', executionId: 'exec-2' });
    const result = c.sign();
    expect(result.executionId).toBe('exec-2');
    expect(result.eventCount).toBe(2);
    expect(result.algorithm).toBe('hmac-sha256');
    expect(
      verifyTrace(c.getEvents(), result.signature, result.contentHash, SECRET),
    ).toBe(true);
  });

  it('sign() with no events still produces a valid signature over the empty array', () => {
    const c = new TraceCollector('exec-empty', SECRET);
    const result = c.sign();
    expect(result.eventCount).toBe(0);
    expect(verifyTrace([], result.signature, result.contentHash, SECRET)).toBe(true);
  });

  it('reset() clears events so the collector can be reused', () => {
    const c = new TraceCollector('exec-3', SECRET);
    c.append({ type: 'a' });
    c.append({ type: 'b' });
    expect(c.getEvents()).toHaveLength(2);
    c.reset();
    expect(c.getEvents()).toHaveLength(0);
  });

  it('two collectors with the same events + same secret produce the same signature', () => {
    const c1 = new TraceCollector('exec-4', SECRET);
    const c2 = new TraceCollector('exec-4', SECRET);
    const events = [
      { type: 'execution_start' },
      { type: 'node_start', nodeId: 'x' },
      { type: 'execution_complete' },
    ];
    for (const e of events) { c1.append(e); c2.append(e); }
    expect(c1.sign().signature).toBe(c2.sign().signature);
  });
});
