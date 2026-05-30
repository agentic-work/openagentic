/**
 * #942 (2026-05-20) — pin the runChat.ts grounding-mode addendum so it
 * explicitly tells the model to emit a one-sentence verdict claim on a
 * line of its own, prefixed `Verdict:`, immediately above the existing
 * `Grounding: <status> (N sources)` status line.
 *
 * Bug observed on live drives: chip mounts (status pill present) but
 * the claim text body is blank — model never received the directive to
 * surface the actual one-sentence verdict claim, only the status code
 * + source count. The UI parser was correspondingly returning a verdict
 * object with no claim text, so the chip had no body to render.
 *
 * Contract pinned here (sister to cost-table-suppression.test.ts):
 *   - The addendum literal must contain a `Verdict:` directive line.
 *   - The addendum must instruct the model to keep the claim to ONE
 *     sentence (token-cost discipline + chip-row layout).
 *   - The addendum must position the `Verdict:` line ABOVE the
 *     `Grounding:` status line (reading order = render order).
 *   - The addendum must include a concrete EXAMPLE so smaller models
 *     follow the shape (per #905 / #871 — small models need examples,
 *     not just rules).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RUN_CHAT_PATH = path.resolve(__dirname, '../runChat.ts');

describe('#942 — runChat grounding-mode addendum verdict-line directive', () => {
  const src = fs.readFileSync(RUN_CHAT_PATH, 'utf-8');

  it('addendum contains a `Verdict:` directive line', () => {
    // The literal `Verdict:` token must appear inside the addendum text
    // (separate from the existing `Grounding:` status line).
    expect(src).toMatch(/Verdict:/);
  });

  it('addendum constrains the verdict to ONE sentence (token-cost / layout)', () => {
    // The instruction must qualify the claim length so models do not
    // emit a paragraph of prose where the chip body expects a single
    // sentence. Acceptable phrasings: "one-sentence", "single-sentence",
    // "one sentence", or an explicit ≤N word/char cap.
    expect(src).toMatch(/one[\s-]sentence|single[\s-]sentence|single\s+sentence/i);
  });

  it('addendum positions the `Verdict:` line ABOVE the `Grounding:` status line', () => {
    // Reading order in the prompt matches the render order the chip
    // expects — claim text first, then status pill.
    const verdictIdx = src.indexOf('Verdict:');
    const groundingStatusIdx = src.search(/Grounding:\s+verified by web/);
    expect(verdictIdx).toBeGreaterThan(-1);
    expect(groundingStatusIdx).toBeGreaterThan(-1);
    expect(verdictIdx).toBeLessThan(groundingStatusIdx);
  });

  it('addendum carries a concrete example showing the Verdict line shape', () => {
    // Per #905 / #871 small-model lessons — when we tell models to follow
    // a schema, we ALSO give them a one-line worked example. The example
    // must contain the `Verdict:` literal token followed by a sample
    // claim sentence.
    expect(src).toMatch(/Verdict:\s+[A-Z][^`\n]{8,}/);
  });
});
