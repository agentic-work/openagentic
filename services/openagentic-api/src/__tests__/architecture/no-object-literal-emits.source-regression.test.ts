/**
 * Architecture pin — Phase 2.4.2 §L2-4 (no inline-object emits for the 5
 * named V3 frames that have a typed builder).
 *
 * Spec §12.2/§12.3 + 5-layer plan §2.4.2: every `ctx.emit(<NAMED_FRAME>,
 * ...)` call in production source MUST go through the corresponding
 * builder in `routes/chat/pipeline/chat/builders.ts`, never an inline
 * object literal. Object literals are how event shapes silently drift
 * between emitter and consumer; routing every emit through a typed
 * builder makes builders.ts the single source of shape truth.
 *
 * Scope — the 5 frame names this test pins (each has a corresponding
 * builder in routes/chat/pipeline/chat/builders.ts):
 *   - assistant_message_delta   → buildAssistantMessageDelta
 *   - content_block_delta       → buildContentBlockDelta
 *   - tool_executing            → buildToolExecuting
 *   - tool_result               → buildToolResult
 *   - assistant_message_stop    → buildAssistantMessageStop
 *
 * Note: `model_handoff_offer` was retired in this same commit (no
 * production callers post F0-2 handoff-path rip), so it's NOT in the
 * pin list. Re-introducing it should re-introduce both the builder
 * AND a passing builder-call site.
 *
 * The grep matches `ctx.emit('<frame>', {` — quoted frame name + comma
 * + `{`. Builder emits (`ctx.emit('frame', buildFoo({...}))`) don't
 * match because `{` comes after `buildFoo(`.
 *
 * Production-only — tests under `__tests__/` directories are skipped
 * since test scaffolding routinely constructs emit harnesses with
 * inline shapes (and that's fine — the contract is on production
 * emitters, not test fixtures).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §12.2/§12.3
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 2, Task 2.4.2 §L2-4.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = resolve(__dirname, '../..');

const PINNED_FRAMES = [
  'assistant_message_delta',
  'content_block_delta',
  'tool_executing',
  'tool_result',
  'assistant_message_stop',
];

const FRAME_RE = new RegExp(
  `ctx\\.emit\\s*\\(\\s*['"](?:${PINNED_FRAMES.join('|')})['"]\\s*,\\s*\\{`,
);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test dirs, node_modules, build artifacts. Tests can emit
      // inline shapes as fixtures — that's fine.
      if (['__tests__', '__mocks__', 'node_modules', 'dist', '.next'].includes(entry.name)) {
        continue;
      }
      out.push(...walkTs(p));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

describe('arch: production emits of pinned named frames go through builders.ts (Phase 2.4.2)', () => {
  it('no production source emits any of the 5 pinned frames with an inline object literal', () => {
    // Sanity guard — API_SRC must point at a real directory.
    expect(() => statSync(API_SRC)).not.toThrow();

    const violations: Array<{ file: string; line: number; snippet: string }> = [];
    for (const file of walkTs(API_SRC)) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (FRAME_RE.test(line)) {
          violations.push({ file, line: i + 1, snippet: line.trim() });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
