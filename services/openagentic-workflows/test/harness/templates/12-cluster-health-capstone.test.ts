/**
 * cluster-health-capstone template — end-to-end harness test.
 *
 * The capstone packages everything wired today into a single
 * permanent template: 3 live MCP queries (k8s_cluster_health,
 * prometheus_health_summary, loki_search_errors) fanned out in
 * parallel, 1 REST data_source_query for an external health probe,
 * 3 specialist agents (cloud_operations + engineering_metrics +
 * flows_expert), prompt_template -> structured_output to produce
 * {summary, findings, recommendations, proposed_flow}, an HTML
 * artifact persisted to the Artifacts library, and a switch node
 * routing the digest to one of {slack_message, send_email,
 * teams_message} based on trigger.notification_target.
 *
 * This test runs the template three times with each
 * notification_target value to prove the switch routing — every
 * other path is exercised identically in all three runs.
 *
 * Mocks layer:
 *   - mcp-proxy /call: returns plausible payloads for all 3 MCP
 *     tools so the engine's mcp_tool executor unwraps cleanly.
 *   - /api/data-sources/:id/query: returns a minimal { rows, rowCount,
 *     columns } REST query result.
 *   - /v1/chat/completions: returns the 4 LLM completions in order
 *     (cloud_operations brief, engineering_metrics brief, flows_expert
 *     synthesis emitting the JSON envelope, structured_output validator
 *     extracting that envelope).
 *   - Slack/Teams webhooks: HTTP 200 acks; send_email mock acks.
 *
 * Assertions:
 *   - Top-level execution completes for every notification_target.
 *   - All 4 fetch nodes produced output.
 *   - Both analyst agents produced output.
 *   - structured.output has summary/findings/recommendations/proposed_flow.
 *   - render_html produced { body, artifactId }.
 *   - Only the matching notify_* node ran; the other two were skipped.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { prisma } from '../../../src/utils/prisma.js';

const SLACK_WEBHOOK_FAKE = 'https://hooks.slack.com/services/T_HARNESS/B_HARNESS/cluster-health';

const FLOWS_EXPERT_REPORT = {
  summary: 'agentic-dev is in a multi-front degraded state — api in CrashLoopBackOff, ui in ImagePullBackOff, 9 Prometheus targets down, observability stack returning 401.',
  findings: [
    '[P0] openagentic-api in CrashLoopBackOff (FailedPreStopHook).',
    '[P0] openagentic-ui ImagePullBackOff for tag 0.7.1-07daee05.',
    '[P0] 9 Prometheus scrape targets down + 0 alerts firing.',
    '[P1] Loki returning 401 — observability blind spot.',
  ],
  recommendations: [
    { title: 'Pull --previous logs for api + rollback', priority: 'P0', rationale: 'Identify PreStopHook root cause.' },
    { title: 'Refresh imagePullSecret + rollout ui', priority: 'P0', rationale: 'Tag may be missing or secret expired.' },
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

const FLOWS_EXPERT_RAW = JSON.stringify(FLOWS_EXPERT_REPORT);

function installMocks(): void {
  // mcp-proxy: 3 MCP tools — plausible payloads matching live shape.
  harnessServer.use(
    http.post('http://mcp-proxy:8082/call', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_cluster_health') {
        return HttpResponse.json({
          success: true,
          healthy: false,
          nodes: [{ name: 'hal', ready: true }],
          namespaces: ['agentic-dev'],
          pods: [{ name: 'api-x', phase: 'Running' }],
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
          errors: [{ ts: '2026-05-14T19:00:00Z', service: 'api', line: 'ERROR Connection refused' }],
          total: 1,
        });
      }
      return HttpResponse.json(
        { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
        { status: 200 },
      );
    }),
  );

  // data_source_query: REST query against the configured data source.
  harnessServer.use(
    http.post(/\/api\/data-sources\/[^/]+\/query$/, () =>
      HttpResponse.json({
        success: true,
        rows: [{ body: '' }],
        columns: ['body'],
        rowCount: 1,
        executionTimeMs: 12,
      }),
    ),
  );

  // openagentic-proxy execute-sync — the 3 agent_single nodes (cloud_operations,
  // engineering_metrics, flows_expert) route through this. The mock returns
  // role-specific content so each agent's downstream consumer (prompt_template,
  // structured_output) sees the right shape.
  const briefByRole: Record<string, string> = {
    cloud_operations: 'Cluster brief: 1 unhealthy pod (openagentic-api in BackOff). 8 cluster nodes Ready.',
    engineering_metrics: 'Metrics brief: 9 prometheus targets down, 0 active alerts firing — alerting pipeline gap.',
    flows_expert: FLOWS_EXPERT_RAW,
  };
  harnessServer.use(
    http.post('http://openagentic-proxy:3300/api/agents/execute-sync', async ({ request }) => {
      const body = (await request.json()) as { agents?: Array<{ role?: string }> };
      const role = body.agents?.[0]?.role ?? 'cloud_operations';
      const content = briefByRole[role] ?? `harness-stub brief for ${role}`;
      return HttpResponse.json({
        status: 'completed',
        output: content,
        results: [{ agentId: `agent-${role}`, role, status: 'completed', content }],
        metrics: { totalTokens: 180 },
      });
    }),
  );

  // structured_output calls /v1/chat/completions directly (NOT openagentic-proxy)
  // to extract + re-validate the FLOWS_EXPERT_RAW JSON envelope.
  harnessServer.use(
    http.post(/\/v1\/chat\/completions$/, () =>
      HttpResponse.json({
        id: 'chatcmpl-harness-structured',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: FLOWS_EXPERT_RAW }, finish_reason: 'stop' }],
        model: 'auto',
        usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
      }),
    ),
  );

  // Slack incoming webhook — accept any hooks.slack.com or pre-resolved
  // workspace webhook URL. openagentic-mcp-proxy is the dev pattern.
  harnessServer.use(
    http.post(/hooks\.slack\.com|slack/, () =>
      HttpResponse.text('ok', { status: 200 }),
    ),
  );

  // Teams incoming webhook — accept any office.com workflows URL.
  harnessServer.use(
    http.post(/office\.com|webhook\.office/, () =>
      HttpResponse.text('1', { status: 200 }),
    ),
  );

  // send_email mock — the executor uses nodemailer; the harness's
  // global SMTP stub is wired in test/harness/setup.ts. Nothing to mock
  // at MSW level for SMTP.
}

const VARIANTS: Array<{ target: 'slack' | 'email' | 'teams'; expected: string; skipped: string[] }> = [
  { target: 'slack', expected: 'notify_slack', skipped: ['notify_email', 'notify_teams'] },
  { target: 'email', expected: 'notify_email', skipped: ['notify_slack', 'notify_teams'] },
  { target: 'teams', expected: 'notify_teams', skipped: ['notify_slack', 'notify_email'] },
];

const sentMails: Array<Record<string, unknown>> = [];

describe('cluster-health-capstone template (slug 12)', () => {
  beforeAll(() => {
    // notify_email branch — wire the _mailer globalThis hook + SMTP env so
    // send_email node passes its "is SMTP configured" gate and dispatches
    // to the stub instead of failing with "No SMTP configuration found."
    (globalThis as any).__openagenticMailerStub = {
      sendMail: async (mail: Record<string, unknown>) => {
        sentMails.push(mail);
        return { messageId: 'harness-capstone-msg' };
      },
    };
    process.env.SMTP_HOST = 'smtp.harness.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'noreply@openagentic.io';
    process.env.SMTP_PASS = 'test-pass';
  });
  afterAll(() => {
    delete (globalThis as any).__openagenticMailerStub;
  });

  beforeEach(() => {
    sentMails.length = 0;
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    installMocks();

    // Stub the SLACK_DEVOPS_WEBHOOK secret resolution — the template
    // references it via {{secret:SLACK_DEVOPS_WEBHOOK}} but no DB is
    // attached in the harness. Mirror the credential-integration test
    // pattern: feed findFirst a row + mock resolveSecretValue.
    vi.mocked((prisma as any).workflowSecret.findFirst).mockReset();
    vi.mocked((prisma as any).workflowSecret.findFirst).mockImplementation(
      async (args: { where?: { name?: string } }) => {
        const known = ['SLACK_DEVOPS_WEBHOOK', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
        if (!known.includes(args?.where?.name as string)) return null;
        return {
          id: `sec-${args!.where!.name}-harness`,
          name: args!.where!.name,
          scope: 'global',
          workflow_id: null,
          encrypted_value: null,
          allowed_node_types: [],
          allowed_users: [],
          allowed_groups: [],
          version: 1,
          access_count: 0,
        };
      },
    );
    vi.doMock('../../../src/services/WorkflowSecretService.js', async () => {
      const actual = await vi.importActual<any>(
        '../../../src/services/WorkflowSecretService.js',
      );
      return {
        ...actual,
        workflowSecretService: {
          ...actual.workflowSecretService,
          resolveSecretValue: async (name: string) => {
            if (name === 'SLACK_DEVOPS_WEBHOOK') return SLACK_WEBHOOK_FAKE;
            if (name === 'SMTP_HOST') return 'smtp.harness.test';
            if (name === 'SMTP_PORT') return '587';
            if (name === 'SMTP_USER') return 'noreply@openagentic.io';
            if (name === 'SMTP_PASS') return 'harness-smtp-pass';
            return null;
          },
        },
      };
    });
  });

  for (const v of VARIANTS) {
    it(`routes notification to ${v.target} via switch + ${v.expected}`, async () => {
      const tpl = loadTemplate('cluster-health-capstone');
      const result = await runFlow({
        flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
        input: {
          time_window: '15m',
          namespace: 'agentic-dev',
          min_severity: 'warning',
          notification_target: v.target,
          notification_email_to: 'test@openagentic.io',
          notification_teams_webhook: 'https://outlook.office.com/webhook/fake',
          data_source_id: 'a7e40df7-a465-4856-b3ab-74f8ba88fff5',
          data_source_query_path: '/status/200',
        },
        user: { id: 'harness', accessToken: 'eyJ.fake.harness.jwt' },
      });

      // 1. Top-level
      expect(result.status).toBe('completed');

      // 2. All fetch nodes produced output
      expect(result.outputs.mcp_k8s).toBeDefined();
      expect(result.outputs.mcp_prom).toBeDefined();
      expect(result.outputs.mcp_loki).toBeDefined();
      expect(result.outputs.healthcheck).toBeDefined();
      expect((result.outputs.healthcheck as { rowCount?: number }).rowCount).toBe(1);

      // 3. Both analyst agents produced content
      expect((result.outputs.agent_cloud as { content?: string }).content).toMatch(/cluster|brief|unhealthy/i);
      expect((result.outputs.agent_metrics as { content?: string }).content).toMatch(/metrics|prometheus|alerts/i);

      // 4. prompt_template + flows_expert + structured_output emitted the JSON envelope
      expect((result.outputs.synth_prompt as { messages?: unknown[] }).messages).toBeDefined();
      const structured = result.outputs.structured as { output?: typeof FLOWS_EXPERT_REPORT };
      expect(structured?.output?.summary).toBe(FLOWS_EXPERT_REPORT.summary);
      expect(structured?.output?.findings).toHaveLength(4);
      expect(structured?.output?.recommendations).toHaveLength(3);
      expect(structured?.output?.proposed_flow?.name).toBe(FLOWS_EXPERT_REPORT.proposed_flow.name);

      // 5. webhook_response persisted as artifact
      const renderOut = result.outputs.render_html as { artifactId?: string; body?: string };
      expect(renderOut.artifactId).toBeDefined();
      expect(renderOut.body).toContain(FLOWS_EXPERT_REPORT.summary);

      // 6. Switch routed to ONLY the matching notify node
      expect(result.outputs[v.expected]).toBeDefined();
      for (const skip of v.skipped) {
        expect(result.outputs[skip]).toBeUndefined();
      }
    });
  }
});
