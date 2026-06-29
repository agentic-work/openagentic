/**
 * csv_processor node executor — text-mode CSV parsing.
 *
 * Contract:
 *  - settings: { csv (required, templated), hasHeader (default true),
 *                delimiter (default ","), outputAs ('records'|'rows', default 'records') }
 *  - hasHeader=true + outputAs=records → array of objects keyed by header columns
 *  - hasHeader=true + outputAs=rows → first row is header strings, rest are string[]
 *  - hasHeader=false → array of string[] regardless of outputAs
 *  - Handles quoted fields containing the delimiter, quoted fields containing
 *    embedded quotes (RFC 4180 doubled-quote escape), and trailing newlines.
 *  - Output: { records?, rows?, columns, count, outputAs }
 *
 * V1 ships text-mode only — binary/file input is a follow-up after the
 * binary data plane lands.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext, WorkflowNode } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-csv-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: unknown) => {
      const root = input as Record<string, unknown> | null;
      return String(t).replace(/\{\{\s*input\.([\w.]+)\s*\}\}/g, (_, path) => {
        const segs = String(path).split('.');
        let cursor: unknown = root;
        for (const s of segs) {
          if (cursor && typeof cursor === 'object' && s in (cursor as Record<string, unknown>)) {
            cursor = (cursor as Record<string, unknown>)[s];
          } else {
            return '';
          }
        }
        return typeof cursor === 'string' ? cursor : JSON.stringify(cursor ?? '');
      });
    },
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>): WorkflowNode => ({
  id: 'n_csv',
  type: 'csv_processor',
  data,
}) as any;

describe('csv_processor/executor', () => {
  it('parses a simple csv with header into records', async () => {
    const csv = 'name,age,role\nalice,30,engineer\nbob,25,designer';
    const out: any = await execute(mk({ csv, hasHeader: true, outputAs: 'records' }), {}, makeCtx());
    expect(out.outputAs).toBe('records');
    expect(out.columns).toEqual(['name', 'age', 'role']);
    expect(out.count).toBe(2);
    expect(out.records[0]).toEqual({ name: 'alice', age: '30', role: 'engineer' });
    expect(out.records[1]).toEqual({ name: 'bob', age: '25', role: 'designer' });
  });

  it('emits rows[] when outputAs=rows + hasHeader=true', async () => {
    const csv = 'a,b\n1,2\n3,4';
    const out: any = await execute(mk({ csv, hasHeader: true, outputAs: 'rows' }), {}, makeCtx());
    expect(out.outputAs).toBe('rows');
    expect(out.columns).toEqual(['a', 'b']);
    expect(out.rows).toEqual([['1', '2'], ['3', '4']]);
    expect(out.count).toBe(2);
  });

  it('hasHeader=false → rows[], no records, no columns', async () => {
    const csv = '1,2,3\n4,5,6';
    const out: any = await execute(mk({ csv, hasHeader: false }), {}, makeCtx());
    expect(out.records).toBeUndefined();
    expect(out.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(out.columns).toEqual([]);
    expect(out.count).toBe(2);
  });

  it('handles quoted fields with embedded commas + escaped quotes', async () => {
    const csv = 'name,note\n"alice, smith","said ""hi"""\n"bob","plain"';
    const out: any = await execute(mk({ csv, hasHeader: true, outputAs: 'records' }), {}, makeCtx());
    expect(out.records[0]).toEqual({ name: 'alice, smith', note: 'said "hi"' });
    expect(out.records[1]).toEqual({ name: 'bob', note: 'plain' });
  });

  it('honors a custom delimiter (tab)', async () => {
    const csv = 'a\tb\n1\t2\n3\t4';
    const out: any = await execute(mk({ csv, hasHeader: true, delimiter: '\t', outputAs: 'records' }), {}, makeCtx());
    expect(out.columns).toEqual(['a', 'b']);
    expect(out.records).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });

  it('interpolates templated csv', async () => {
    const out: any = await execute(
      mk({ csv: '{{input.body}}', hasHeader: true, outputAs: 'records' }),
      { body: 'k,v\nA,1\nB,2' },
      makeCtx(),
    );
    expect(out.records).toEqual([{ k: 'A', v: '1' }, { k: 'B', v: '2' }]);
  });

  it('treats trailing blank lines as nothing', async () => {
    const csv = 'a,b\n1,2\n\n\n';
    const out: any = await execute(mk({ csv, hasHeader: true, outputAs: 'records' }), {}, makeCtx());
    expect(out.count).toBe(1);
    expect(out.records[0]).toEqual({ a: '1', b: '2' });
  });

  it('rejects empty csv', async () => {
    await expect(
      execute(mk({ csv: '   ', hasHeader: true }), {}, makeCtx()),
    ).rejects.toThrow(/csv|required|empty/i);
  });
});
