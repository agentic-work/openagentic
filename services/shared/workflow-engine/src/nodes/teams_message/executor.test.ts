/**
 * teams_message node — executor tests.
 *
 * Covers:
 *   1. happy path — plain message POSTs { text }
 *   2. cardTitle present → adaptive card payload
 *   3. missing webhookUrl + no env → throws
 *   4. TEAMS_WEBHOOK_URL env fallback works
 *   5. message templated against input
 *   6. abort signal forwarded
 *   7. 200 sent === true
 *   8. 202 also counts as sent === true
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
    executionId: 'exec-teams-1',
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

const teamsNode = (data: Record<string, unknown>) => ({
  id: 'n_teams',
  type: 'teams_message',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEAMS_WEBHOOK_URL;
});

afterEach(() => {
  delete process.env.TEAMS_WEBHOOK_URL;
});

describe('teams_message/executor', () => {
  it('plain message — POSTs { text }', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    const out: any = await execute(
      teamsNode({ webhookUrl: 'https://outlook.office.com/webhook/x', message: 'hello' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.text).toBe('hello');
    expect(sent.attachments).toBeUndefined();
  });

  it('cardTitle present → adaptive card payload', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      teamsNode({
        webhookUrl: 'https://outlook.office.com/webhook/x',
        cardTitle: 'Alert',
        cardBody: 'Body text',
      }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.type).toBe('message');
    expect(sent.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(sent.attachments[0].content.body[0].text).toBe('Alert');
    expect(sent.attachments[0].content.body[1].text).toBe('Body text');
  });

  it('throws when webhookUrl missing and no TEAMS_WEBHOOK_URL env', async () => {
    await expect(
      execute(teamsNode({ message: 'hi' }), null, makeCtx()),
    ).rejects.toThrow(/webhook url/i);
  });

  it('falls back to TEAMS_WEBHOOK_URL env', async () => {
    process.env.TEAMS_WEBHOOK_URL = 'https://outlook.office.com/webhook/env';
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(teamsNode({ message: 'hi' }), null, makeCtx());
    expect(postSpy.mock.calls[0][0]).toBe('https://outlook.office.com/webhook/env');
  });

  it('templates message against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      teamsNode({ webhookUrl: 'https://x', message: 'severity: {{level}}' }),
      { level: 'warn' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.text).toBe('severity: warn');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    await execute(
      teamsNode({ webhookUrl: 'https://x', message: 'hi' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('202 — sent: true', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    const out: any = await execute(
      teamsNode({ webhookUrl: 'https://x', message: 'hi' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
  });

  it('runWithAssertions: 500 fails the sent_ok assertion', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: 'boom',
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = teamsNode({ webhookUrl: 'https://x', message: 'hi' });
    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
