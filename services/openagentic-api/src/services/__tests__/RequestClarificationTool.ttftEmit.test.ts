/**
 * request_clarification — emits a synthetic ttft frame.
 *
 * Why: when V2 routes a turn to request_clarification, the only frame
 * emitted server-side was `request_clarification`. The UI's LiveTurnStatus
 * gate stayed at "waiting for first token" because firstTokenAt was only
 * set on `ttft` events or content_block_delta. The clarification card
 * also requires firstTokenAt != null to render. Result: turn hung
 * indefinitely with no card.
 *
 * Fix: emit `ttft` alongside `request_clarification` so the UI clears
 * the gate and renders the card.
 *
 * Repro evidence: capture in
 * reports/capstone-mock-parity-gap-2026-05-08.md §4 run #2 ("3m 13s ·
 * waiting for first token · calling request_clarification").
 */
import { describe, test, expect, vi } from 'vitest';
import { executeRequestClarification, type RequestClarificationInput } from '../RequestClarificationTool.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: unknown }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'test-session',
      userId: 'test-user',
    },
  };
}

describe('request_clarification — ttft emission (deadlock fix)', () => {
  test('emits a ttft frame alongside the request_clarification frame', async () => {
    const { ctx, emits } = makeCtx();
    const input: RequestClarificationInput = {
      question: 'Which subscription should I drop the database in?',
      options: ['prod', 'dev'],
    };
    const result = await executeRequestClarification(ctx, input);
    expect(result.ok).toBe(true);

    const events = emits.map((e) => e.event);
    expect(events).toContain('ttft');
    expect(events).toContain('request_clarification');
  });

  test('ttft is emitted BEFORE request_clarification so the UI gate clears first', async () => {
    const { ctx, emits } = makeCtx();
    await executeRequestClarification(ctx, { question: 'q' });
    const ttftIdx = emits.findIndex((e) => e.event === 'ttft');
    const clarifyIdx = emits.findIndex((e) => e.event === 'request_clarification');
    expect(ttftIdx).toBeGreaterThanOrEqual(0);
    expect(clarifyIdx).toBeGreaterThanOrEqual(0);
    expect(ttftIdx).toBeLessThan(clarifyIdx);
  });

  test('ttft payload includes a finite ttftMs number', async () => {
    const { ctx, emits } = makeCtx();
    await executeRequestClarification(ctx, { question: 'q' });
    const ttft = emits.find((e) => e.event === 'ttft');
    expect(ttft).toBeTruthy();
    const payload = ttft!.payload as { ttftMs?: number };
    expect(typeof payload.ttftMs).toBe('number');
    expect(Number.isFinite(payload.ttftMs)).toBe(true);
  });
});
