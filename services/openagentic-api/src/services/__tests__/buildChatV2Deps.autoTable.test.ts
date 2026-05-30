/**
 * Phase 31 — sub-agent tool-result auto-emit streaming_table.
 *
 * The runSubagent path wraps `executeMcpTool(parentCtx, name, input)`
 * with `ctxAwareExec(name, input)` so the SubagentOrchestrator can
 * call it without knowing about parentCtx. We hoist
 * autoEmitStreamingTable into THAT wrapper so list-shaped sub-agent
 * tool results fire a streaming_table frame on parentCtx.emit.
 *
 * This is the only seam where we have:
 *   1. The full tool result string (post executeMcpTool)
 *   2. The chat-loop's parentCtx.emit
 *   3. A stable tool name (call.toolName from the orch loop)
 *
 * Direct wiring at SubagentOrchestrator.runSubagentReActLoop would
 * require threading parentCtx 3 layers deep; the wrapper is cleaner.
 */

import { describe, it, expect, vi } from 'vitest';
import { wrapWithAutoTableEmit } from '../buildChatV2Deps.js';

describe('wrapWithAutoTableEmit (Phase 31)', () => {
  it('passes through tool results unchanged', async () => {
    const inner = vi.fn().mockResolvedValue({
      ok: true,
      output: '[{"a":1,"b":2},{"a":3,"b":4}]',
    });
    const ctx = { emit: vi.fn() };
    const wrapped = wrapWithAutoTableEmit(ctx, inner);
    const r = await wrapped('list_things', { q: 1 });
    expect(r.ok).toBe(true);
    expect(r.output).toBe('[{"a":1,"b":2},{"a":3,"b":4}]');
  });

  it('emits streaming_table for list-shaped JSON-string outputs', async () => {
    const inner = vi.fn().mockResolvedValue({
      ok: true,
      output: JSON.stringify([
        { name: 'core-api', location: 'eastus2', state: 'Succeeded' },
        { name: 'data', location: 'eastus2', state: 'Succeeded' },
        { name: 'staging', location: 'westus2', state: 'Succeeded' },
      ]),
    });
    const emit = vi.fn();
    const wrapped = wrapWithAutoTableEmit({ emit }, inner);
    await wrapped('azure_list_resource_groups', {});
    const tableEmit = emit.mock.calls.find(([type]) => type === 'streaming_table');
    expect(tableEmit).not.toBeUndefined();
    const [, payload] = tableEmit!;
    expect(payload.title).toBe('azure_list_resource_groups');
    expect(payload.columns).toHaveLength(3);
    expect(payload.rows).toHaveLength(3);
  });

  it('does NOT emit when result is a scalar / prose string', async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, output: 'just a status message' });
    const emit = vi.fn();
    const wrapped = wrapWithAutoTableEmit({ emit }, inner);
    await wrapped('something', {});
    const tableEmit = emit.mock.calls.find(([type]) => type === 'streaming_table');
    expect(tableEmit).toBeUndefined();
  });

  it('does NOT emit on failed tool results', async () => {
    const inner = vi.fn().mockResolvedValue({ ok: false, error: 'boom' });
    const emit = vi.fn();
    const wrapped = wrapWithAutoTableEmit({ emit }, inner);
    await wrapped('x', {});
    expect(emit).not.toHaveBeenCalled();
  });

  it('survives ctx without an emit function', async () => {
    const inner = vi.fn().mockResolvedValue({
      ok: true,
      output: JSON.stringify([{ a: 1 }, { a: 2 }]),
    });
    const wrapped = wrapWithAutoTableEmit({}, inner);
    const r = await wrapped('x', {});
    expect(r.ok).toBe(true);
  });
});
