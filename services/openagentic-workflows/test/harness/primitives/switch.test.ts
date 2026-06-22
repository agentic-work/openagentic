/**
 * switch node — Phase E1 primitive contract.
 *
 * Public contract: evaluates `expression` in an isolated sandbox, finds the
 * matching case (or `default`), and routes ONLY the matched outgoing edge.
 * Other case branches are skipped — mirrors the condition-node fix landed
 * in Phase C2.
 *
 * Output: `{ switchValue, matched, evaluatedExpression, selectedCase, input }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('switch node — multi-case dispatch', () => {
  it('routes ONLY the matched case (case_b) and skips siblings', async () => {
    harnessServer.use(
      http.get('https://api.test/case-a', () => HttpResponse.json({ branch: 'a' })),
      http.get('https://api.test/case-b', () => HttpResponse.json({ branch: 'b' })),
      http.get('https://api.test/case-c', () => HttpResponse.json({ branch: 'c' })),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sw',
            type: 'switch',
            data: {
              expression: 'input.severity',
              cases: [
                { value: 'low', label: 'low' },
                { value: 'mid', label: 'mid' },
                { value: 'high', label: 'high' },
              ],
            },
          },
          { id: 'case_a', type: 'http_request', data: { url: 'https://api.test/case-a', method: 'GET' } },
          { id: 'case_b', type: 'http_request', data: { url: 'https://api.test/case-b', method: 'GET' } },
          { id: 'case_c', type: 'http_request', data: { url: 'https://api.test/case-c', method: 'GET' } },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'sw' },
          { id: 'e2', source: 'sw', sourceHandle: 'low', target: 'case_a' },
          { id: 'e3', source: 'sw', sourceHandle: 'mid', target: 'case_b' },
          { id: 'e4', source: 'sw', sourceHandle: 'high', target: 'case_c' },
        ],
      },
      input: { severity: 'mid' },
    });

    expect(result.status).toBe('completed');
    const sw = result.outputs.sw as { matched: string; switchValue: string };
    expect(sw.matched).toBe('mid');
    expect(sw.switchValue).toBe('mid');

    expect(result.outputs.case_b).toBeDefined();
    expect(result.outputs.case_a).toBeUndefined();
    expect(result.outputs.case_c).toBeUndefined();
  });

  it('falls back to default case when no value matches', async () => {
    harnessServer.use(
      http.get('https://api.test/case-known', () => HttpResponse.json({ branch: 'known' })),
      http.get('https://api.test/case-default', () => HttpResponse.json({ branch: 'default' })),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sw',
            type: 'switch',
            data: {
              expression: 'input.kind',
              cases: [
                { value: 'known', label: 'known' },
                { value: 'default', label: 'default' },
              ],
            },
          },
          { id: 'known_branch', type: 'http_request', data: { url: 'https://api.test/case-known', method: 'GET' } },
          { id: 'default_branch', type: 'http_request', data: { url: 'https://api.test/case-default', method: 'GET' } },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'sw' },
          { id: 'e2', source: 'sw', sourceHandle: 'known', target: 'known_branch' },
          { id: 'e3', source: 'sw', sourceHandle: 'default', target: 'default_branch' },
        ],
      },
      input: { kind: 'something-else' },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.default_branch).toBeDefined();
    expect(result.outputs.known_branch).toBeUndefined();
  });
});
