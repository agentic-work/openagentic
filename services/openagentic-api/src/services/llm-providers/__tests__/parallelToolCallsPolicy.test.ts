/**
 * parallelToolCallsPolicy — TDD spec.
 *
 * A single source of truth for "should this outbound LLM request have
 * parallel tool calls enabled?". Each provider calls this helper so we
 * don't scatter 5 copies of the same env-flag check across the codebase.
 *
 * Rules:
 *   - tools empty → policy returns `disabled` (no flag to set)
 *   - tools present AND env flag unset → `enabled`
 *   - env flag SYNTH_ENABLE_PARALLEL_TOOL_CALLS=false → `disabled` (kill
 *     switch; easy rollback if a model starts looping)
 *   - per-request override via request.metadata.disableParallelToolCalls wins
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldEnableParallelToolCalls } from '../parallelToolCallsPolicy.js';

describe('shouldEnableParallelToolCalls', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SYNTH_ENABLE_PARALLEL_TOOL_CALLS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns false when tools list is empty', () => {
    expect(shouldEnableParallelToolCalls({ tools: [] })).toBe(false);
  });

  it('returns false when tools is undefined', () => {
    expect(shouldEnableParallelToolCalls({})).toBe(false);
  });

  it('returns true when tools present and no env override', () => {
    expect(
      shouldEnableParallelToolCalls({ tools: [{ type: 'function', function: { name: 'f' } }] }),
    ).toBe(true);
  });

  it('returns false when SYNTH_ENABLE_PARALLEL_TOOL_CALLS=false (kill switch)', () => {
    process.env.SYNTH_ENABLE_PARALLEL_TOOL_CALLS = 'false';
    expect(
      shouldEnableParallelToolCalls({ tools: [{ type: 'function', function: { name: 'f' } }] }),
    ).toBe(false);
  });

  it('returns true when SYNTH_ENABLE_PARALLEL_TOOL_CALLS=true is explicit', () => {
    process.env.SYNTH_ENABLE_PARALLEL_TOOL_CALLS = 'true';
    expect(
      shouldEnableParallelToolCalls({ tools: [{ type: 'function', function: { name: 'f' } }] }),
    ).toBe(true);
  });

  it('per-request override wins over env default', () => {
    expect(
      shouldEnableParallelToolCalls({
        tools: [{ type: 'function', function: { name: 'f' } }],
        metadata: { disableParallelToolCalls: true },
      }),
    ).toBe(false);
  });

  it('per-request override wins over env kill-switch (force-enable)', () => {
    process.env.SYNTH_ENABLE_PARALLEL_TOOL_CALLS = 'false';
    expect(
      shouldEnableParallelToolCalls({
        tools: [{ type: 'function', function: { name: 'f' } }],
        metadata: { disableParallelToolCalls: false },
      }),
    ).toBe(true);
  });
});
