/**
 * Source regression: #843 Task tool capability gate must stay wired.
 *
 * Pins three contract invariants in source — any of these breaking means
 * the gate has been silently undone and small/cheap models will resume
 * dispatching Task for trivial one-tool queries:
 *
 *   1. toolRegistry.ts uses `shouldExposeTaskToolForModel` from
 *      services/modelTaskGate.js when assembling the chat tool array.
 *   2. getAllBaseTools accepts an `includeTaskTool` parameter (the
 *      mechanical hook that lets the gate exclude Task).
 *   3. runChat.ts threads `selectedModel: input.model` into
 *      buildChatToolArray (otherwise the gate runs with undefined and
 *      always fails open).
 *
 * Why pin in source instead of behavior-only:
 *   The gate's behavior is exercised by toolRegistry.taskGate.test.ts +
 *   modelTaskGate.test.ts. This file is an additional safety net so a
 *   future refactor can't accidentally drop the wire-through without
 *   tripping a regression.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), 'utf8');
}

describe('#843 Task capability gate — source regression', () => {
  it('toolRegistry.ts dynamic-imports shouldExposeTaskToolForModel', () => {
    const src = readSource('src/routes/chat/pipeline/chat/toolRegistry.ts');
    expect(src).toContain('shouldExposeTaskToolForModel');
    expect(src).toContain('modelTaskGate');
  });

  it('toolRegistry.ts BuildChatToolArrayOptions exposes selectedModel', () => {
    const src = readSource('src/routes/chat/pipeline/chat/toolRegistry.ts');
    expect(src).toMatch(/selectedModel\?:\s*string/);
  });

  it('toolRegistry.ts getAllBaseTools accepts includeTaskTool parameter', () => {
    const src = readSource('src/routes/chat/pipeline/chat/toolRegistry.ts');
    expect(src).toMatch(/getAllBaseTools\s*\(\s*[^)]*includeTaskTool/);
  });

  it('runChat.ts threads selectedModel into buildChatToolArray', () => {
    const src = readSource('src/routes/chat/pipeline/chat/runChat.ts');
    // Must call buildChatToolArray with selectedModel: input.model
    expect(src).toMatch(/buildChatToolArray\s*\(\s*\{[\s\S]*?selectedModel\s*:\s*input\.model/);
  });

  it('modelTaskGate.ts exports the two required functions', () => {
    const src = readSource('src/services/modelTaskGate.ts');
    expect(src).toContain('export function modelSupportsTaskDispatch');
    expect(src).toContain('export async function shouldExposeTaskToolForModel');
  });

  it('modelTaskGate.ts has no hardcoded model IDs (capability-only gate)', () => {
    const src = readSource('src/services/modelTaskGate.ts');
    // Sanity: the gate file must not pattern-match by model name.
    // It can mention 'free' / 'low' (cost tiers) but no model family tokens.
    const forbidden = [
      /\bgpt-5\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i,
      /\bgemini\b/i, /\bllama\b/i, /\bgpt-oss\b/i, /\bmini\b/i,
    ];
    for (const re of forbidden) {
      expect(src).not.toMatch(re);
    }
  });
});
