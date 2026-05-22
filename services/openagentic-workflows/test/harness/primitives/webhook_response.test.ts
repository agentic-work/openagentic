/**
 * webhook_response node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Returns `{ statusCode, body, delivered: true, resolvedHeaders }`.
 *   - statusCode falls back to 200 when not set.
 *   - The body is templated against the input.
 *   - The headers field accepts a JSON string with template placeholders
 *     and is interpolated + parsed into a plain object.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('webhook_response node — response shape', () => {
  it('renders body + headers from templates and reports delivered:true', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'resp',
            type: 'webhook_response',
            data: {
              statusCode: 201,
              headers: '{"X-Run-Id": "{{input.runId}}", "Content-Type": "application/json"}',
              bodyTemplate: '{"status":"{{input.status}}","ok":true}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'resp' }],
      },
      input: { runId: 'wf-9', status: 'success' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.resp as {
      statusCode: number;
      body: string;
      delivered: boolean;
      resolvedHeaders: Record<string, string>;
    };
    expect(out.statusCode).toBe(201);
    expect(out.delivered).toBe(true);
    expect(out.body).toContain('"status":"success"');
    expect(out.resolvedHeaders).toMatchObject({
      'X-Run-Id': 'wf-9',
      'Content-Type': 'application/json',
    });
  });

  it('defaults statusCode to 200 when not specified', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'resp', type: 'webhook_response', data: { bodyTemplate: 'ok' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'resp' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.resp as { statusCode: number };
    expect(out.statusCode).toBe(200);
  });
});
