/**
 * parse_json — executor unit tests.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-parse-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_parse',
  type: 'parse_json',
  data,
});

describe('parse_json/executor', () => {
  it('parses a valid JSON object string', async () => {
    const out = await execute(mk({}), '{"a":1,"b":"hi"}', makeCtx());
    expect(out).toEqual({ parsed: { a: 1, b: 'hi' }, parseError: null });
  });

  it('parses a JSON array string', async () => {
    const out = await execute(mk({}), '[1,2,3]', makeCtx());
    expect(out.parsed).toEqual([1, 2, 3]);
    expect(out.parseError).toBeNull();
  });

  it('passes already-parsed objects through unchanged', async () => {
    const obj = { x: 1, y: [2, 3] };
    const out = await execute(mk({}), obj, makeCtx());
    expect(out.parsed).toEqual(obj);
    expect(out.parseError).toBeNull();
  });

  it('throws on parse error when onError=fail (default)', async () => {
    await expect(
      execute(mk({}), '{ not valid json', makeCtx()),
    ).rejects.toThrow(/parse_json:/);
  });

  it('returns null + parseError when onError=null', async () => {
    const out = await execute(mk({ onError: 'null' }), 'oops', makeCtx());
    expect(out.parsed).toBeNull();
    expect(out.parseError).toMatch(/parse_json:/);
  });

  it('returns {} + parseError when onError=empty_object', async () => {
    const out = await execute(mk({ onError: 'empty_object' }), 'oops', makeCtx());
    expect(out.parsed).toEqual({});
    expect(out.parseError).toMatch(/parse_json:/);
  });

  it('rejects non-string non-object input with onError=fail', async () => {
    await expect(
      execute(mk({}), 42, makeCtx()),
    ).rejects.toThrow(/must be a string/);
  });
});
