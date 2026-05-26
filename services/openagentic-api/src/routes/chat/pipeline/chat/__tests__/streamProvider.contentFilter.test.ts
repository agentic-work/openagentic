/**
 * F2-4 (2026-05-12 audit): Azure Responsible AI content_filter trip.
 * The provider emits `finish_reason: 'content_filter'` on a truncated
 * assistant response. Today `translateOpenAIFinishChunk` falls through
 * to the `default → end_turn` branch (streamProvider.ts:477-479), so
 * chatLoop sees a clean end_turn, the UI renders an empty bubble, and
 * the operator has no visibility that a SAFETY filter tripped.
 *
 * For CDC FedRAMP-Hi audit compliance: a content_filter trip is a
 * COMPLIANCE EVENT that must surface to the operator (and the audit
 * log) — never silent.
 *
 * Fix: extend StopReason union with `'content_filter'`, map it through
 * translateOpenAIFinishChunk + mapStopReason, and forward via the
 * `message_stop` StreamEvent so chatLoop can emit a distinct annotation
 * (kind: 'content_filter') for the UI to render a compliance banner.
 *
 * TDD-RED before fix.
 */

import { describe, it, expect } from 'vitest';
import {
  __testing__translateOpenAIFinishChunk,
  __testing__mapStopReason,
} from '../streamProvider.js';

describe('content_filter stop_reason — F2-4 (2026-05-12 audit)', () => {
  it('translateOpenAIFinishChunk maps finish_reason="content_filter" → content_filter', () => {
    const chunk = { choices: [{ delta: {}, finish_reason: 'content_filter' }] };
    const ev = __testing__translateOpenAIFinishChunk(chunk);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('message_stop');
    expect((ev as any).stop_reason).toBe('content_filter');
  });

  it('mapStopReason passes through "content_filter" verbatim (not downgraded to end_turn)', () => {
    expect(__testing__mapStopReason('content_filter')).toBe('content_filter');
  });

  it('all known stop_reasons still round-trip', () => {
    expect(__testing__mapStopReason('end_turn')).toBe('end_turn');
    expect(__testing__mapStopReason('tool_use')).toBe('tool_use');
    expect(__testing__mapStopReason('max_tokens')).toBe('max_tokens');
    expect(__testing__mapStopReason('stop_sequence')).toBe('stop_sequence');
    expect(__testing__mapStopReason('content_filter')).toBe('content_filter');
    // Unknown values still default to end_turn (safe).
    expect(__testing__mapStopReason('mystery_value')).toBe('end_turn');
  });
});
