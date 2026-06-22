/**
 * M8/M9 source-regression cage — admin-agents and codemode chat-stream
 * handler must not bake a bare `claude-sonnet-4-6` (or any
 * `claude-{opus,sonnet,haiku}-…`) literal as a runtime fallback.
 *
 * Per docs/rules/no-hardcoded-models.md: when an operator hasn't
 * configured a default chat model, the platform must fail-loud (throw)
 * or persist an empty `model_config` and let downstream resolution use
 * ModelConfigurationService.getDefaultChatModel() — never a hidden
 * pinned model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCES = [
  { rel: 'admin-agents.ts', tag: 'M8' },
  { rel: 'code-mode/chat-stream.handler.ts', tag: 'M9' },
];

const FORBIDDEN = /['"`]claude-(opus|sonnet|haiku)-[0-9.-]+(-v\d+)?['"`]/;

describe('admin-agents + codemode-chat-stream — no bare claude-* fallbacks (M8/M9)', () => {
  for (const { rel, tag } of SOURCES) {
    it(`${tag} — ${rel} has no bare claude-* model literal`, () => {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      const lines = src.split('\n');
      const hits = lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter(({ text }) => FORBIDDEN.test(text));

      const summary = hits.length === 0
        ? ''
        : `\nFound ${hits.length} bare claude-* literal(s) in ${rel}:\n` +
          hits.map(h => `  L${h.line}: ${h.text.trim()}`).join('\n') +
          `\n\nFix: drop the literal. Either (a) persist an empty model_config and ` +
          `let runtime resolve from ModelConfigurationService.getDefaultChatModel(), ` +
          `or (b) throw a clear error so the operator notices the missing config.`;

      expect(hits, summary).toEqual([]);
    });
  }
});
