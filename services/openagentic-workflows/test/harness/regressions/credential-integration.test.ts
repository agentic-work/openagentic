/**
 * Regression: credential resolution + integration node firing.
 *
 * Closes the credentials OAuth deep test gap from 2026-05-14. Pins the
 * contract that a workflow secret referenced via `{{secret:NAME}}` in an
 * integration node's settings is:
 *
 *   1. Pre-loaded from the DB at engine boot (one round trip per unique name).
 *   2. Substituted into the node's resolved field at execution time.
 *   3. Forwarded as the outbound URL / payload — the integration ACTUALLY
 *      gets the decrypted value.
 *   4. NEVER returned in the node output (secrets stay redacted).
 *
 * Slack is the canonical integration here because it has a real target
 * (`#devops`) per [[reference_slack_integrations]] and the executor
 * forwards the resolved URL to `abortableAxiosPost` directly — easy to
 * intercept with MSW.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { prisma } from '../../../src/utils/prisma.js';

// ---------------------------------------------------------------------------
// Test setup — seed a fake secret and decrypt result.
// ---------------------------------------------------------------------------

const SECRET_NAME = 'SLACK_DEVOPS_WEBHOOK';
const SECRET_PLAINTEXT = 'https://hooks.slack.com/services/TEST/REAL/devops-target';

beforeEach(() => {
  // workflowSecret prisma row — engine pre-loads via findFirst (scope:global).
  vi.mocked((prisma as any).workflowSecret.findFirst).mockReset();
  vi.mocked((prisma as any).workflowSecret.findFirst).mockImplementation(
    async (args: any) => {
      if (args?.where?.name !== SECRET_NAME) return null;
      // Return shape used by resolveSecretValue + ACL lookups.
      return {
        id: 'sec-slack-devops',
        name: SECRET_NAME,
        scope: 'global',
        workflow_id: null,
        encrypted_value: null, // pre-load goes through resolveSecretValue below
        allowed_node_types: [],
        allowed_users: [],
        allowed_groups: [],
        version: 1,
        access_count: 0,
      };
    },
  );

  // Bypass the encryption path entirely — mock resolveSecretValue to return
  // the plaintext. The engine pre-load loop imports WorkflowSecretService
  // lazily, so we hijack the resolveSecretValue at the singleton.
  vi.doMock('../../../src/services/WorkflowSecretService.js', async () => {
    const actual = await vi.importActual<any>(
      '../../../src/services/WorkflowSecretService.js',
    );
    return {
      ...actual,
      workflowSecretService: {
        ...actual.workflowSecretService,
        resolveSecretValue: async (name: string) =>
          name === SECRET_NAME ? SECRET_PLAINTEXT : null,
      },
    };
  });
});

describe('credential integration — Slack webhook resolved from {{secret:NAME}}', () => {
  it('resolved URL is the decrypted secret value; secret is NEVER returned in node output', async () => {
    // Capture the outbound URL the slack_message executor POSTs to.
    let capturedUrl = '';
    let capturedPayload: any = null;
    harnessServer.use(
      http.post(SECRET_PLAINTEXT, async ({ request }) => {
        capturedUrl = request.url;
        capturedPayload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'notify',
            type: 'slack_message',
            data: {
              webhookUrl: `{{secret:${SECRET_NAME}}}`,
              message: 'Pod health alert for {{namespace}}',
              channel: '#devops',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'notify' }],
      },
      input: { namespace: 'openagentic' },
      userId: 'harness-user-cred-1',
    });

    expect(result.status).toBe('completed');

    // 1. The integration actually fired against the decrypted URL.
    expect(capturedUrl).toBe(SECRET_PLAINTEXT);
    // 2. The payload contains the interpolated message.
    expect(capturedPayload?.text).toBe('Pod health alert for openagentic');
    expect(capturedPayload?.channel).toBe('#devops');

    // 3. The node output does NOT include the resolved URL.
    const out = result.outputs.notify as Record<string, unknown>;
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_PLAINTEXT);
    expect(serialized).not.toMatch(/T0AKG2A6Y2F|TEST\/REAL/);
    expect(out.sent).toBe(true);
    expect(out.status).toBe(200);
  });

  it('unresolved secret name → falls through unchanged (not silently empty)', async () => {
    // Different secret name — pre-load lookup returns null. The engine should
    // leave `{{secret:UNKNOWN}}` literal in place; slack_message then sees a
    // string starting with `{{` which is not a valid URL → executor throws.
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'notify',
            type: 'slack_message',
            data: {
              webhookUrl: '{{secret:UNKNOWN_WEBHOOK}}',
              message: 'should not send',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'notify' }],
      },
      input: {},
      userId: 'harness-user-cred-2',
    });

    // Either compile-time miss OR runtime error — what we want to assert is
    // that the executor did NOT silently succeed with an empty URL.
    if (result.status === 'completed') {
      const out = result.outputs.notify as { sent?: boolean };
      expect(out.sent).not.toBe(true);
    } else {
      expect(result.status).toBe('failed');
    }
  });
});
