/**
 * select_data — executor unit tests.
 *
 * Pick + omit modes, single object + array of objects, nested dot-paths.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-select-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_select',
  type: 'select_data',
  data,
});

describe('select_data/executor', () => {
  it('pick mode — keeps only listed top-level fields from an object', async () => {
    const out = await execute(
      mk({ fields: ['name', 'status'], mode: 'pick' }),
      { name: 'api', status: 'Running', restarts: 5, irrelevant: 'x' },
      makeCtx(),
    );
    expect(out).toEqual({ name: 'api', status: 'Running' });
  });

  it('pick mode — applies per-row across an array', async () => {
    const out = await execute(
      mk({ fields: ['name'], mode: 'pick' }),
      [{ name: 'a', x: 1 }, { name: 'b', x: 2 }],
      makeCtx(),
    );
    expect(out).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('pick mode — supports nested dot-paths', async () => {
    const out = await execute(
      mk({ fields: ['metadata.name', 'status.phase'], mode: 'pick' }),
      {
        metadata: { name: 'foo', uid: 'xyz' },
        status: { phase: 'Running', conditions: [] },
        spec: { containers: [] },
      },
      makeCtx(),
    );
    expect(out).toEqual({
      metadata: { name: 'foo' },
      status: { phase: 'Running' },
    });
  });

  it('omit mode — drops listed fields, keeps rest', async () => {
    const out = await execute(
      mk({ fields: ['restarts'], mode: 'omit' }),
      { name: 'api', status: 'Running', restarts: 5 },
      makeCtx(),
    );
    expect(out).toEqual({ name: 'api', status: 'Running' });
  });

  it('defaults to pick mode when mode is omitted', async () => {
    const out = await execute(
      mk({ fields: ['name'] }),
      { name: 'x', other: 'y' },
      makeCtx(),
    );
    expect(out).toEqual({ name: 'x' });
  });

  it('throws when fields is not a non-empty array', async () => {
    await expect(
      execute(mk({ fields: [] }), { x: 1 }, makeCtx()),
    ).rejects.toThrow(/non-empty array/i);
  });

  it('throws when input is null/undefined', async () => {
    await expect(
      execute(mk({ fields: ['x'] }), null, makeCtx()),
    ).rejects.toThrow(/input is required/i);
  });
});
