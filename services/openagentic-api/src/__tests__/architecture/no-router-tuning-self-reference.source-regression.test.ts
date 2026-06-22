/**
 * Architecture-grep regression test.
 *
 * `chat/index.ts` wraps RouterTuningService into a `RouterTuningLike` shape
 * for the chat pipeline. The wrapper MUST capture the underlying service
 * in a separate const — NEVER reuse the wrapper variable inside its own
 * arrow body, or the closure self-references and infinite-recurses on every
 * call:
 *
 *   // BUG (caught live 2026-04-30):
 *   wave1RouterTuning = getRouterTuningService(...);
 *   wave1RouterTuning = { getTuning: () => wave1RouterTuning.getTuning() };
 *   //                                       ^ refers to the wrapper itself
 *
 *   // FIX:
 *   const tuningService = getRouterTuningService(...);
 *   wave1RouterTuning = { getTuning: () => tuningService.getTuning() };
 *
 * The bug shipped at commit 85b6a539 (2026-04-29 17:14 EDT) and broke chat
 * cascade tool dispatch for the next 19 hours because the catch block in
 * the legacy pipeline swallowed the resulting RangeError silently. This
 * test pins the fix in place so the same closure mistake cannot return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CHAT_INDEX_PATH = resolve(
  __dirname,
  '../../routes/chat/index.ts',
);

describe('no-router-tuning-self-reference — chat/index.ts', () => {
  it('wave1RouterTuning wrapper does NOT call wave1RouterTuning.getTuning() from within its own body', () => {
    const raw = readFileSync(CHAT_INDEX_PATH, 'utf8');

    // Strip both line comments (// ...) and block comments (/* ... */)
    // so we only match LIVE code. Without this, the descriptive comment
    // we ourselves added near the fix would re-fail the test.
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, '')) // line comments
      .join('\n');

    // Match: `wave1RouterTuning = { ... wave1RouterTuning.getTuning() ... }`
    // — i.e. the wrapper assignment that references itself.
    // Whitespace-tolerant; multiline-aware so the arrow body can span lines.
    const selfRefPattern =
      /wave1RouterTuning\s*=\s*\{\s*getTuning\s*:\s*\(\s*\)\s*=>\s*wave1RouterTuning\s*\.\s*getTuning\s*\(/;

    expect(
      selfRefPattern.test(codeOnly),
      [
        'chat/index.ts contains the routerTuning self-reference bug (in live code, not a comment).',
        'The wrapper closure must call a captured local (e.g. `tuningService.getTuning()`),',
        'not `wave1RouterTuning.getTuning()` which is the wrapper itself and infinite-recurses.',
        '',
        'Fix:',
        '    const tuningService = getRouterTuningService(prisma, redis as any);',
        '    wave1RouterTuning = { getTuning: () => tuningService.getTuning() };',
      ].join('\n'),
    ).toBe(false);
  });

  it('the wrapper still exists and exposes getTuning (regression guard against accidental rip)', () => {
    const src = readFileSync(CHAT_INDEX_PATH, 'utf8');
    // The wrapper SHOULD exist — the chat pipeline depends on it. We just
    // want to make sure the fix doesn't accidentally delete the wrapping logic.
    expect(src).toMatch(/wave1RouterTuning\s*=\s*\{\s*getTuning\s*:/);
  });
});
