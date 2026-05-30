/**
 * RenderingService — XLSX per-artifact export
 *
 * Sprint B (Step 4 of the streaming-engine finish-everything mission).
 *
 * Surface: `RenderingService.exportArtifactToXLSX(artifact, opts) => Buffer`
 *
 * Inputs supported (both produced by the chatmode pipeline):
 *
 *   - `streaming_table` — `{ columns: string[]; rows: Array<Record<string,
 *     unknown> | unknown[]> }`  Either object-shaped rows (preferred — column
 *     key looked up in row) or positional arrays (length must match columns).
 *
 *   - `compose_visual` data — `{ data: Record<string, unknown> }` with the
 *     primary array on `.data.rows` OR `.data.nodes` OR `.data.series`,
 *     auto-detected. The exporter picks the first array under `data` and
 *     transposes objects into row form.
 *
 * Output: an XLSX Buffer the route hands directly to the client.
 *
 * Tests (RED-first):
 *
 *   T1 — streaming_table with N=3 rows + 4 columns → workbook contains
 *        1 sheet "Artifact", first row = header (4 cells), body = 3 rows.
 *   T2 — column count from columns array preserved.
 *   T3 — compose_visual with `data.rows` auto-detected.
 *   T4 — empty rows → 1 sheet with header only.
 *   T5 — Unsupported shape → throws a descriptive Error.
 */

import { describe, it, expect } from 'vitest';
import { read as XLSXread, utils as XLSXutils } from 'xlsx';
import { Logger } from 'pino';

import { RenderingService } from '../RenderingService.js';

// Minimal logger shim — RenderingService only consumes .info/.warn/.error.
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => noopLogger,
  level: 'silent',
} as unknown as Logger;

function readWorkbookRows(buf: Buffer): { sheetName: string; aoa: unknown[][] } {
  const wb = XLSXread(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = XLSXutils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  return { sheetName, aoa };
}

describe('RenderingService.exportArtifactToXLSX', () => {
  const svc = new RenderingService(noopLogger);

  it('T1 — streaming_table with 3 rows + 4 cols → workbook has header + 3 body rows', async () => {
    const artifact = {
      type: 'streaming_table' as const,
      columns: ['service', 'region', 'cost_usd', 'env'],
      rows: [
        { service: 'EC2', region: 'us-east-1', cost_usd: 412.18, env: 'prod' },
        { service: 'S3', region: 'us-east-1', cost_usd: 89.42, env: 'prod' },
        { service: 'Lambda', region: 'us-west-2', cost_usd: 12.75, env: 'staging' },
      ],
    };

    const buf = await svc.exportArtifactToXLSX(artifact, { title: 'AWS Cost' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const { sheetName, aoa } = readWorkbookRows(buf);
    expect(sheetName).toBeTruthy();
    expect(aoa).toHaveLength(4); // header + 3 body
    expect(aoa[0]).toEqual(['service', 'region', 'cost_usd', 'env']);
    expect(aoa[1]).toEqual(['EC2', 'us-east-1', 412.18, 'prod']);
    expect(aoa[2][0]).toBe('S3');
    expect(aoa[3][0]).toBe('Lambda');
  });

  it('T2 — column count from columns[] preserved when row has extra keys', async () => {
    const artifact = {
      type: 'streaming_table' as const,
      columns: ['name', 'value'],
      rows: [
        { name: 'a', value: 1, junk: 'ignored' },
        { name: 'b', value: 2, junk: 'ignored' },
      ],
    };
    const buf = await svc.exportArtifactToXLSX(artifact, {});
    const { aoa } = readWorkbookRows(buf);
    expect(aoa[0]).toEqual(['name', 'value']); // header only 2 cols
    expect(aoa[1]).toEqual(['a', 1]);
    expect(aoa[2]).toEqual(['b', 2]);
  });

  it('T3 — compose_visual data.rows auto-detected', async () => {
    const artifact = {
      type: 'compose_visual' as const,
      template: 'sankey',
      data: {
        rows: [
          { source: 'Prod', target: 'EC2', value: 1200 },
          { source: 'Prod', target: 'S3', value: 300 },
        ],
      },
    };
    const buf = await svc.exportArtifactToXLSX(artifact, {});
    const { aoa } = readWorkbookRows(buf);
    expect(aoa[0]).toEqual(['source', 'target', 'value']);
    expect(aoa).toHaveLength(3);
    expect(aoa[1]).toEqual(['Prod', 'EC2', 1200]);
  });

  it('T4 — empty rows → header-only workbook (no body rows)', async () => {
    const artifact = {
      type: 'streaming_table' as const,
      columns: ['a', 'b'],
      rows: [],
    };
    const buf = await svc.exportArtifactToXLSX(artifact, {});
    const { aoa } = readWorkbookRows(buf);
    expect(aoa).toHaveLength(1);
    expect(aoa[0]).toEqual(['a', 'b']);
  });

  it('T5 — unsupported artifact shape throws descriptive Error', async () => {
    await expect(
      svc.exportArtifactToXLSX({ type: 'app_render', html: '<div/>' } as any, {}),
    ).rejects.toThrow(/unsupported|app_render|cannot export/i);
  });
});
