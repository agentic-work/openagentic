/**
 * k8s-deployment-rollout-status-report template — end-to-end harness test.
 *
 * AIOps template 5 of 10 (2026-05-13). Goal: enumerate deployments in a
 * namespace via the live openagentic_kubernetes.k8s_list_deployments MCP, classify
 * each one as healthy / rolling-out / stuck / scaled-zero based on the
 * replicas-vs-ready_replicas-vs-available_replicas triple, filter the
 * non-healthy subset sorted by severity, ask the platform LLM for a
 * 2-3 bullet operator narrative focused on the most concerning rollout
 * situations, strip CoT preamble, render an HTML rollout status report
 * via webhook_response. Empty-case (all deployments healthy — the
 * operational default in stable dev clusters) is the common path and
 * MUST render a sensible "All N deployments healthy" page.
 *
 * Real-data discipline:
 *   - fixtures/k8s_list_deployments-real.json captures the canonical
 *     3-layer proxy/jsonrpc/mcp envelope wrapping the python tool's
 *     native dict (server.py k8s_list_deployments lines 436-470). Three
 *     deployments: 1 healthy (api replicas=ready=available=1) + 1
 *     mid-rollout (workflows replicas=3, ready=1, available=1) + 1
 *     stuck (oap-azure-mcp replicas=2, ready=0, available=0). Exercises
 *     the analyze transform's three-way classification.
 *   - fixtures/k8s_list_deployments-healthy.json captures the all-healthy
 *     default — 3 deployments all ready=available=replicas. Empty-case.
 *   - mockChatCompletions returns a CoT-leading 2-3 bullet narrative;
 *     the clean_narrative transform strips the preamble.
 *
 * Per-node assertions:
 *   - deployments: real-shape native dict with deployments[] + count
 *   - analyze: per-deployment classification (healthy/rolling-out/stuck);
 *     adds ready/desired/unavailable counts for the report
 *   - unhealthy: filtered subset sorted by severity desc (stuck first)
 *   - narrative: raw LLM output (CoT preamble allowed)
 *   - clean_narrative: clean_content starts with a bullet, no CoT
 *   - report: webhook_response HTML body — table of deployment statuses
 *     + cleaned narrative; no unresolved {{...}} tokens; CoT absent
 *
 * Empty-case assertions (second `it` block):
 *   - deployments.count === 3 (all healthy)
 *   - analyze.classified all status === 'healthy'
 *   - unhealthy.unhealthy === []
 *   - report HTML says "all N deployments healthy" (no blank table)
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realListDeploymentsResponse from '../fixtures/k8s_list_deployments-real.json' assert { type: 'json' };
import healthyListDeploymentsResponse from '../fixtures/k8s_list_deployments-healthy.json' assert { type: 'json' };

describe('k8s-deployment-rollout-status-report template', () => {
  it('runs end-to-end with mixed-health deployments and renders an HTML rollout status report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let listDeploymentsCallReceived = false;
    let listDeploymentsNamespace: string | null = null;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_kubernetes' &&
          body.tool === 'k8s_list_deployments'
        ) {
          listDeploymentsCallReceived = true;
          const args = body.arguments as Record<string, unknown>;
          listDeploymentsNamespace =
            typeof args?.namespace === 'string' ? args.namespace : null;
          return HttpResponse.json(realListDeploymentsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    // LLM mock — CoT preamble + 2-3 bullet operator narrative. The
    // downstream clean_narrative stripper must remove the preamble so
    // the rendered HTML contains ONLY the bullets. Deployment names
    // mentioned are the two real unhealthy deployments from the fixture.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize the most concerning rollout situations. Let me think:\n' +
        '- oap-openagentic-azure-mcp (stuck) — replicas=2 but ready=0 and available=0; pods likely failing to schedule or the image pull is failing. Check pod events with kubectl describe and verify the harbor.openagentic.io image tag exists.\n' +
        '- openagentic-workflows (rolling-out) — replicas=3 but only 1 ready/available; rollout in progress or a new revision is partially healthy. Watch for the remaining 2 pods over the next few minutes; if they stay unready, suspect a regression in the new image.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 240, completion_tokens: 130 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('k8s-deployment-rollout-status-report');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + MCP call fired with correct namespace.
    expect(result.status).toBe('completed');
    expect(listDeploymentsCallReceived).toBe(true);
    expect(listDeploymentsNamespace).toBe('agentic-dev');

    // 2. deployments node — real-shape native dict. 3-layer unwrap
    //    surfaces the dict verbatim (no content[].text joining since the
    //    python tool emits a native dict).
    const deploymentsOut = result.outputs.deployments as {
      success?: boolean;
      deployments?: Array<Record<string, unknown>>;
      count?: number;
      namespace?: string;
    };
    expect(deploymentsOut).toBeDefined();
    expect(deploymentsOut.success).toBe(true);
    expect(Array.isArray(deploymentsOut.deployments)).toBe(true);
    expect(deploymentsOut.count).toBe(3);
    expect(deploymentsOut.namespace).toBe('agentic-dev');

    // 3. analyze node — per-deployment classification. Each entry has
    //    name, namespace, ready, desired, available, unavailable, status,
    //    created. Three entries total: 1 healthy + 1 rolling-out + 1 stuck.
    const analyzeOut = result.outputs.analyze as {
      classified?: Array<Record<string, unknown>>;
      namespace_label?: string;
      total_count?: number;
      healthy_count?: number;
      unhealthy_count?: number;
    };
    expect(analyzeOut).toBeDefined();
    expect(Array.isArray(analyzeOut.classified)).toBe(true);
    expect(analyzeOut.classified?.length).toBe(3);
    expect(analyzeOut.namespace_label).toBe('agentic-dev');
    expect(analyzeOut.total_count).toBe(3);
    expect(analyzeOut.healthy_count).toBe(1);
    expect(analyzeOut.unhealthy_count).toBe(2);
    // Status classification check — find each by name.
    const classified = analyzeOut.classified || [];
    const apiDep = classified.find((d) => d.name === 'openagentic-api');
    const workflowsDep = classified.find((d) => d.name === 'openagentic-workflows');
    const azureDep = classified.find((d) => d.name === 'oap-openagentic-azure-mcp');
    expect(apiDep).toBeDefined();
    expect(workflowsDep).toBeDefined();
    expect(azureDep).toBeDefined();
    expect(String(apiDep?.status)).toBe('healthy');
    expect(String(workflowsDep?.status)).toBe('rolling-out');
    expect(String(azureDep?.status)).toBe('stuck');
    // Replica counts surfaced for the report rendering.
    expect(workflowsDep?.ready).toBe(1);
    expect(workflowsDep?.desired).toBe(3);
    expect(azureDep?.ready).toBe(0);
    expect(azureDep?.desired).toBe(2);

    // 4. unhealthy node — filtered subset, sorted by severity desc
    //    (stuck > rolling-out > scaled-zero). Two entries total: stuck
    //    azure-mcp first, then rolling-out workflows.
    const unhealthyOut = result.outputs.unhealthy as {
      unhealthy?: Array<Record<string, unknown>>;
    };
    expect(unhealthyOut).toBeDefined();
    expect(Array.isArray(unhealthyOut.unhealthy)).toBe(true);
    expect(unhealthyOut.unhealthy?.length).toBe(2);
    const firstUnhealthy = (unhealthyOut.unhealthy?.[0] || {}) as Record<string, unknown>;
    expect(String(firstUnhealthy.name)).toBe('oap-openagentic-azure-mcp');
    expect(String(firstUnhealthy.status)).toBe('stuck');

    // 5. narrative node — raw LLM output captured. CoT preamble IS
    //    allowed because clean_narrative strips it.
    const narrativeOut = result.outputs.narrative as { content?: string };
    expect(narrativeOut).toBeDefined();
    expect(String(narrativeOut.content || '').length).toBeGreaterThan(0);

    // 6. clean_narrative node — preamble stripper. MUST start with a
    //    bullet and MUST NOT contain the seeded meta-narration preamble.
    const cleanOut = result.outputs.clean_narrative as {
      clean_content?: string;
    };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    expect(clean).toContain('oap-openagentic-azure-mcp');
    expect(clean).toContain('openagentic-workflows');

    // 7. report node — webhook_response HTML. No unresolved {{...}}
    //    tokens; real markup; cleaned narrative + per-deployment table
    //    inlined; CoT preamble absent.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Deployment names + status keywords must surface in the rendered body.
    expect(bodyHtml).toContain('oap-openagentic-azure-mcp');
    expect(bodyHtml).toContain('openagentic-workflows');
    expect(bodyHtml).toMatch(/stuck/i);
    expect(bodyHtml).toMatch(/rolling-out|rolling out/i);
    // Ready/desired counts must surface so the operator can grok the rollout state.
    expect(bodyHtml).toMatch(/0\s*\/\s*2|0 of 2|ready.*0.*desired.*2/i);
    expect(bodyHtml).toMatch(/1\s*\/\s*3|1 of 3|ready.*1.*desired.*3/i);
    // CoT preamble must NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // This run has 2 unhealthy — body must NOT claim all healthy.
    expect(bodyHtml).not.toMatch(/all\s+\d+\s+deployments\s+healthy|all deployments healthy/i);
  });

  it('empty-case: namespace with all healthy deployments renders a sensible "all healthy" report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let listDeploymentsCallReceived = false;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_kubernetes' &&
          body.tool === 'k8s_list_deployments'
        ) {
          listDeploymentsCallReceived = true;
          return HttpResponse.json(healthyListDeploymentsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- All 3 deployments in namespace agentic-dev are healthy with replicas matching ready and available counts. Recommend a routine future check in 1h.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 70, completion_tokens: 25 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('k8s-deployment-rollout-status-report');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');
    expect(listDeploymentsCallReceived).toBe(true);

    // analyze: 3 deployments all healthy.
    const analyzeOut = result.outputs.analyze as {
      classified?: Array<Record<string, unknown>>;
      healthy_count?: number;
      unhealthy_count?: number;
      total_count?: number;
    };
    expect(analyzeOut.total_count).toBe(3);
    expect(analyzeOut.healthy_count).toBe(3);
    expect(analyzeOut.unhealthy_count).toBe(0);
    expect((analyzeOut.classified || []).every((d) => d.status === 'healthy')).toBe(true);

    // unhealthy: empty array.
    const unhealthyOut = result.outputs.unhealthy as { unhealthy?: unknown[] };
    expect(Array.isArray(unhealthyOut.unhealthy)).toBe(true);
    expect(unhealthyOut.unhealthy?.length).toBe(0);

    // Report MUST render and explicitly state cluster is healthy.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml).toMatch(
      /all\s+\d+\s+deployments\s+healthy|all deployments healthy|cluster.*healthy/i,
    );
  });
});
