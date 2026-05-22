/**
 * B8 (chatmode punch-list) — Vertex Gemini finishReason="SAFETY" must map
 * to canonical stop_reason="safety" and finishReason="RECITATION" to
 * "recitation". Before B8 both collapsed to 'end_turn', hiding a SAFETY /
 * RECITATION compliance event from the FedRAMP-Hi audit trail.
 *
 * Synthetic fixtures here (no real Vertex SAFETY capture available in
 * the chat-dev environment; Vertex enforces safety server-side and the
 * threshold tuning we run rarely trips it). The chunk shape is taken
 * verbatim from the Vertex Gemini streamGenerateContent reference docs
 * (https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.endpoints/streamGenerateContent).
 *
 * Plan ref: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §1.4
 */

import { describe, it, expect } from 'vitest';
import {
  createVertexGeminiToOpenagenticNormalizer,
  type GeminiChunk,
  type CanonicalEvent,
} from '../VertexGeminiToOpenagentic.js';

function normalize(chunks: GeminiChunk[]): CanonicalEvent[] {
  const norm = createVertexGeminiToOpenagenticNormalizer({
    messageId: 'msg_test_vertex_safety',
    model: 'gemini-2.5-flash',
  });
  const out: CanonicalEvent[] = [];
  for (const chunk of chunks) {
    for (const ev of norm.consume(chunk)) out.push(ev);
  }
  for (const ev of norm.finalize()) out.push(ev);
  return out;
}

describe('VertexGeminiToOpenagenticNormalizer — safety / recitation (B8)', () => {
  it('maps finishReason="SAFETY" → canonical stop_reason="safety"', () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ text: 'Starting to answer' }] },
          },
        ],
      },
      {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [] },
            finishReason: 'SAFETY',
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
      },
    ];
    const events = normalize(chunks);
    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect(messageDelta, 'normalizer must emit message_delta').toBeTruthy();
    expect((messageDelta as any).delta.stop_reason).toBe('safety');
  });

  it('maps finishReason="RECITATION" → canonical stop_reason="recitation"', () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [{ text: 'Quoting...' }] },
            finishReason: 'RECITATION',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
      },
    ];
    const events = normalize(chunks);
    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect((messageDelta as any).delta.stop_reason).toBe('recitation');
  });

  it('maps finishReason="BLOCKLIST" → canonical stop_reason="content_filter"', () => {
    const chunks: GeminiChunk[] = [
      {
        candidates: [
          {
            index: 0,
            content: { role: 'model', parts: [] },
            finishReason: 'BLOCKLIST',
          },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 0 },
      },
    ];
    const events = normalize(chunks);
    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect((messageDelta as any).delta.stop_reason).toBe('content_filter');
  });

  it('preserves tool_use precedence when a function call fired before SAFETY', () => {
    // Edge case: Vertex emits the function call THEN safety-trips before
    // closing the turn. tool_use must win so the chat-loop dispatches
    // (refusal-after-dispatch is the model's job, not ours to suppress).
    const chunks: GeminiChunk[] = [
      {
        candidates: [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } }],
            },
          },
        ],
      },
      {
        candidates: [{ index: 0, content: { role: 'model', parts: [] }, finishReason: 'SAFETY' }],
      },
    ];
    const events = normalize(chunks);
    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect((messageDelta as any).delta.stop_reason).toBe('tool_use');
  });
});
