/**
 * error_handler node — RED (pins Phase B sweep failure).
 *
 * Phase B evidence: the error_handler node fires eagerly + fans out to
 * BOTH the happy branch and the error branch regardless of whether the
 * wrapped node succeeded or threw. Expected behavior: only the happy
 * branch runs when the wrapped node returns, and only the error branch
 * runs when it throws.
 *
 * These tests pin the two-state contract:
 *   - success path: only the happy branch executes (error branch
 *     output is undefined)
 *   - error path: only the error branch executes (happy branch output
 *     is undefined) AND the overall workflow status is 'completed'
 *     rather than 'failed' — error_handler is designed to recover
 *     execution onto the error branch, not surface the failure to the
 *     caller.
 *
 * The wrapped node is an http_request — one mock returns 200 OK, the
 * other points at an unmocked host so the executor throws.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('error_handler node — branches by wrapped success vs throw', () => {
  it('only the happy branch runs when the wrapped node succeeds', async () => {
    harnessServer.use(
      http.get('https://api.test/eh-success', () =>
        HttpResponse.json({ ok: true }),
      ),
      http.get('https://api.test/eh-happy', () =>
        HttpResponse.json({ branch: 'happy' }),
      ),
      http.get('https://api.test/eh-error', () =>
        HttpResponse.json({ branch: 'error' }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'wrapped',
            type: 'http_request',
            data: {
              url: 'https://api.test/eh-success',
              method: 'GET',
              onError: 'route_to_error_handler',
            },
          },
          { id: 'eh', type: 'error_handler', data: { errorAction: 'log' } },
          {
            id: 'happy',
            type: 'http_request',
            data: { url: 'https://api.test/eh-happy', method: 'GET' },
          },
          {
            id: 'errorbr',
            type: 'http_request',
            data: { url: 'https://api.test/eh-error', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'wrapped' },
          { id: 'e2', source: 'wrapped', target: 'happy' },
          { id: 'e3', source: 'wrapped', sourceHandle: 'error', target: 'eh' },
          { id: 'e4', source: 'eh', target: 'errorbr' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.happy).toBeDefined();
    expect(result.outputs.errorbr).toBeUndefined();
    expect(result.outputs.eh).toBeUndefined();
  });

  it('only the error branch runs when the wrapped node throws', async () => {
    harnessServer.use(
      http.get('https://api.test/eh-happy', () =>
        HttpResponse.json({ branch: 'happy' }),
      ),
      http.get('https://api.test/eh-error', () =>
        HttpResponse.json({ branch: 'error' }),
      ),
      // Wrapped node fails: respond 500 so http_request rejects, and the
      // engine routes onto the 'error' sourceHandle to the error_handler.
      http.get('https://api.test/eh-fail', () =>
        new HttpResponse(JSON.stringify({ err: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'wrapped',
            type: 'http_request',
            data: {
              url: 'https://api.test/eh-fail',
              method: 'GET',
              onError: 'route_to_error_handler',
            },
          },
          { id: 'eh', type: 'error_handler', data: { errorAction: 'log' } },
          {
            id: 'happy',
            type: 'http_request',
            data: { url: 'https://api.test/eh-happy', method: 'GET' },
          },
          {
            id: 'errorbr',
            type: 'http_request',
            data: { url: 'https://api.test/eh-error', method: 'GET' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'wrapped' },
          { id: 'e2', source: 'wrapped', target: 'happy' },
          { id: 'e3', source: 'wrapped', sourceHandle: 'error', target: 'eh' },
          { id: 'e4', source: 'eh', target: 'errorbr' },
        ],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.errorbr).toBeDefined();
    expect(result.outputs.happy).toBeUndefined();
  });
});
