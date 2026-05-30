/**
 * Phase 4 / Task 4.7 — read_large_result meta-tool helper (RED → GREEN).
 *
 * Companion to the two-channel envelope: when a tool result overflows
 * (`_meta.artifactHandle` set), the model can paged-query the full
 * stored result via this meta-tool.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 *       (memory_search + read_large_result meta-tools)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  READ_LARGE_RESULT_TOOL_DEF,
  executeReadLargeResult,
} from '../ReadLargeResultTool.js';

describe('READ_LARGE_RESULT_TOOL_DEF', () => {
  it('declares an OpenAI function-shape definition with required handle param', () => {
    expect(READ_LARGE_RESULT_TOOL_DEF.type).toBe('function');
    expect(READ_LARGE_RESULT_TOOL_DEF.function.name).toBe('read_large_result');
    expect(READ_LARGE_RESULT_TOOL_DEF.function.parameters.required).toContain('handle');
  });

  it('exposes offset / limit / filter optional params', () => {
    const props = READ_LARGE_RESULT_TOOL_DEF.function.parameters.properties;
    expect(props).toHaveProperty('handle');
    expect(props).toHaveProperty('offset');
    expect(props).toHaveProperty('limit');
    expect(props).toHaveProperty('filter');
  });
});

describe('executeReadLargeResult', () => {
  it('forwards handle + offset + limit + filter to storage adapter', async () => {
    const get = vi.fn().mockResolvedValue({ rows: [{ a: 1 }, { a: 2 }] });
    const result = await executeReadLargeResult(
      { handle: 'result#tr_xyz', offset: 10, limit: 20, filter: 'state=running' },
      { largeResultStorage: { get } },
    );
    expect(get).toHaveBeenCalledWith(
      'result#tr_xyz',
      expect.objectContaining({ offset: 10, limit: 20, filter: 'state=running' }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ rows: [{ a: 1 }, { a: 2 }] });
  });

  it('defaults offset=0 and limit=50 when not supplied', async () => {
    const get = vi.fn().mockResolvedValue({ rows: [] });
    await executeReadLargeResult(
      { handle: 'h' },
      { largeResultStorage: { get } },
    );
    expect(get).toHaveBeenCalledWith(
      'h',
      expect.objectContaining({ offset: 0, limit: 50 }),
    );
  });

  it('returns ok:false when storage adapter throws', async () => {
    const get = vi.fn().mockRejectedValue(new Error('handle expired'));
    const result = await executeReadLargeResult(
      { handle: 'gone' },
      { largeResultStorage: { get } },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('handle expired');
  });
});
