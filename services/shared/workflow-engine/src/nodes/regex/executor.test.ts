/**
 * regex — executor unit tests.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-regex-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_regex',
  type: 'regex',
  data,
});

describe('regex/executor', () => {
  it('match mode — collects all matches with capture groups', async () => {
    const out: any = await execute(
      mk({ pattern: '\\b(\\w+)@(\\w+\\.\\w+)\\b', flags: 'g', mode: 'match' }),
      'Contact a@b.io or c@d.com',
      makeCtx(),
    );
    expect(out.count).toBe(2);
    expect(out.matches[0]).toEqual({ full: 'a@b.io', groups: ['a', 'b.io'] });
    expect(out.matches[1]).toEqual({ full: 'c@d.com', groups: ['c', 'd.com'] });
  });

  it('match mode — returns one entry when global flag is absent', async () => {
    const out: any = await execute(
      mk({ pattern: '\\d+', mode: 'match' }),
      'a 12 b 34 c',
      makeCtx(),
    );
    expect(out.count).toBe(1);
    expect(out.matches[0].full).toBe('12');
  });

  it('match mode — empty array when nothing matches', async () => {
    const out: any = await execute(
      mk({ pattern: 'xyz', flags: 'g', mode: 'match' }),
      'no digits or letters of interest',
      makeCtx(),
    );
    expect(out.count).toBe(0);
    expect(out.matches).toEqual([]);
  });

  it('replace mode — substitutes with capture group references', async () => {
    const out: any = await execute(
      mk({
        pattern: '\\b(\\w+)@(\\w+\\.\\w+)\\b',
        flags: 'g',
        mode: 'replace',
        replacement: '$1 at $2',
      }),
      'Send to alice@example.com',
      makeCtx(),
    );
    expect(out.result).toBe('Send to alice at example.com');
    expect(out.replacedCount).toBe(1);
  });

  it('replace mode — counts each substitution', async () => {
    const out: any = await execute(
      mk({ pattern: '\\d', flags: 'g', mode: 'replace', replacement: 'X' }),
      'a1 b2 c3',
      makeCtx(),
    );
    expect(out.result).toBe('aX bX cX');
    expect(out.replacedCount).toBe(3);
  });

  it('test mode — returns boolean', async () => {
    const yes: any = await execute(
      mk({ pattern: '^Hello', mode: 'test' }),
      'Hello world',
      makeCtx(),
    );
    expect(yes.matches).toBe(true);

    const no: any = await execute(
      mk({ pattern: '^Hello', mode: 'test' }),
      'Goodbye',
      makeCtx(),
    );
    expect(no.matches).toBe(false);
  });

  it('throws on invalid regex pattern', async () => {
    await expect(
      execute(mk({ pattern: '[invalid', mode: 'match' }), 'x', makeCtx()),
    ).rejects.toThrow(/invalid pattern/);
  });

  it('throws when input is not a string', async () => {
    await expect(
      execute(mk({ pattern: 'x', mode: 'match' }), 42, makeCtx()),
    ).rejects.toThrow(/must be a string/);
  });

  it('throws when pattern is empty', async () => {
    await expect(
      execute(mk({ pattern: '', mode: 'match' }), 'x', makeCtx()),
    ).rejects.toThrow(/'pattern' is required/);
  });
});
