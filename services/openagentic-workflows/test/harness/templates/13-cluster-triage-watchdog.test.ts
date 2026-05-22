/**
 * cluster-triage-watchdog template — end-to-end harness test.
 *
 * The watchdog packages scheduled platform-health monitoring into a single
 * template that:
 *   - parallel-fans 3 MCP queries (k8s_cluster_health, prometheus_health_summary,
 *     loki_search_errors),
 *   - runs 2 analyst agents (cloud_operations + engineering_metrics),
 *   - synthesizes via prompt_template -> flows_expert agent -> structured_output,
 *   - gates on findings.length > 0 via a `condition` node,
 *   - persists an HTML triage report as an artifact,
 *   - POSTs the proposed_flow.definition to /api/workflows so a real
 *     remediation flow row is created,
 *   - posts a Slack message to #devops with deep-links to both.
 *
 * This test pins the wire-format for the cornerstone case: findings > 0,
 * remediation flow created, slack message contains BOTH the artifact id and
 * the created flow id rendered into URLs.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { prisma } from '../../../src/utils/prisma.js';

const SLACK_WEBHOOK_FAKE = 'https://hooks.slack.com/services/T_HARNESS/B_HARNESS/triage';
const CREATED_FLOW_ID = 'wf-remediation-auto-generated-1';

const REMEDIATION_REPORT = {
  summary: 'openagentic-api in CrashLoopBackOff; 9 Prometheus targets down; Loki returning 401 — observability blind spot.',
  severity: 'P0',
  findings: [
    '[P0] openagentic-api in CrashLoopBackOff (FailedPreStopHook).',
    '[P0] 9 Prometheus scrape targets down + 0 alerts firing.',
    '[P1] Loki returning 401 — observability blind spot.',
  ],
  recommendations: [
    { title: 'Pull --previous logs for api + rollback', priority: 'P0', rationale: 'Identify PreStopHook root cause.' },
    { title: 'Rotate Prometheus / Loki SA token', priority: 'P0', rationale: 'Restore observability.' },
  ],
  proposed_flow: {
    name: 'Remediation: agentic-dev outage',
    description: 'Auto-generated remediation sub-flow.',
    definition: {
      nodes: [
        { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        { id: 'logs', type: 'mcp_tool', data: { toolServer: 'openagentic_kubernetes', toolName: 'k8s_get_pod_logs' } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'logs' }],
    },
  },
};
const REPORT_RAW = JSON.stringify(REMEDIATION_REPORT);

function installMocks(): void {
  // mcp-proxy — three MCP tools with payloads that look unhealthy on purpose.
  harnessServer.use(
    http.post('http://mcp-proxy:8082/call', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_list_unhealthy_pods') {
        return HttpResponse.json({
          success: true,
          namespace: 'agentic-dev',
          unhealthy: [
            { name: 'openagentic-api-x', phase: 'CrashLoopBackOff', reason: 'BackOff', restartCount: 8 },
          ],
        });
      }
      if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_cluster_health') {
        return HttpResponse.json({
          success: true,
          healthy: false,
          nodes: [{ name: 'hal', ready: true }],
          pods: [{ name: 'openagentic-api-x', phase: 'CrashLoopBackOff' }],
          recent_warnings: [
            { namespace: 'agentic-dev', name: 'openagentic-api', reason: 'BackOff', message: 'restart loop' },
          ],
        });
      }
      if (body.server === 'openagentic_prometheus' && body.tool === 'prometheus_health_summary') {
        return HttpResponse.json({
          success: true,
          summary: { up_targets: 18, down_targets: 9, active_alerts: 0 },
        });
      }
      if (body.server === 'openagentic_loki' && body.tool === 'loki_search_errors') {
        return HttpResponse.json({
          success: true,
          errors: [{ ts: '2026-05-15T08:00:00Z', service: 'loki', line: 'ERROR 401 unauthorized' }],
          total: 1,
        });
      }
      return HttpResponse.json({ error: 'unknown' }, { status: 500 });
    }),
  );

  // All analyst + synth + structured_output nodes hit /v1/chat/completions
  // directly (llm_completion + structured_output, no openagentic-proxy / HITL loop).
  // We round-robin a body sequence so each call sees the right brief shape:
  //   1. agent_cloud (cluster brief)
  //   2. agent_metrics (metrics brief)
  //   3. agent_synth (flows_expert JSON envelope)
  //   4. structured_output validator (re-emits the same JSON envelope)
  let llmCall = 0;
  const llmBodies = [
    'Cluster brief: openagentic-api in CrashLoopBackOff. 1 unhealthy pod.',
    'Metrics brief: 9 Prometheus targets down. Loki returning 401.',
    REPORT_RAW,
    REPORT_RAW,
  ];
  harnessServer.use(
    http.post(/\/v1\/chat\/completions$/, () => {
      const body = llmBodies[Math.min(llmCall, llmBodies.length - 1)];
      llmCall += 1;
      return HttpResponse.json({
        id: `chatcmpl-triage-${llmCall}`,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
        model: 'auto',
        usage: { prompt_tokens: 120, completion_tokens: 90, total_tokens: 210 },
      });
    }),
  );

  // api workflows POST — http_request auto-injects internal auth headers
  // for openagentic-api URLs; we intercept the create + assert on the body.
  let capturedCreateBody: Record<string, unknown> | undefined;
  harnessServer.use(
    http.post(/^http:\/\/openagentic-api(:\d+)?\/api\/workflows$/, async ({ request }) => {
      capturedCreateBody = (await request.json()) as Record<string, unknown>;
      // Mirror the actual /api/workflows POST response: { success, workflow:{id,…} }
      return HttpResponse.json({
        success: true,
        workflow: {
          id: CREATED_FLOW_ID,
          name: capturedCreateBody.name,
          description: capturedCreateBody.description,
          created_at: new Date().toISOString(),
        },
      }, { status: 201 });
    }),
  );
  (globalThis as any).__triageCreateBody = () => capturedCreateBody;

  // Slack webhook — capture the message body so we can assert the URL shape.
  let capturedSlack: Record<string, unknown> | undefined;
  harnessServer.use(
    http.post(/hooks\.slack\.com/, async ({ request }) => {
      capturedSlack = (await request.json()) as Record<string, unknown>;
      return HttpResponse.text('ok', { status: 200 });
    }),
  );
  (globalThis as any).__triageSlackBody = () => capturedSlack;
}

describe('cluster-triage-watchdog template (slug 13)', () => {
  beforeAll(() => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    process.env.INTERNAL_SERVICE_SECRET = 'harness-internal-secret';
  });

  beforeEach(() => {
    installMocks();
    vi.mocked((prisma as any).workflowSecret.findFirst).mockReset();
    vi.mocked((prisma as any).workflowSecret.findFirst).mockImplementation(
      async (args: { where?: { name?: string } }) =>
        args?.where?.name === 'SLACK_DEVOPS_WEBHOOK'
          ? {
              id: 'sec-slack-devops-harness',
              name: 'SLACK_DEVOPS_WEBHOOK',
              scope: 'global',
              workflow_id: null,
              encrypted_value: null,
              allowed_node_types: [],
              allowed_users: [],
              allowed_groups: [],
              version: 1,
              access_count: 0,
            }
          : null,
    );
    vi.doMock('../../../src/services/WorkflowSecretService.js', async () => {
      const actual = await vi.importActual<any>(
        '../../../src/services/WorkflowSecretService.js',
      );
      return {
        ...actual,
        workflowSecretService: {
          ...actual.workflowSecretService,
          resolveSecretValue: async (name: string) =>
            name === 'SLACK_DEVOPS_WEBHOOK' ? SLACK_WEBHOOK_FAKE : null,
        },
      };
    });
  });

  afterAll(() => {
    delete (globalThis as any).__triageCreateBody;
    delete (globalThis as any).__triageSlackBody;
  });

  it('detects issues, creates a remediation flow, and notifies #devops with both links', async () => {
    const tpl = loadTemplate('cluster-triage-watchdog');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {
        time_window: '15m',
        namespace: 'agentic-dev',
        min_severity: 'warning',
        api_base: 'http://openagentic-api:3000',
        ui_base: 'https://chat-dev.openagentic.io',
      },
      user: { id: 'harness-watchdog', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    // 1. All three MCP fans fired
    expect(result.outputs.mcp_k8s).toBeDefined();
    expect(result.outputs.mcp_prom).toBeDefined();
    expect(result.outputs.mcp_loki).toBeDefined();

    // 2. Both analyst agents produced briefs
    expect((result.outputs.agent_cloud as { content?: string })?.content).toMatch(/cluster|crashloop|unhealthy/i);
    expect((result.outputs.agent_metrics as { content?: string })?.content).toMatch(/metrics|prometheus|loki/i);

    // 3. Synth pipeline produced the structured envelope
    const structured = result.outputs.structured as { output?: typeof REMEDIATION_REPORT };
    expect(structured?.output?.severity).toBe('P0');
    expect(structured?.output?.findings).toHaveLength(3);
    expect(structured?.output?.proposed_flow?.name).toBe(REMEDIATION_REPORT.proposed_flow.name);

    // 4. Render produced an artifact id
    const renderOut = result.outputs.render_html as { artifactId?: string };
    expect(renderOut?.artifactId).toBeDefined();

    // 5. /api/workflows POST landed with the proposed_flow shape
    const created = (globalThis as any).__triageCreateBody() as { name?: string; definition?: unknown };
    expect(created?.name).toBe(REMEDIATION_REPORT.proposed_flow.name);
    expect(created?.definition).toBeDefined();

    // 6. Slack message contains BOTH deep-links (artifact + created flow)
    const slackBody = (globalThis as any).__triageSlackBody() as { text?: string };
    expect(slackBody?.text).toBeDefined();
    expect(slackBody!.text).toContain(`/artifacts/${renderOut!.artifactId}`);
    expect(slackBody!.text).toContain(`/workflows/${CREATED_FLOW_ID}`);
    // And severity is in the message header
    expect(slackBody!.text).toContain('P0');
  });
});
