/**
 * Phase C.14 arch — Pin the T1 catalog source to exactly 12 primitives.
 *
 * the design notes
 *
 * Growth log:
 *   - Phase C.1 (2026-05-10): 10 primitives baseline.
 *   - 2026-05-11 pattern memory: +pattern_save, +pattern_recall → 12.
 *
 * This is a source-text regression test: it reads `toolRegistry.ts` and
 * asserts that getAllBaseTools() returns an array literal containing
 * exactly the 12 T1 tool symbols, in the canonical order spec'd by
 * the design notes.
 *
 * The behavioral pin lives in
 * `routes/chat/pipeline/chat/__tests__/getAllBaseTools.t1Catalog.test.ts`.
 * This arch test guards against:
 *   - someone adding a tool to the source array without updating both pins
 *   - someone reordering the canonical sequence
 *   - someone moving the source out of toolRegistry.ts (no drift)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REG_PATH = join(
  __dirname,
  '..',
  '..',
  'routes',
  'chat',
  'pipeline',
  'chat',
  'toolRegistry.ts',
);

// Canonical T1 symbols — the def constants imported by getAllBaseTools.
// The first entry uses `taskTool` (TASK_TOOL with optional description
// override) so the source check accepts that local name in place of
// TASK_TOOL.
// Canonical T1 catalog, in array order, as actually shipped by
// getAllBaseTools(). `synth` was removed from the OSS edition.
const T1_SYMBOLS = [
  'TOOL_SEARCH_TOOL',
  'AGENT_SEARCH_TOOL',
  'taskTool',
  'AGENT_SEND_TOOL',
  'AGENT_LIST_TOOL',
  'AGENT_STOP_TOOL',
  'READ_LARGE_RESULT_TOOL_DEF',
  'WEB_SEARCH_TOOL',
  'WEB_FETCH_TOOL',
  'PATTERN_SAVE_TOOL',
  'PATTERN_RECALL_TOOL',
  'MEMORY_SEARCH_TOOL_DEF',
  'COMPOSE_VISUAL_TOOL',
  'COMPOSE_APP_TOOL',
  'GENERATE_IMAGE_TOOL',
  'RENDER_ARTIFACT_TOOL',
  'REQUEST_CLARIFICATION_TOOL',
] as const;

describe('arch — T1 catalog pinned (Phase C.14)', () => {
  it('toolRegistry.ts getAllBaseTools returns exactly the canonical symbols, in order', () => {
    const src = readFileSync(REG_PATH, 'utf8');

    // Extract the `return [ ... ];` block inside getAllBaseTools.
    const fnStart = src.indexOf('export function getAllBaseTools');
    expect(fnStart, 'getAllBaseTools must live in toolRegistry.ts').toBeGreaterThan(-1);
    const returnIdx = src.indexOf('return [', fnStart);
    expect(returnIdx, 'getAllBaseTools must contain a `return [` array literal').toBeGreaterThan(-1);
    const closeIdx = src.indexOf('];', returnIdx);
    expect(closeIdx, 'getAllBaseTools return array must close').toBeGreaterThan(-1);
    const arrayBlock = src.slice(returnIdx, closeIdx);

    // Each T1 symbol must appear once, in canonical order. We walk left
    // to right and assert each symbol's first occurrence is after the
    // previous symbol's occurrence.
    let cursor = 0;
    for (const sym of T1_SYMBOLS) {
      const idx = arrayBlock.indexOf(sym, cursor);
      expect(
        idx,
        `T1 symbol '${sym}' must appear in getAllBaseTools return array after the previous entry`,
      ).toBeGreaterThan(-1);
      cursor = idx + sym.length;
    }

    // Symbols that must NOT appear in the base catalog — discoverable via
    // tool_search, or removed from the OSS edition entirely (synth).
    const FORBIDDEN = [
      'BROWSER_SANDBOX_EXEC_TOOL',
      'MEMORIZE_TOOL',
      'SYNTH_TOOL',
      'SYNTH_EXECUTE_TOOL_DEF',
    ];
    for (const forb of FORBIDDEN) {
      expect(
        arrayBlock.includes(forb),
        `legacy symbol '${forb}' must NOT appear in getAllBaseTools — discoverable via tool_search per spec §Layer-2`,
      ).toBe(false);
    }
  });
});
