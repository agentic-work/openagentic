/**
 * P1 #940 (2026-05-18) — grounding T1 system-prompt addendum.
 *
 * When the chat request sets `groundingEnabled: true`, runChat must
 * append a <grounding-mode> addendum to the composed system prompt that
 * instructs the model to verify factual claims via the existing
 * web_search MCP tool and emit a single canonical "Grounding: ..."
 * verdict line at the end of its final answer.
 *
 * We don't need to drive a full chatLoop in this test — we assert the
 * source-code contract: runChat threads `input.groundingEnabled` into a
 * `groundedSystemPrompt` that wraps the base system prompt with the
 * <grounding-mode> block, and that the loopInput.systemPrompt handed to
 * chatLoop equals groundedSystemPrompt (not the bare systemPrompt).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RUN_CHAT_PATH = path.resolve(
  __dirname,
  '../runChat.ts',
);

describe('runChat — grounding T1 system prompt addendum', () => {
  const src = fs.readFileSync(RUN_CHAT_PATH, 'utf-8');

  it('threads input.groundingEnabled into a groundedSystemPrompt branch', () => {
    expect(src).toMatch(/input\.groundingEnabled\s*===\s*true/);
    expect(src).toMatch(/groundedSystemPrompt/);
  });

  it('addendum mentions web_search tool invocation', () => {
    expect(src).toMatch(/web_search/);
  });

  it('addendum specifies the canonical Grounding: verdict line shape', () => {
    expect(src).toMatch(/Grounding: verified by web/);
    expect(src).toMatch(/Grounding: mixed/);
    expect(src).toMatch(/Grounding: refuted/);
    expect(src).toMatch(/Grounding: insufficient/);
  });

  it('loopInput.systemPrompt receives groundedSystemPrompt (not the bare base)', () => {
    expect(src).toMatch(/systemPrompt:\s*groundedSystemPrompt/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2026-05-18 PM — user feedback: "when a request is grounded- the
  // verified pill needs to show the actual links/real refs used to pull
  // the data". The addendum must instruct the model to emit a
  // <grounding-sources> JSON block immediately after the verdict line,
  // carrying the URLs+titles the web_search results returned.
  // ─────────────────────────────────────────────────────────────────────

  it('addendum instructs the model to emit a <grounding-sources> JSON block after the verdict line', () => {
    expect(src).toMatch(/<grounding-sources>/);
    expect(src).toMatch(/<\/grounding-sources>/);
  });

  it('addendum specifies the sources JSON schema with url + title fields', () => {
    expect(src).toMatch(/"url"/);
    expect(src).toMatch(/"title"/);
  });
});
