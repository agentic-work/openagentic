/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SSE Event Sequencer
 *
 * Adds monotonic sequence numbers, run IDs, and timestamps to every
 * SSE event.  Clients can detect gaps, reorder events, and merge
 * parallel agent streams.
 *
 * Wire format (fields prefixed with _ to avoid collision):
 *   { _seq: 42, _runId: "abc123", _ts: 1708000000000, _agentId?: "agent-7", ...payload }
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SequencedEvent<T = Record<string, unknown>> {
  _seq: number;
  _runId: string;
  _ts: number;
  _agentId?: string;
  [key: string]: unknown;
}

export interface EventSequencerOptions {
  /** Run ID — defaults to a new UUID */
  runId?: string;
  /** Optional agent ID for multi-agent parallel streams */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// EventSequencer
// ---------------------------------------------------------------------------

export class EventSequencer {
  private seq = 0;
  readonly runId: string;
  readonly agentId?: string;

  constructor(opts: EventSequencerOptions = {}) {
    this.runId = opts.runId ?? randomUUID();
    this.agentId = opts.agentId;
  }

  /**
   * Wrap a payload object with sequence metadata.
   */
  wrap<T extends Record<string, unknown>>(payload: T): SequencedEvent<T> {
    this.seq += 1;
    const event: SequencedEvent<T> = {
      _seq: this.seq,
      _runId: this.runId,
      _ts: Date.now(),
      ...payload,
    };
    if (this.agentId) {
      event._agentId = this.agentId;
    }
    return event;
  }

  /**
   * Current sequence number (last emitted).
   */
  get currentSeq(): number {
    return this.seq;
  }

  /**
   * Create a child sequencer for a sub-agent. Shares the runId but
   * has its own sequence counter and agentId.
   */
  child(agentId: string): EventSequencer {
    return new EventSequencer({ runId: this.runId, agentId });
  }
}

// ---------------------------------------------------------------------------
// Client-side gap detector (for use in frontend)
// ---------------------------------------------------------------------------

export interface GapDetectorResult {
  /** Whether a gap was detected */
  hasGap: boolean;
  /** Missing sequence numbers */
  missingSeqs: number[];
  /** Last contiguous sequence received */
  lastContiguous: number;
}

/**
 * Detect gaps in received sequence numbers.
 * Call this with the accumulated set of received seqs for a given runId.
 */
export function detectGaps(receivedSeqs: Set<number>): GapDetectorResult {
  if (receivedSeqs.size === 0) {
    return { hasGap: false, missingSeqs: [], lastContiguous: 0 };
  }

  const sorted = Array.from(receivedSeqs).sort((a, b) => a - b);
  const max = sorted[sorted.length - 1];
  const missing: number[] = [];
  let lastContiguous = 0;

  for (let i = 1; i <= max; i++) {
    if (!receivedSeqs.has(i)) {
      missing.push(i);
    } else if (missing.length === 0 || i === lastContiguous + 1) {
      lastContiguous = i;
    }
  }

  // Recalculate lastContiguous properly
  lastContiguous = 0;
  for (let i = 1; i <= max; i++) {
    if (receivedSeqs.has(i)) {
      lastContiguous = i;
    } else {
      break;
    }
  }

  return {
    hasGap: missing.length > 0,
    missingSeqs: missing,
    lastContiguous,
  };
}
