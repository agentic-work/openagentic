/**
 * guardrails node — Phase E1 primitive contract.
 *
 * Public contract:
 *   - POSTs `{ content, checks, action }` to `${apiUrl}/api/v1/guardrails/check`.
 *   - On 2xx returns the API response verbatim (must include passed/findings).
 *   - On 4xx/5xx falls back to local regex scan and returns
 *     `{ passed, findings, action, content, checksRun }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('guardrails node — policy enforcement', () => {
  it('passes clean content and reports passed:true from the api', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/guardrails/check', async () =>
        HttpResponse.json({ passed: true, findings: [], action: 'allow', checksRun: ['pii'] }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'gr',
            type: 'guardrails',
            data: { checks: ['pii'], action: 'block' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'gr' }],
      },
      input: 'Customer Alice asked when her order ships.',
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.gr as { passed: boolean; findings: unknown[] };
    expect(out.passed).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it('falls back to local regex when api returns 500 — flags SSN', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/guardrails/check', async () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'gr',
            type: 'guardrails',
            data: { checks: ['pii'], action: 'block' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'gr' }],
      },
      input: 'Customer SSN is 123-45-6789. Please process.',
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.gr as {
      passed: boolean;
      findings: string[];
      action: string;
      checksRun: string[];
    };
    expect(out.passed).toBe(false);
    expect(out.findings.join(' ')).toMatch(/SSN/i);
    expect(out.action).toBe('block');
    expect(out.checksRun).toContain('pii');
  });
});
