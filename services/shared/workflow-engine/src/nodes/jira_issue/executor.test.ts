/**
 * jira_issue node — executor tests.
 *
 * Covers:
 *   1. happy path — creates issue, returns key/id on 201
 *   2. missing JIRA_BASE_URL env → throws
 *   3. missing JIRA_EMAIL or JIRA_API_TOKEN → throws
 *   4. missing projectKey on node → throws (required field)
 *   5. summary + description templated against input
 *   6. description wrapped into ADF (atlassian doc format)
 *   7. assignee passed through with templating
 *   8. action=update → throws (not yet implemented)
 *   9. abort signal forwarded
 *  10. outputAssertion: 201 passes; 400 fails
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
    executionId: 'exec-jira-1',
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

const jiraNode = (data: Record<string, unknown>) => ({
  id: 'n_jira',
  type: 'jira_issue',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
  process.env.JIRA_EMAIL = 'me@example.com';
  process.env.JIRA_API_TOKEN = 'tok';
});

afterEach(() => {
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

describe('jira_issue/executor', () => {
  it('happy path — creates issue, returns key+id on 201', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'PROJ-123', id: '10001' },
    } as any);

    const out: any = await execute(
      jiraNode({
        projectKey: 'PROJ',
        summary: 'Bug: thing broken',
        description: 'More detail.',
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe(201);
    expect(out.created).toBe(true);
    expect(out.key).toBe('PROJ-123');
    expect(out.id).toBe('10001');

    expect(postSpy.mock.calls[0][0]).toBe(
      'https://example.atlassian.net/rest/api/3/issue',
    );
  });

  it('throws when JIRA_BASE_URL env missing', async () => {
    delete process.env.JIRA_BASE_URL;
    await expect(
      execute(jiraNode({ projectKey: 'PROJ', summary: 's' }), null, makeCtx()),
    ).rejects.toThrow(/JIRA_BASE_URL/i);
  });

  it('throws when JIRA_EMAIL or JIRA_API_TOKEN missing', async () => {
    delete process.env.JIRA_API_TOKEN;
    await expect(
      execute(jiraNode({ projectKey: 'PROJ', summary: 's' }), null, makeCtx()),
    ).rejects.toThrow(/JIRA_EMAIL.*JIRA_API_TOKEN|JIRA_API_TOKEN/i);
  });

  it('throws when projectKey is missing', async () => {
    await expect(
      execute(jiraNode({ summary: 'hi' }), null, makeCtx()),
    ).rejects.toThrow(/project key/i);
  });

  it('templates summary, description, projectKey against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'P-1', id: '1' },
    } as any);

    await execute(
      jiraNode({
        projectKey: '{{proj}}',
        summary: 'Issue {{n}}',
        description: 'Details {{n}}',
      }),
      { proj: 'OPS', n: 7 },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.fields.project.key).toBe('OPS');
    expect(sent.fields.summary).toBe('Issue 7');
    // ADF doc format with description text
    expect(sent.fields.description.type).toBe('doc');
    expect(sent.fields.description.content[0].content[0].text).toBe('Details 7');
  });

  it('description omitted when empty (no ADF wrapper)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'P-1', id: '1' },
    } as any);

    await execute(
      jiraNode({ projectKey: 'P', summary: 's' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.fields.description).toBeUndefined();
  });

  it('assignee passed through with templating', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'P-1', id: '1' },
    } as any);

    await execute(
      jiraNode({
        projectKey: 'P',
        summary: 's',
        assignee: '{{user}}',
      }),
      { user: 'acct-123' },
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.fields.assignee).toEqual({ accountId: 'acct-123' });
  });

  it('action=update → throws not yet implemented', async () => {
    await expect(
      execute(
        jiraNode({ action: 'update', projectKey: 'P', summary: 's' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/not yet implemented|update/i);
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'P-1', id: '1' },
    } as any);

    await execute(
      jiraNode({ projectKey: 'P', summary: 's' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('runWithAssertions: 201 passes; 400 fails', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { key: 'K', id: 'I' },
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = jiraNode({ projectKey: 'P', summary: 's' });
    const out: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(out.status).toBe(201);

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 400,
      data: { errors: { summary: 'required' } },
    } as any);
    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
