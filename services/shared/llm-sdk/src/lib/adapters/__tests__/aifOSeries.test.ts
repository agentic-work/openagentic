/**
 * AIF/OpenAI o-series + gpt-5 wire-format support — Gap 2, 3, 7 audit fixes.
 *
 * Audit ref: services/openagentic-api `audit AIF closest-to-Claude models 2026-05-12`.
 *
 * Gap 2 — `OpenagenticToAIFResponses` emits `reasoning.{effort,summary}` block
 *         on the wire body when canonical carries those fields.
 * Gap 3 — `OpenagenticToOpenAI` emits `role: 'developer'` instead of 'system'
 *         when `system_role_hint: 'developer'` is set.
 * Gap 7 — `OpenAIToOpenagentic` maps `finish_reason: 'content_filter'` to
 *         canonical `stop_reason: 'content_filter'` (was previously 'end_turn').
 * Gap 6 — `OpenAIToOpenagentic` maps `delta.refusal` text to canonical
 *         text_delta + `finish_reason: 'refusal'` to canonical 'refusal'.
 *
 * Source: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning
 *         https://platform.openai.com/docs/guides/reasoning
 */

import { describe, it, expect } from 'vitest';
import { OpenagenticToAIFResponses } from '../OpenagenticToAIFResponses.js';
import { OpenagenticToOpenAI } from '../OpenagenticToOpenAI.js';
import { createOpenAIToOpenagenticNormalizer } from '../../normalizers/OpenAIToOpenagentic.js';
import { createAIFResponsesToOpenagenticNormalizer } from '../../normalizers/AIFResponsesToOpenagentic.js';
import type { CanonicalRequest } from '../../canonical/types.js';
import type { CanonicalEvent } from '../../normalizers/CanonicalEvent.js';

function baseRequest(extra: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    system: 'You are a helpful assistant.',
    tools: [],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Gap 2 — reasoning.{effort,summary} on AIF Responses adapter
// ---------------------------------------------------------------------------

describe('Gap 2 — OpenagenticToAIFResponses emits reasoning block', () => {
  it('emits reasoning.effort when canonical carries reasoning_effort', () => {
    const adapter = new OpenagenticToAIFResponses();
    const body = adapter.adaptRequest(baseRequest({ reasoning_effort: 'medium' })) as any;
    expect(body.reasoning).toEqual({ effort: 'medium' });
  });

  it('emits reasoning.summary when canonical carries reasoning_summary', () => {
    const adapter = new OpenagenticToAIFResponses();
    const body = adapter.adaptRequest(baseRequest({ reasoning_summary: 'detailed' })) as any;
    expect(body.reasoning).toEqual({ summary: 'detailed' });
  });

  it('emits both effort + summary when both set (Claude-extended-thinking parity)', () => {
    const adapter = new OpenagenticToAIFResponses();
    const body = adapter.adaptRequest(
      baseRequest({ reasoning_effort: 'high', reasoning_summary: 'detailed' }),
    ) as any;
    expect(body.reasoning).toEqual({ effort: 'high', summary: 'detailed' });
  });

  it('omits reasoning block when neither field is set (gpt-4o et al. unchanged)', () => {
    const adapter = new OpenagenticToAIFResponses();
    const body = adapter.adaptRequest(baseRequest()) as any;
    expect(body.reasoning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gap 3 — developer-role rename on OpenAI adapter
// ---------------------------------------------------------------------------

describe('Gap 3 — OpenagenticToOpenAI respects system_role_hint', () => {
  it('emits role:"system" by default (back-compat for non-o-series)', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(baseRequest()) as any;
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('helpful assistant');
  });

  it('emits role:"developer" when system_role_hint="developer" (o-series-safe)', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(baseRequest({ system_role_hint: 'developer' })) as any;
    expect(body.messages[0].role).toBe('developer');
    expect(body.messages[0].content).toContain('helpful assistant');
  });

  it('emits role:"system" when system_role_hint="system" (explicit override)', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(baseRequest({ system_role_hint: 'system' })) as any;
    expect(body.messages[0].role).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// Gap 7 — content_filter canonical stop_reason
// ---------------------------------------------------------------------------

function consume(
  normalizer: { consume: (chunk: any) => CanonicalEvent[]; finalize: () => CanonicalEvent[] },
  chunks: any[],
): CanonicalEvent[] {
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...normalizer.consume(c));
  out.push(...normalizer.finalize());
  return out;
}

describe('Gap 7 — OpenAIToOpenagentic maps content_filter -> canonical content_filter', () => {
  it('finish_reason: content_filter -> stop_reason: content_filter (not end_turn)', () => {
    // Spec-shape Chat-Completions stream chunks per OpenAI docs:
    // https://platform.openai.com/docs/api-reference/chat-streaming
    const normalizer = createOpenAIToOpenagenticNormalizer({ messageId: 'm-test', model: 'gpt-4o' });
    const events = consume(normalizer, [
      { id: 'r1', choices: [{ index: 0, delta: { content: 'Sorry ' } }] },
      { id: 'r1', choices: [{ index: 0, delta: { content: 'about that.' }, finish_reason: 'content_filter' }] },
    ]);
    const messageDelta = events.find((e) => e.type === 'message_delta') as any;
    expect(messageDelta).toBeDefined();
    expect(messageDelta.delta.stop_reason).toBe('content_filter');
  });
});

// ---------------------------------------------------------------------------
// Gap 6 — refusal handling
// ---------------------------------------------------------------------------

describe('Gap 6 — OpenAIToOpenagentic surfaces refusal text + stop_reason', () => {
  it('delta.refusal text becomes canonical text_delta event', () => {
    const normalizer = createOpenAIToOpenagenticNormalizer({ messageId: 'm-test', model: 'gpt-4o' });
    const events = consume(normalizer, [
      { id: 'r1', choices: [{ index: 0, delta: { refusal: "I can't help with that." } }] },
      { id: 'r1', choices: [{ index: 0, delta: {}, finish_reason: 'refusal' }] },
    ]);
    const textDelta = events.find(
      (e) => e.type === 'content_block_delta' && (e as any).delta?.type === 'text_delta',
    ) as any;
    expect(textDelta).toBeDefined();
    expect(textDelta.delta.text).toBe("I can't help with that.");
  });

  it('finish_reason: refusal -> stop_reason: refusal', () => {
    const normalizer = createOpenAIToOpenagenticNormalizer({ messageId: 'm-test', model: 'gpt-4o' });
    const events = consume(normalizer, [
      { id: 'r1', choices: [{ index: 0, delta: { refusal: 'No.' } }] },
      { id: 'r1', choices: [{ index: 0, delta: {}, finish_reason: 'refusal' }] },
    ]);
    const messageDelta = events.find((e) => e.type === 'message_delta') as any;
    expect(messageDelta).toBeDefined();
    expect(messageDelta.delta.stop_reason).toBe('refusal');
  });
});

// ---------------------------------------------------------------------------
// Gap 6 (AIF half) + Gap 7 (AIF half) — Responses API
// ---------------------------------------------------------------------------

describe('Gap 6 (AIF) — AIFResponsesToOpenagentic surfaces refusal output items', () => {
  it('top-level output item {type:"refusal", refusal:"..."} -> text block + stop_reason refusal', () => {
    const normalizer = createAIFResponsesToOpenagenticNormalizer({ messageId: 'm1', model: 'gpt-4o' });
    const events = consume(normalizer, [
      {
        id: 'resp_1',
        output: [
          { type: 'refusal', id: 'refusal_1', refusal: "I can't assist with that." },
        ],
        status: 'completed',
      },
    ]);

    const textDelta = events.find(
      (e) => e.type === 'content_block_delta' && (e as any).delta?.type === 'text_delta',
    ) as any;
    expect(textDelta).toBeDefined();
    expect(textDelta.delta.text).toBe("I can't assist with that.");

    const messageDelta = events.find((e) => e.type === 'message_delta') as any;
    expect(messageDelta.delta.stop_reason).toBe('refusal');
  });

  it('refusal content part inside message.content[] -> text block + stop_reason refusal', () => {
    const normalizer = createAIFResponsesToOpenagenticNormalizer({ messageId: 'm2', model: 'gpt-4o' });
    const events = consume(normalizer, [
      {
        id: 'resp_2',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            content: [
              { type: 'refusal', refusal: 'No can do.' },
            ],
          },
        ],
        status: 'completed',
      },
    ]);

    const textDelta = events.find(
      (e) => e.type === 'content_block_delta' && (e as any).delta?.type === 'text_delta',
    ) as any;
    expect(textDelta).toBeDefined();
    expect(textDelta.delta.text).toBe('No can do.');

    const messageDelta = events.find((e) => e.type === 'message_delta') as any;
    expect(messageDelta.delta.stop_reason).toBe('refusal');
  });
});

describe('Gap 7 (AIF) — AIFResponsesToOpenagentic maps content_filter incomplete reason', () => {
  it('status:incomplete reason:content_filter -> stop_reason: content_filter', () => {
    const normalizer = createAIFResponsesToOpenagenticNormalizer({ messageId: 'm3', model: 'gpt-4o' });
    const events = consume(normalizer, [
      {
        id: 'resp_3',
        output: [],
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      },
    ]);
    const messageDelta = events.find((e) => e.type === 'message_delta') as any;
    expect(messageDelta).toBeDefined();
    expect(messageDelta.delta.stop_reason).toBe('content_filter');
  });
});
