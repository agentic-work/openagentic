/**
 * AIF Responses API `response.failed` / `status:'failed'` envelope handling at
 * the SDK normalizer seam.
 *
 * The Azure AI Foundry Responses API can return an HTTP 200 envelope whose
 * `status` is `'failed'` (the transient `response.failed(null error)` class the
 * platform's provider-fetch layer retries). The envelope carries a top-level
 * `error` object:
 *   { status: 'failed', error: { code, message } | null, output: [...] }
 *
 * Pre-fix the normalizer's `applyStatus` had NO `failed` branch — a failed
 * envelope fell through to the default `end_turn` map. That is SILENT DATA
 * LOSS: a hard failure becomes indistinguishable from a clean empty turn, so
 * no downstream consumer can detect it to retry / surface a banner. The model
 * "succeeded with no content" when in fact the call FAILED.
 *
 * Contract this pins (additive, non-breaking — the canonical event stream
 * shape is unchanged; the failure is exposed via an out-of-band accessor):
 *   1. A `failed` envelope MUST NOT be normalized as a clean `end_turn` that
 *      hides the failure — `getEnvelopeError()` returns the error so the
 *      caller can retry.
 *   2. `getEnvelopeError()` returns `null` for completed / incomplete / clean
 *      envelopes (no false positives).
 *   3. A `failed` envelope with `error: null` (the exact response.failed(null)
 *      transient) STILL reports a non-null error (synthesized) so the retry
 *      path fires — never swallowed.
 *   4. The normalizer must NOT throw on a failed envelope (resilience).
 */
import { describe, it, expect } from 'vitest';
import {
  createAIFResponsesToOpenagenticNormalizer,
  type AIFResponsesEnvelope,
} from '../AIFResponsesToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function run(envelope: AIFResponsesEnvelope) {
  const n = createAIFResponsesToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: envelope.model || 'gpt-5.4-mini',
  });
  const events: CanonicalEvent[] = [];
  events.push(...n.consume(envelope));
  events.push(...n.finalize());
  return { n, events };
}

describe('AIFResponsesToOpenagenticNormalizer — response.failed / status:failed', () => {
  it('does NOT throw on a failed envelope', () => {
    expect(() =>
      run({
        id: 'resp_failed',
        output: [],
        status: 'failed',
        error: { code: 'server_error', message: 'internal' },
      } as AIFResponsesEnvelope),
    ).not.toThrow();
  });

  it('exposes the error via getEnvelopeError() for a status:failed envelope', () => {
    const { n } = run({
      id: 'resp_failed',
      output: [],
      status: 'failed',
      error: { code: 'server_error', message: 'internal' },
    } as AIFResponsesEnvelope);
    const err = n.getEnvelopeError();
    expect(err).not.toBeNull();
    expect(err!.code).toBe('server_error');
    expect(err!.message).toBe('internal');
  });

  it('synthesizes a non-null error for the response.failed(null) transient', () => {
    // The exact case: status:'failed' with error:null. Must STILL report a
    // failure so the retry path fires — never swallowed as end_turn.
    const { n } = run({
      id: 'resp_failed_null',
      output: [],
      status: 'failed',
      error: null,
    } as unknown as AIFResponsesEnvelope);
    const err = n.getEnvelopeError();
    expect(err).not.toBeNull();
    expect(typeof err!.code).toBe('string');
    expect(err!.code.length).toBeGreaterThan(0);
  });

  it('returns null from getEnvelopeError() for a clean completed envelope (no false positive)', () => {
    const { n } = run({
      id: 'resp_ok',
      output: [
        {
          type: 'message',
          id: 'm',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hi' }],
        },
      ],
      status: 'completed',
    });
    expect(n.getEnvelopeError()).toBeNull();
  });

  it('returns null from getEnvelopeError() for an incomplete (max_tokens) envelope', () => {
    const { n } = run({
      id: 'resp_inc',
      output: [
        {
          type: 'message',
          id: 'm',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'truncated' }],
        },
      ],
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    expect(n.getEnvelopeError()).toBeNull();
  });
});
