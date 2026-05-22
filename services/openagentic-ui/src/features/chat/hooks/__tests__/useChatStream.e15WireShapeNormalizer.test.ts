/**
 * E1.5 (2026-05-12) — wire-shape normalizer for tool_executing + tool_result.
 *
 * BUG 1 (RED): the live verify against dev showed every tool_executing
 * frame on the wire emits `{name, tool_use_id, input}` (per
 * services/openagentic-api/src/routes/chat/pipeline/chat/builders.ts
 * `buildToolExecuting`), but the UI's `useChatStream` reducer read
 * `safeData.arguments`. Result: every INPUT panel after expand showed
 * `{}` because `safeData.arguments === undefined`. Same shape mismatch
 * for tool_result.content vs the UI reading safeData.result.
 *
 * Ground truth wire capture: reports/verify-cadence/B5/d69bdb0b/after-trace-full.ndjson
 * line 4: `{"name":"tool_search","tool_use_id":"...","input":{"query":"...","k":5},"type":"tool_executing"}`
 * line 5: `{"name":"tool_search","tool_use_id":"...","content":{"summary":"...","data":"..."},"is_error":false,"_meta":{...},"type":"tool_result"}`
 *
 * The normalizers MUST accept BOTH canonical (input/content) and legacy
 * (arguments/result) shapes, with canonical taking precedence. This
 * keeps the live + reload paths symmetric.
 */
import { describe, it, expect } from 'vitest';
import {
  extractToolExecutingArgs,
  extractToolExecutingToolUseId,
  extractToolResultContent,
} from '../useChatStream';

describe('E1.5 wire-shape normalizer — tool_executing', () => {
  it('reads canonical `input` (V2 wire shape from buildToolExecuting)', () => {
    const wire = {
      name: 'aws_cost_by_service',
      tool_use_id: 'call_lo64xVVpNtDMrbzvM42axRfo',
      input: { days: 30, group_by: 'SERVICE', granularity: 'MONTHLY' },
      type: 'tool_executing',
    };
    expect(extractToolExecutingArgs(wire)).toEqual({
      days: 30,
      group_by: 'SERVICE',
      granularity: 'MONTHLY',
    });
    expect(extractToolExecutingToolUseId(wire)).toBe(
      'call_lo64xVVpNtDMrbzvM42axRfo',
    );
  });

  it('falls back to legacy `arguments` when only legacy shape present', () => {
    const legacy = {
      name: 'azure_list_subscriptions',
      toolCallId: 'tc_1',
      arguments: { filter: 'active' },
    };
    expect(extractToolExecutingArgs(legacy)).toEqual({ filter: 'active' });
    expect(extractToolExecutingToolUseId(legacy)).toBe('tc_1');
  });

  it('prefers canonical `input` over legacy `arguments` when both present', () => {
    const both = {
      name: 'tool_search',
      tool_use_id: 'tu_1',
      input: { query: 'canonical' },
      arguments: { query: 'legacy' },
    };
    expect(extractToolExecutingArgs(both)).toEqual({ query: 'canonical' });
  });

  it('returns undefined when neither shape carries args (no false {} default)', () => {
    expect(extractToolExecutingArgs({ name: 'x' })).toBeUndefined();
    expect(extractToolExecutingArgs(null)).toBeUndefined();
    expect(extractToolExecutingArgs(undefined)).toBeUndefined();
  });
});

describe('E1.5 wire-shape normalizer — tool_result', () => {
  it('reads canonical `content` (V2 wire shape from buildToolResult)', () => {
    const wire = {
      name: 'tool_search',
      tool_use_id: 'tu_1',
      content: { summary: '54 lines, 1427 chars', data: 'Found 50 tools' },
      is_error: false,
      type: 'tool_result',
    };
    expect(extractToolResultContent(wire)).toEqual({
      summary: '54 lines, 1427 chars',
      data: 'Found 50 tools',
    });
  });

  it('falls back to legacy `result` when only legacy shape present', () => {
    const legacy = { name: 'x', result: { ok: true } };
    expect(extractToolResultContent(legacy)).toEqual({ ok: true });
  });

  it('prefers canonical `content` over legacy `result` when both present', () => {
    const both = {
      name: 'x',
      content: { src: 'canonical' },
      result: { src: 'legacy' },
    };
    expect(extractToolResultContent(both)).toEqual({ src: 'canonical' });
  });

  it('returns undefined when neither shape carries the body', () => {
    expect(extractToolResultContent({ name: 'x' })).toBeUndefined();
    expect(extractToolResultContent(null)).toBeUndefined();
  });

  it('passes structured object content through verbatim (no stringify)', () => {
    // E1.5 RED: when the API stops JSON.stringifying the MCP result (Bug 2
    // fix), the wire `content.data` is a plain object. The UI must NOT
    // re-stringify — JsonView renders the object natively.
    const wire = {
      name: 'aws_cost_by_service',
      content: {
        summary: 'Object with 3 fields',
        data: { ok: true, totalCost: 42.0, services: ['EC2', 'S3'] },
      },
    };
    const got = extractToolResultContent(wire);
    expect(typeof got).toBe('object');
    expect((got as any).data).toEqual({
      ok: true,
      totalCost: 42.0,
      services: ['EC2', 'S3'],
    });
    // critical: the inner data must NOT be a string with escape chars
    expect(typeof (got as any).data).not.toBe('string');
  });
});
