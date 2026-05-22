/**
 * attachTraceCollector — non-invasive subscription helper.
 *
 * Listens to an EventEmitter (the WorkflowExecutionEngine implements
 * EventEmitter) for 'event' notifications and accumulates them in a
 * TraceCollector. Returns a `finalize()` closure that signs and
 * detaches.
 *
 * The point: we get tamper-evident traces without touching
 * WorkflowExecutionEngine — caller wires this into the existing
 * `engine.on('event', …)` channel.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachTraceCollector } from '../attachTraceCollector';
import { verifyTrace } from '../TraceSigner';

const SECRET = 'attach-test-secret';

describe('attachTraceCollector', () => {
  it('captures every event emitted on the channel until finalize()', () => {
    const ee = new EventEmitter();
    const handle = attachTraceCollector(ee, 'exec-1', SECRET);

    ee.emit('event', { type: 'execution_start', executionId: 'exec-1' });
    ee.emit('event', { type: 'node_start', nodeId: 'n1' });
    ee.emit('event', { type: 'node_complete', nodeId: 'n1', output: { ok: true } });
    ee.emit('event', { type: 'execution_complete', executionId: 'exec-1' });

    const signed = handle.finalize();
    expect(signed.eventCount).toBe(4);
    expect(signed.executionId).toBe('exec-1');
    expect(verifyTrace(handle.getEvents(), signed.signature, signed.contentHash, SECRET)).toBe(true);
  });

  it('finalize() detaches the listener — events emitted after finalize are NOT captured', () => {
    const ee = new EventEmitter();
    const handle = attachTraceCollector(ee, 'exec-2', SECRET);

    ee.emit('event', { type: 'a' });
    handle.finalize();
    ee.emit('event', { type: 'b' }); // post-finalize: must be ignored
    expect(handle.getEvents().map((e) => e.type)).toEqual(['a']);
  });

  it('handles arbitrary event payloads without throwing on weird shapes', () => {
    const ee = new EventEmitter();
    const handle = attachTraceCollector(ee, 'exec-3', SECRET);

    ee.emit('event', { type: 'x', nested: { circular: null as any } });
    ee.emit('event', { type: 'y' });

    const signed = handle.finalize();
    expect(signed.eventCount).toBe(2);
  });

  it('detach() without finalize() is also safe (used on early abort)', () => {
    const ee = new EventEmitter();
    const handle = attachTraceCollector(ee, 'exec-4', SECRET);

    ee.emit('event', { type: 'a' });
    handle.detach();
    ee.emit('event', { type: 'b' }); // post-detach: ignored
    expect(handle.getEvents().map((e) => e.type)).toEqual(['a']);
  });

  it('two attachments on the same emitter are independent', () => {
    const ee = new EventEmitter();
    const h1 = attachTraceCollector(ee, 'r-1', SECRET);
    const h2 = attachTraceCollector(ee, 'r-2', SECRET);

    ee.emit('event', { type: 'shared' });
    h1.finalize();
    ee.emit('event', { type: 'after-h1-final' }); // h2 still captures, h1 doesn't

    const s2 = h2.finalize();
    expect(h1.getEvents().map((e) => e.type)).toEqual(['shared']);
    expect(h2.getEvents().map((e) => e.type)).toEqual(['shared', 'after-h1-final']);
    expect(s2.eventCount).toBe(2);
  });
});
