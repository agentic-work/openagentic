/**
 * jira_issue node — Phase E1 primitive contract.
 *
 * Public contract: creates a Jira issue via POST to
 * `${JIRA_BASE_URL}/rest/api/3/issue` with HTTP Basic auth from
 * `JIRA_EMAIL:JIRA_API_TOKEN`. Returns `{ status, created, key, id }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('jira_issue node — REST API v3 issue create', () => {
  it('posts an ADF-wrapped issue payload and reports created:true', async () => {
    process.env.JIRA_BASE_URL = 'https://acme.atlassian.net';
    process.env.JIRA_EMAIL = 'bot@acme.example';
    process.env.JIRA_API_TOKEN = 'token-xyz';

    let receivedBody: any;
    let receivedAuth: string | null = null;
    harnessServer.use(
      http.post('https://acme.atlassian.net/rest/api/3/issue', async ({ request }) => {
        receivedBody = await request.json();
        receivedAuth = request.headers.get('authorization');
        return HttpResponse.json({ id: '10042', key: 'OPS-42' }, { status: 201 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'jira',
            type: 'jira_issue',
            data: {
              action: 'create',
              projectKey: 'OPS',
              issueType: 'Bug',
              summary: 'Build failed: {{input.runId}}',
              description: 'Run {{input.runId}} on branch {{input.branch}} broke main.',
              priority: 'High',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'jira' }],
      },
      input: { runId: 'wf-99', branch: 'feat/x' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.jira as {
      status: number;
      created: boolean;
      key: string;
      id: string;
    };
    expect(out.created).toBe(true);
    expect(out.status).toBe(201);
    expect(out.key).toBe('OPS-42');
    expect(out.id).toBe('10042');
    expect(receivedBody?.fields?.project?.key).toBe('OPS');
    expect(receivedBody?.fields?.summary).toBe('Build failed: wf-99');
    expect(receivedBody?.fields?.priority?.name).toBe('High');
    // ADF wrapper
    expect(receivedBody?.fields?.description?.type).toBe('doc');
    expect(receivedAuth).toMatch(/^Basic /);
  });
});
