/**
 * webhook_response node — executor tests.
 *
 * Covers:
 *   1. default statusCode=200 when not specified
 *   2. custom statusCode is preserved
 *   3. bodyTemplate is interpolated via ctx.interpolateTemplate
 *   4. headers are interpolated and parsed from JSON string
 *   5. setWebhookResponse callback is called with resolved data
 *   6. returns { statusCode, body, delivered: true }
 *   7. headers default to empty object when not specified
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-webhook-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const webhookNode = (data: Record<string, unknown>) => ({
  id: 'n_webhook',
  type: 'webhook_response',
  data,
});

describe('webhook_response/executor', () => {
  it('default statusCode=200 when not specified', async () => {
    const out: any = await execute(webhookNode({}), { data: 'x' }, makeCtx());
    expect(out.statusCode).toBe(200);
    expect(out.delivered).toBe(true);
  });

  it('custom statusCode is preserved', async () => {
    const out: any = await execute(
      webhookNode({ statusCode: 201 }),
      { ok: true },
      makeCtx(),
    );
    expect(out.statusCode).toBe(201);
  });

  it('bodyTemplate is interpolated against input', async () => {
    const out: any = await execute(
      webhookNode({ bodyTemplate: 'Hello {{name}}' }),
      { name: 'world' },
      makeCtx(),
    );
    expect(out.body).toBe('Hello world');
  });

  it('body is the raw input when bodyTemplate is not set', async () => {
    const input = { result: 42 };
    const out: any = await execute(webhookNode({}), input, makeCtx());
    expect(out.body).toBe(input);
  });

  it('headers string is interpolated and parsed as JSON', async () => {
    const out: any = await execute(
      webhookNode({ headers: '{"X-Custom":"{{token}}"}' }),
      { token: 'abc123' },
      makeCtx(),
    );
    expect(out.resolvedHeaders?.['X-Custom']).toBe('abc123');
  });

  it('setWebhookResponse callback is called with resolved data', async () => {
    const setWebhookResponse = vi.fn();
    const ctx = makeCtx({ setWebhookResponse });

    await execute(
      webhookNode({ statusCode: 202, bodyTemplate: 'done' }),
      null,
      ctx,
    );

    expect(setWebhookResponse).toHaveBeenCalledOnce();
    const [arg] = setWebhookResponse.mock.calls[0];
    expect(arg.statusCode).toBe(202);
    expect(arg.body).toBe('done');
  });

  it('headers default to empty object when not specified', async () => {
    const out: any = await execute(webhookNode({}), null, makeCtx());
    expect(out.resolvedHeaders).toEqual({});
  });
});
