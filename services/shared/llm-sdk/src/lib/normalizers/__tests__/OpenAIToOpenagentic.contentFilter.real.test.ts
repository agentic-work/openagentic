/**
 * B8 (chatmode punch-list) — OpenAI / Azure AI Foundry chat-completions
 * shape `finish_reason: 'content_filter'` must surface canonically as
 * `stop_reason: 'content_filter'` so downstream UX can render a
 * compliance banner instead of a truncated bubble that looks like a
 * normal end_turn.
 *
 * Real-data discipline: the fixture is a captured AIF wire response
 * with the structure Azure Responsible AI emits when the moderation
 * filter trips on assistant output mid-stream. The terminal chunk
 * carries `finish_reason: 'content_filter'` and severity flags on
 * `content_filter_results` (hate=high in this case). This is the same
 * shape that silently mapped to canonical `end_turn` before the SDK
 * was extended with `content_filter | safety | recitation` variants.
 *
 * Fixture: fixtures/aif-content-filter-real.ndjson
 * Plan ref: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §1.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createOpenAIToOpenagenticNormalizer,
  type OpenAIChunk,
  type CanonicalEvent,
} from '../OpenAIToOpenagentic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(filename: string): OpenAIChunk[] {
  const path = resolve(__dirname, 'fixtures', filename);
  const text = readFileSync(path, 'utf8');
  const out: OpenAIChunk[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as OpenAIChunk);
  }
  return out;
}

function normalize(chunks: OpenAIChunk[]): CanonicalEvent[] {
  const norm = createOpenAIToOpenagenticNormalizer({
    messageId: 'msg_test_cf',
    model: 'gpt-5.4-2026-03-05',
  });
  const out: CanonicalEvent[] = [];
  for (const chunk of chunks) {
    for (const ev of norm.consume(chunk)) out.push(ev);
  }
  for (const ev of norm.finalize()) out.push(ev);
  return out;
}

describe('OpenAIToOpenagenticNormalizer — content_filter (B8)', () => {
  it('maps finish_reason="content_filter" → canonical stop_reason="content_filter"', () => {
    const chunks = loadFixture('aif-content-filter-real.ndjson');
    const events = normalize(chunks);

    const messageDelta = events.find((e) => e.type === 'message_delta');
    expect(messageDelta, 'normalizer must emit message_delta').toBeTruthy();
    expect((messageDelta as any).delta.stop_reason).toBe('content_filter');
  });

  it('preserves any text content emitted before the filter tripped', () => {
    const chunks = loadFixture('aif-content-filter-real.ndjson');
    const events = normalize(chunks);

    // The fixture's pre-filter content was "To respond to your question".
    // The user should see this partial output above the banner so they
    // know what the model started to say before RAI shut it down.
    const textDeltas = events
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => (e as any).delta)
      .filter((d) => d?.type === 'text_delta')
      .map((d) => d.text as string)
      .join('');

    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas).toContain('To respond to your');
  });

  it('still emits message_stop terminator after content_filter', () => {
    const chunks = loadFixture('aif-content-filter-real.ndjson');
    const events = normalize(chunks);

    const last = events[events.length - 1];
    expect(last?.type).toBe('message_stop');
  });
});
