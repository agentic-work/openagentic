/**
 * discord_message node — executor tests.
 *
 * Covers:
 *   1. happy path — POSTs { content, username } and returns sent: true (204)
 *   2. 200 also counts as sent: true
 *   3. missing webhookUrl → throws
 *   4. content + username default 'OpenAgentic'
 *   5. embeds passed through when provided
 *   6. content templated against input
 *   7. abort signal forwarded
 *   8. outputAssertion: 500 fails sent_ok
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    executionId: 'exec-discord-1',
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

const discordNode = (data: Record<string, unknown>) => ({
  id: 'n_discord',
  type: 'discord_message',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('discord_message/executor', () => {
  it('happy path — 204 → sent: true', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 204,
      data: '',
    } as any);

    const out: any = await execute(
      discordNode({ webhookUrl: 'https://discord.com/api/webhooks/x', content: 'hi' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
    expect(out.status).toBe(204);

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('hi');
    expect(sent.username).toBe('OpenAgentic');
  });

  it('200 — sent: true', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {},
    } as any);

    const out: any = await execute(
      discordNode({ webhookUrl: 'https://discord.com/api/webhooks/x', content: 'hi' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
  });

  it('throws when webhookUrl missing', async () => {
    await expect(
      execute(discordNode({ content: 'hi' }), null, makeCtx()),
    ).rejects.toThrow(/webhook url/i);
  });

  it('uses provided username override', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 204,
      data: '',
    } as any);

    await execute(
      discordNode({ webhookUrl: 'https://x', content: 'hi', username: 'Custom' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.username).toBe('Custom');
  });

  it('embeds passed through when provided', async () => {
    const embeds = [{ title: 'Embed', color: 0xff0000 }];
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 204,
      data: '',
    } as any);

    await execute(
      discordNode({ webhookUrl: 'https://x', content: 'hi', embeds }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.embeds).toEqual(embeds);
  });

  it('templates content against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 204,
      data: '',
    } as any);

    await execute(
      discordNode({ webhookUrl: 'https://x', content: 'level: {{lvl}}' }),
      { lvl: 'high' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.content).toBe('level: high');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 204,
      data: '',
    } as any);

    await execute(
      discordNode({ webhookUrl: 'https://x', content: 'hi' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('runWithAssertions: 500 fails the sent_ok assertion', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: '',
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = discordNode({ webhookUrl: 'https://x', content: 'hi' });
    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
