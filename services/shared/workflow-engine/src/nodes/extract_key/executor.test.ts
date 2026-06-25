/**
 * extract_key — executor unit tests.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-extract-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_extract',
  type: 'extract_key',
  data,
});

describe('extract_key/executor', () => {
  it('extracts a nested value via dot path', async () => {
    const out = await execute(
      mk({ path: 'data.items.0.name' }),
      { data: { items: [{ name: 'alpha' }, { name: 'beta' }] } },
      makeCtx(),
    );
    expect(out).toEqual({ value: 'alpha', found: true });
  });

  it('supports bracket notation for arrays', async () => {
    const out = await execute(
      mk({ path: 'items[1].id' }),
      { items: [{ id: 'a' }, { id: 'b' }] },
      makeCtx(),
    );
    expect(out).toEqual({ value: 'b', found: true });
  });

  it('returns found=false when path is missing and no default', async () => {
    const out = await execute(
      mk({ path: 'data.missing.name' }),
      { data: { other: 1 } },
      makeCtx(),
    );
    expect(out.found).toBe(false);
    expect(out.value).toBeUndefined();
  });

  it('returns default when path is missing', async () => {
    const out = await execute(
      mk({ path: 'data.missing', default: 'unknown' }),
      { data: {} },
      makeCtx(),
    );
    expect(out).toEqual({ value: 'unknown', found: false });
  });

  it('extracts primitive at root path', async () => {
    const out = await execute(
      mk({ path: 'count' }),
      { count: 42 },
      makeCtx(),
    );
    expect(out).toEqual({ value: 42, found: true });
  });

  it('throws when path is empty', async () => {
    await expect(
      execute(mk({ path: '' }), {}, makeCtx()),
    ).rejects.toThrow(/'path' is required/);
  });
});
