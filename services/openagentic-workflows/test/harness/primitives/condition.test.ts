/**
 * condition node — RED (pins Phase B sweep failure).
 *
 * Phase B evidence: condition evaluates the expression correctly but
 * does NOT gate downstream — when the expression is true, both the
 * matched=true branch AND the matched=false branch run, and vice versa.
 *
 * These tests assert the exclusive-branch contract: when the expression
 * is true, only the true-branch target executes; when false, only the
 * false-branch target executes.
 *
 * The branches are http_request nodes hitting distinct mocked URLs so
 * we can trivially detect whether the "skipped" branch actually ran:
 * if outputs[skipped-id] is defined, the branch executed.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('condition node — exclusive branch routing', () => {
  it('routes ONLY to matched=true branch when expression is true', async () => {
    harnessServer.use(
      http.get('https://api.test/condition-true', () =>
        HttpResponse.json({ branch: 'true' }),
      ),
      http.get('https://api.test/condition-false', () =>
        HttpResponse.json({ branch: 'false' }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'cond', type: 'condition', data: { expression: 'input.x > 3' } },
          {
            id: 'true_branch',
            type: 'http_request',
            data: { url: 'https://api.test/condition-true', method: 'GET' },
          },
          {
            id: 'false_branch',
            type: 'http_request',
            data: { url: 'https://api.test/condition-false', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'cond' },
          { id: 'e2', source: 'cond', sourceHandle: 'true', target: 'true_branch' },
          { id: 'e3', source: 'cond', sourceHandle: 'false', target: 'false_branch' },
        ],
      },
      input: { x: 5 },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.true_branch).toBeDefined();
    expect(result.outputs.false_branch).toBeUndefined();
  });

  it('routes ONLY to matched=false branch when expression is false', async () => {
    harnessServer.use(
      http.get('https://api.test/condition-true', () =>
        HttpResponse.json({ branch: 'true' }),
      ),
      http.get('https://api.test/condition-false', () =>
        HttpResponse.json({ branch: 'false' }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'cond', type: 'condition', data: { expression: 'input.x > 3' } },
          {
            id: 'true_branch',
            type: 'http_request',
            data: { url: 'https://api.test/condition-true', method: 'GET' },
          },
          {
            id: 'false_branch',
            type: 'http_request',
            data: { url: 'https://api.test/condition-false', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'cond' },
          { id: 'e2', source: 'cond', sourceHandle: 'true', target: 'true_branch' },
          { id: 'e3', source: 'cond', sourceHandle: 'false', target: 'false_branch' },
        ],
      },
      input: { x: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.false_branch).toBeDefined();
    expect(result.outputs.true_branch).toBeUndefined();
  });
});
