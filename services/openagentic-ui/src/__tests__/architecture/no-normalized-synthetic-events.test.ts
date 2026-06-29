/**
 * Architecture gate: no synthetic Normalized* model-stream event interfaces
 * may reappear in the UI source tree.
 *
 * Slice G.3 (2026-05-01) ripped these synthetic types from
 * `src/types/AnthropicStreamEvent.ts`:
 *
 *   NormalizedThinkingStartEvent
 *   NormalizedThinkingDeltaEvent
 *   NormalizedThinkingStopEvent
 *   NormalizedRedactedThinkingEvent
 *   NormalizedToolStartEvent
 *   NormalizedToolDeltaEvent
 *   NormalizedToolStopEvent
 *   NormalizedTextStartEvent
 *   NormalizedTextDeltaEvent
 *   NormalizedTextStopEvent
 *
 * Plus the type-guard helpers `isThinkingEvent`, `isToolEvent`,
 * `isTextEvent` which referenced them.
 *
 * Provider adapters now emit canonical Anthropic Messages SSE
 * `content_block_*` events directly; the legacy synthetic family is gone.
 * Reintroducing any of these names trips this guard so a future PR can't
 * accidentally bring them back without making the architectural choice
 * explicit.
 *
 * EXEMPT files document the rip in code comments and may keep the names
 * inside string literals (test cases, comments, deprecation notes).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UI_SRC = join(__dirname, '../..');

const BANNED_NAMES = [
  'NormalizedThinkingStartEvent',
  'NormalizedThinkingDeltaEvent',
  'NormalizedThinkingStopEvent',
  'NormalizedRedactedThinkingEvent',
  'NormalizedToolStartEvent',
  'NormalizedToolDeltaEvent',
  'NormalizedToolStopEvent',
  'NormalizedTextStartEvent',
  'NormalizedTextDeltaEvent',
  'NormalizedTextStopEvent',
  'isThinkingEvent',
  'isToolEvent',
  'isTextEvent',
];

const EXEMPT_FILES = new Set<string>([
  // The architecture test itself contains the banned names as needles.
  'src/__tests__/architecture/no-normalized-synthetic-events.test.ts',
]);

function collectTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx'))
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no synthetic Normalized* model-stream events', () => {
  const allFiles = collectTs(UI_SRC);

  for (const banned of BANNED_NAMES) {
    it(`does not reintroduce: ${banned}`, () => {
      const offenders: Array<{ path: string; line: number; preview: string }> = [];

      for (const filePath of allFiles) {
        const rel = relative(join(UI_SRC, '..'), filePath);
        if (EXEMPT_FILES.has(rel)) continue;

        let content: string;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        if (!content.includes(banned)) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(banned)) {
            offenders.push({
              path: rel,
              line: i + 1,
              preview: lines[i].trim().slice(0, 120),
            });
            break;
          }
        }
      }

      if (offenders.length > 0) {
        const detail = offenders
          .map((o) => `  ${o.path}:${o.line}\n      ${o.preview}`)
          .join('\n');
        const msg =
          `Banned identifier "${banned}" reappeared in the UI source tree.\n\n` +
          `Slice G.3 (2026-05-01) ripped this synthetic Normalized* model-stream\n` +
          `variant. All providers now emit canonical Anthropic Messages SSE\n` +
          `\`content_block_*\` events directly. If this reappearance is intentional\n` +
          `(e.g. an explicit decision to revive the synthetic family), make the\n` +
          `architectural change in a separate PR that updates this guard's\n` +
          `BANNED_NAMES list with rationale.\n\n` +
          `Found in:\n${detail}`;
        expect.fail(msg);
      }
    });
  }
});
