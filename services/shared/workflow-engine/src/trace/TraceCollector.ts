/**
 * TraceCollector — per-execution event buffer that produces a signed
 * trace on completion (Pillar 2).
 *
 * The engine constructs a TraceCollector at the start of every run,
 * passes it the signing secret, and `append()`s every event it would
 * normally emit. On execution_complete the engine calls `sign()` to
 * get a SignedTrace which gets persisted alongside the run record.
 *
 * Replay mode reads the persisted events back, calls verifyTrace
 * against the stored signature/hash, and rejects on tamper.
 */

import { signTrace, type SignedTrace, type TraceEvent } from './TraceSigner.js';

export interface SignedExecutionTrace extends SignedTrace {
  executionId: string;
  eventCount: number;
  signedAt: string; // ISO timestamp
}

export class TraceCollector {
  private events: TraceEvent[] = [];

  constructor(
    private readonly executionId: string,
    private readonly secret: string,
  ) {}

  append(event: TraceEvent): void {
    this.events.push(event);
  }

  getEvents(): TraceEvent[] {
    // Defensive copy — callers should not be able to mutate the buffer
    // from the outside without going through append/reset.
    return this.events.slice();
  }

  sign(): SignedExecutionTrace {
    const signed = signTrace(this.events, this.secret);
    return {
      ...signed,
      executionId: this.executionId,
      eventCount: this.events.length,
      signedAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.events = [];
  }
}
