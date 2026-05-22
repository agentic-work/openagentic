/**
 * Architecture source regression — Phase D.1 (2026-05-11).
 *
 * Pin: the chat pipeline's HookRunner threads through `deps.hooks` only.
 * `runChat.ts` MUST consume `deps.hooks` first; `getHookRunner()` may
 * appear only inside a fallback branch (the inline singleton resolution
 * for callers that bypass `buildChatV2Deps`). `chatLoop.ts` MUST NEVER
 * call `getHookRunner()` directly — its only hook surface is
 * `deps.hooks?.run(...)` / `deps.hooks?.runModifying(...)`.
 *
 * Why this pin: Phase D.1 closed a gap where `runChat` overwrote
 * `loopDeps.hooks` with an inline `getHookRunner()` call, ignoring the
 * factory-wired `deps.hooks`. That broke:
 *   - test injection (opts.hooks override never propagated past the deps
 *     boundary)
 *   - per-tenant / per-request hook composition (the factory could wire a
 *     custom runner but runChat would ignore it)
 *   - the "consistent invocation" contract for DLP / HITL / audit cross-cuts
 *
 * Failure mode if this regresses: cross-cuts fire inconsistently across
 * dispatch paths. DLP scans skip; HITL gates leak; audit log loses rows.
 *
 * Spec: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §D.2
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RUNCHAT_TS = resolve(__dirname, '../../routes/chat/pipeline/chat/runChat.ts');
const CHATLOOP_TS = resolve(__dirname, '../../routes/chat/pipeline/chat/chatLoop.ts');
const DISPATCH_TOOL_TS = resolve(__dirname, '../../routes/chat/pipeline/chat/dispatchTool.ts');
const DISPATCH_CHAT_TOOL_CALL_TS = resolve(
  __dirname,
  '../../routes/chat/pipeline/chat/dispatchChatToolCall.ts',
);

describe('arch: HookRunner threads through deps.hooks (Phase D.1)', () => {
  it('runChat.ts prefers deps.hooks over inline getHookRunner()', () => {
    const src = readFileSync(RUNCHAT_TS, 'utf8');
    // Strip block + line comments so the assertions are anchored on actual
    // code, not docstring mentions of `deps.hooks`.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, ''))
      .join('\n');

    // The implementation MUST read `deps.hooks` as live code (not just a
    // comment reference). Use a strict guard-style pattern: an `if`
    // statement that reads `deps.hooks` — that's the precedence branch
    // Phase D.1 introduced.
    expect(codeOnly).toMatch(/if\s*\(\s*deps\.hooks\b/);

    // Confirm `getHookRunner()` is GUARDED — the only allowed appearance is
    // inside the `else`-arm of the `if (deps.hooks)` precedence branch.
    // We match this loosely: the FIRST `deps.hooks` read (as code) must
    // PRECEDE every `getHookRunner()` call in the file body.
    const codeLines = codeOnly.split('\n');
    const firstDepsHooksLine = codeLines.findIndex(l => /\bdeps\.hooks\b/.test(l));
    const firstGetHookRunnerCallLine = codeLines.findIndex(l =>
      /\bgetHookRunner\s*\(\)/.test(l),
    );

    expect(firstDepsHooksLine).toBeGreaterThan(-1);
    if (firstGetHookRunnerCallLine !== -1) {
      expect(firstDepsHooksLine).toBeLessThan(firstGetHookRunnerCallLine);
    }
  });

  it('chatLoop.ts never calls getHookRunner() directly — only via deps.hooks', () => {
    const src = readFileSync(CHATLOOP_TS, 'utf8');
    // chatLoop has NO business reaching into the singleton — its only hook
    // surface is deps.hooks. A direct `getHookRunner()` call here would
    // break test injection AND the per-request deps contract.
    expect(src).not.toMatch(/\bgetHookRunner\s*\(/);
    expect(src).not.toMatch(/\binitializeHookRunner\s*\(/);
  });

  it('dispatchTool.ts (adapter) does not reach into the HookRunner singleton', () => {
    const src = readFileSync(DISPATCH_TOOL_TS, 'utf8');
    // The dispatch adapter wraps the meta-tool router; cross-cuts MUST be
    // applied by the surrounding chatLoop via deps.hooks. Reaching into the
    // singleton here would duplicate cross-cuts.
    expect(src).not.toMatch(/\bgetHookRunner\s*\(/);
    expect(src).not.toMatch(/\binitializeHookRunner\s*\(/);
  });

  it('dispatchChatToolCall.ts (meta-tool router) does not reach into the HookRunner singleton', () => {
    const src = readFileSync(DISPATCH_CHAT_TOOL_CALL_TS, 'utf8');
    // Same reasoning as dispatchTool.ts — the meta-tool router is wrapped
    // by chatLoop's wrappedDispatch which already runs before_tool_call /
    // after_tool_call cross-cuts via deps.hooks.
    expect(src).not.toMatch(/\bgetHookRunner\s*\(/);
    expect(src).not.toMatch(/\binitializeHookRunner\s*\(/);
  });
});
