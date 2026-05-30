/**
 * slack_message node — executor tests.
 *
 * Covers:
 *   1. happy path — POSTs to webhook, returns sent: true
 *   2. missing webhookUrl + no env fallback → throws
 *   3. SLACK_WEBHOOK_URL env fallback works
 *   4. message + channel templated against input
 *   5. blocks pass through when provided
 *   6. abort signal forwarded
 *   7. non-200 → sent: false (assertion fails)
 *   8. outputAssertion: sent === true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-slack-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const slackNode = (data: Record<string, unknown>) => ({
  id: 'n_slack',
  type: 'slack_message',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SLACK_WEBHOOK_URL;
});

afterEach(() => {
  delete process.env.SLACK_WEBHOOK_URL;
});

describe('slack_message/executor', () => {
  it('happy path — POSTs payload and returns { sent: true, status: 200 }', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
    } as any);

    const out: any = await execute(
      slackNode({ webhookUrl: 'https://hooks.slack.com/foo', message: 'hello' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
    expect(out.status).toBe(200);
    const sentPayload = postSpy.mock.calls[0][1] as any;
    expect(sentPayload.text).toBe('hello');
  });

  it('throws when webhookUrl missing and no SLACK_WEBHOOK_URL env', async () => {
    await expect(
      execute(slackNode({ message: 'hi' }), null, makeCtx()),
    ).rejects.toThrow(/webhook url/i);
  });

  it('falls back to SLACK_WEBHOOK_URL env when webhookUrl is unset', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/env';
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(slackNode({ message: 'hi' }), null, makeCtx());
    expect(postSpy.mock.calls[0][0]).toBe('https://hooks.slack.com/env');
  });

  it('templates message and channel against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      slackNode({
        webhookUrl: 'https://hooks.slack.com/x',
        message: 'Alert: {{level}}',
        channel: '#{{room}}',
      }),
      { level: 'critical', room: 'incidents' },
      makeCtx(),
    );

    const sentPayload = postSpy.mock.calls[0][1] as any;
    expect(sentPayload.text).toBe('Alert: critical');
    expect(sentPayload.channel).toBe('#incidents');
  });

  it('passes blocks through when provided', async () => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      slackNode({
        webhookUrl: 'https://hooks.slack.com/x',
        message: 'hi',
        blocks,
      }),
      null,
      makeCtx(),
    );

    const sentPayload = postSpy.mock.calls[0][1] as any;
    expect(sentPayload.blocks).toEqual(blocks);
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      slackNode({ webhookUrl: 'https://hooks.slack.com/x', message: 'hi' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('non-200 — returns sent: false', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: 'boom',
    } as any);

    const out: any = await execute(
      slackNode({ webhookUrl: 'https://hooks.slack.com/x', message: 'hi' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(false);
    expect(out.status).toBe(500);
  });

  it('runWithAssertions: 500 fails the sent_ok assertion', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: 'boom',
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = slackNode({ webhookUrl: 'https://hooks.slack.com/x', message: 'hi' });

    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
