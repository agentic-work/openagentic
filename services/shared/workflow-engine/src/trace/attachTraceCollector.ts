/**
 * attachTraceCollector — non-invasive subscription helper for Pillar 2.
 *
 * The WorkflowExecutionEngine extends EventEmitter and broadcasts every
 * step on the `'event'` channel. attachTraceCollector subscribes to that
 * channel, accumulates the events into a TraceCollector, and returns
 * a handle:
 *
 *   - getEvents()  — current buffer (defensive copy)
 *   - finalize()   — sign the buffer, detach the listener, return the
 *                    SignedExecutionTrace
 *   - detach()     — remove the listener WITHOUT signing (early-abort)
 *
 * Caller is responsible for calling exactly one of finalize()/detach()
 * per execution to avoid leaking listeners.
 */

import type { EventEmitter } from 'node:events';
import { TraceCollector } from './TraceCollector.js';
import type { SignedExecutionTrace } from './TraceCollector.js';
import type { TraceEvent } from './TraceSigner.js';

export interface TraceCollectorHandle {
  getEvents(): TraceEvent[];
  finalize(): SignedExecutionTrace;
  detach(): void;
}

export function attachTraceCollector(
  emitter: EventEmitter,
  executionId: string,
  secret: string,
): TraceCollectorHandle {
  const collector = new TraceCollector(executionId, secret);
  const listener = (event: TraceEvent) => {
    collector.append(event);
  };
  emitter.on('event', listener);

  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    emitter.off('event', listener);
  };

  return {
    getEvents: () => collector.getEvents(),
    finalize: () => {
      const signed = collector.sign();
      detach();
      return signed;
    },
    detach,
  };
}
