/**
 * Architecture source regression — Phase 3 V3 Enterprise Chatmode.
 *
 * V3 chatLoop must wire all required HookRunner points so DLP/HITL/audit/
 * observability/cost cross-cuts attach via existing hook implementations.
 *
 * the design notes
 * the design notes
 *
 * Failure mode if a hook point goes missing: the DLP/HITL/audit/cost cross-cuts
 * silently stop running for chatmode V3 traffic. This test pins the wire-up
 * source-side so a refactor can't accidentally drop a hook call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHATLOOP_TS = resolve(__dirname, '../../routes/chat/pipeline/chat/chatLoop.ts');

const REQUIRED_HOOK_POINTS = [
  'on_turn_start',
  'before_streaming',
  'enrich_sse_event',
  'before_tool_call',
  'after_tool_call',
  'on_turn_end',
  'on_pipeline_end',
];

describe('arch: chatLoop wires all required hook points (Phase 3)', () => {
  const content = readFileSync(CHATLOOP_TS, 'utf8');

  it.each(REQUIRED_HOOK_POINTS)('chatLoop.ts contains hooks call for %s', (hookPoint) => {
    // Regex matches `hooks.run(...)`, `hooks?.run(...)`, `hooks.runModifying(...)`,
    // `hooks.runVoid(...)`, `hooks.runSync(...)`, with or without an inline
    // generic type parameter (`runModifying<any>(...)`).
    expect(content).toMatch(new RegExp(`hooks\\??\\.run\\w*(?:<[^>]+>)?\\(\\s*['"]${hookPoint}['"]`));
  });
});
