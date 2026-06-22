/**
 * E1.5 (2026-05-12) — MessageBubble.toolCallToStep must read the V2
 * persisted shape `{name, tool_use_id, input}` (chat_messages.tool_calls[])
 * as well as the persisted tool_result wrapper `{content, is_error, _meta}`.
 *
 * Pre-fix: it only read `toolCall.function?.arguments || toolCall.arguments`
 * and treated the entire tool_result row as the rendered result. Result:
 * after F5-reload the expanded panel showed INPUT {} (no `arguments` on the
 * row) and the RESULT panel showed the JSON-stringified envelope instead
 * of the structured content. See reports/verify-cadence/E1/2c3eab12/reload-
 * expanded-tool-row.png for the visible failure mode.
 *
 * Source-grep pin so a future refactor that drops the canonical-shape
 * branch is caught at unit-test time (the live verify is too lossy to
 * catch this with confidence).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('MessageBubble — E1.5 V2 wire-shape normalization in toolCallToStep', () => {
  it('reads `input` from the persisted tool_call row (V2 canonical shape)', () => {
    const src = readFileSync(SRC, 'utf8');
    // Must reference the canonical field name on the toolCall row.
    expect(src).toMatch(/toolCall\.input/);
  });

  it('still falls through to legacy `arguments` for Gemini / V1 compatibility', () => {
    const src = readFileSync(SRC, 'utf8');
    // Both legacy paths must remain — Gemini emits function.arguments,
    // older V1 turns emit bare `arguments`.
    expect(src).toMatch(/toolCall\.function\?\.arguments/);
    expect(src).toMatch(/toolCall\.arguments/);
  });

  it('unwraps the V2 tool_result envelope (content) for the rendered result', () => {
    const src = readFileSync(SRC, 'utf8');
    // toolResult is `{name, tool_use_id, content, is_error, _meta}` on
    // the persisted row. The renderer must reach into `.content` rather
    // than feed the whole envelope to JsonView.
    expect(src).toMatch(/'content' in toolResult|\.content/);
    // Honor is_error stamp on the envelope so failed-tool cards stay red.
    expect(src).toMatch(/is_error/);
  });

  it('still extracts `summary` from V2 structured-content envelopes', () => {
    const src = readFileSync(SRC, 'utf8');
    // V2 envelope: structuredContent = { summary: string, data: object }.
    // The compact tile summary needs to read .summary so reload doesn't
    // show "Object with 2 fields" generic noise.
    expect(src).toMatch(/normalizedResult.*summary|\.summary/);
  });
});
