/**
 * POST /api/render/export-artifact — XLSX per-artifact export route.
 *
 * Sprint B (Step 4 of the streaming-engine finish-everything mission).
 *
 * Contract:
 *
 *   POST /api/render/export-artifact
 *   Body: {
 *     artifact: { type: 'streaming_table' | 'compose_visual'; ... },
 *     format: 'xlsx',
 *     filename?: string
 *   }
 *   Response: 200 + binary xlsx
 *     Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *     Content-Disposition: attachment; filename="<filename>.xlsx"
 *
 * Tests:
 *   R1 — happy path streaming_table → 200 + xlsx content-type + non-zero body
 *   R2 — missing artifact → 400
 *   R3 — unsupported format → 400
 *   R4 — unsupported artifact type → 422 (descriptive error)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import renderRoutes from '../render.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(renderRoutes, { prefix: '/api/render' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/render/export-artifact', () => {
  it('R1 — happy path: streaming_table → 200 + xlsx body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/render/export-artifact',
      payload: {
        format: 'xlsx',
        filename: 'cost-by-service',
        artifact: {
          type: 'streaming_table',
          columns: ['service', 'cost_usd'],
          rows: [
            { service: 'EC2', cost_usd: 412 },
            { service: 'S3', cost_usd: 89 },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toMatch(/attachment;.*\.xlsx/i);
    // XLSX is a ZIP — first 2 bytes are "PK"
    const body = res.rawPayload;
    expect(body.length).toBeGreaterThan(50);
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
  });

  it('R2 — missing artifact → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/render/export-artifact',
      payload: { format: 'xlsx' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('R3 — unsupported format → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/render/export-artifact',
      payload: {
        format: 'csv',
        artifact: { type: 'streaming_table', columns: ['a'], rows: [] },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('R4 — unsupported artifact type → 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/render/export-artifact',
      payload: {
        format: 'xlsx',
        artifact: { type: 'app_render', html: '<div/>' },
      },
    });
    expect(res.statusCode).toBe(422);
    const json = res.json();
    expect(String(json.error ?? '')).toMatch(/unsupported|app_render|cannot export/i);
  });
});
