/**
 * H13 source-regression cage — AnthropicProvider must not carry hardcoded
 * Claude model IDs as bare string literals.
 *
 * Allowed:
 *   • Pricing/capabilities/defaults are read from
 *     ModelCapabilityRegistry → admin.model_role_assignments at runtime.
 *   • Wire-format (beta header / thinking-config) gates may use SHORT
 *     SUBSTRINGS that don't carry the `claude-{opus|sonnet|haiku}-…`
 *     prefix (e.g. `'opus-4'`, `'sonnet-4-6'`, `'3-5-sonnet'`). These
 *     are not "model IDs", they're contract markers.
 *
 * Forbidden — same patterns the api-wide architecture cage enforces.
 *
 * RED → GREEN cycle:
 *   RED: this test fails because lines 30-32, 395-401, 549-557, 806
 *        carry full `'claude-{opus|sonnet|haiku}-X-Y-Z'` literals.
 *   GREEN: pricing dict ripped (registry lookup), listModels() returns [],
 *          getDefaultConfig().defaultChatModel = '', thinking gates
 *          rewritten with cage-safe substrings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../AnthropicProvider.ts');

const FORBIDDEN: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /['"`]claude-(opus|sonnet|haiku)-[0-9.-]+(-v\d+)?['"`]/, description: "model literal 'claude-{opus,sonnet,haiku}-…'" },
  { pattern: /['"`]anthropic\.claude-[a-z0-9.-]+['"`]/, description: "model literal 'anthropic.claude-*'" },
  { pattern: /['"`]us\.anthropic\.claude-[a-z0-9.-]+['"`]/, description: "model literal 'us.anthropic.claude-*'" },
];

describe('AnthropicProvider — no hardcoded model literals (H13 cage)', () => {
  it('source has no claude-X-Y-Z model IDs as bare string literals', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const lines = src.split('\n');
    const hits: Array<{ line: number; description: string; excerpt: string }> = [];
    for (const { pattern, description } of FORBIDDEN) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          hits.push({ line: i + 1, description, excerpt: lines[i].trim() });
        }
      }
    }

    const summary = hits.length === 0
      ? ''
      : `\n${hits.length} hardcoded model literal(s) in AnthropicProvider.ts:\n` +
        hits.map(h => `  L${h.line} — ${h.description}\n    ${h.excerpt}`).join('\n') +
        `\n\nFix: pricing → ModelCapabilityRegistry, defaults → empty, ` +
        `wire-format gates → cage-safe substrings (e.g. 'opus-4', 'sonnet-4-6').`;

    expect(hits, summary).toEqual([]);
  });
});
