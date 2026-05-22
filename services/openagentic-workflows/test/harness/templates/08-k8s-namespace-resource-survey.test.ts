/**
 * k8s-namespace-resource-survey template — end-to-end harness test.
 *
 * AIOps template 8 of 10 (2026-05-13). Goal: snapshot a Kubernetes
 * namespace's resource inventory (pods + deployments + services) in a
 * single parallel fan-out, normalize each branch's native dict in a
 * single analyze transform (totals + sample tables + rows_html per
 * section), ask the platform LLM for a 3-4 bullet narrative
 * characterizing the namespace's resource footprint, strip CoT
 * preamble, render an HTML survey report via webhook_response.
 *
 * Three resource tools chosen:
 *   - openagentic_kubernetes.k8s_list_pods       → { success, namespace, pods[], count }
 *   - openagentic_kubernetes.k8s_list_deployments → { success, namespace, deployments[], count }
 *   - openagentic_kubernetes.k8s_list_services   → { success, namespace, services[], count }
 *
 * Each tool returns the native python dict (no FastMCP content[].text
 * wrapping) so the mcp-proxy 3-layer unwrap surfaces the dict
 * verbatim. The labeled merge node converges the three branches keyed
 * by snake-cased source-node label (engine constraint:
 * (sourceNode.data.label || sourceNode.id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()).
 * The parallel nodes use literal labels 'pods', 'deployments',
 * 'services' so the analyze transform reads input.pods / input.deployments
 * / input.services predictably.
 *
 * Real-data discipline:
 *   - fixtures/k8s_list_pods-real.json + k8s_list_deployments-real.json
 *     + k8s_list_services-real.json each capture the canonical 3-layer
 *     proxy/jsonrpc/mcp envelope wrapping the python tool's native dict.
 *   - fixtures/*-empty.json mirror the same envelope with zero entries
 *     for the empty-namespace test.
 *   - mockChatCompletions returns a CoT-leading 3-bullet narrative;
 *     the clean_narrative transform strips the preamble.
 *
 * Per-node assertions (populated namespace case):
 *   - pods / deployments / services: real-shape native dicts with the
 *     pods[]/deployments[]/services[] array + count.
 *   - merge_inventory: labeled object { pods, deployments, services }
 *   - analyze: pre-computed pods_array + deployments_array + services_array
 *     + pod_count + deployment_count + service_count + pods_rows_html +
 *     deployments_rows_html + services_rows_html + namespace_label.
 *   - narrative: raw LLM output (CoT preamble allowed)
 *   - clean_narrative: clean_content starts with a bullet, no CoT
 *   - report: webhook_response HTML body — namespace header + per-section
 *     tables + cleaned narrative; no unresolved {{...}} tokens; CoT absent
 *
 * Empty-case assertions:
 *   - analyze: pod_count === 0 / deployment_count === 0 / service_count === 0
 *   - report HTML explicitly states "No resources" / "empty namespace"
 *     instead of rendering blank tables
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realListPodsResponse from '../fixtures/k8s_list_pods-real.json' assert { type: 'json' };
import realListDeploymentsResponse from '../fixtures/k8s_list_deployments-real.json' assert { type: 'json' };
import realListServicesResponse from '../fixtures/k8s_list_services-real.json' assert { type: 'json' };
import emptyListPodsResponse from '../fixtures/k8s_list_pods-empty.json' assert { type: 'json' };
import emptyListDeploymentsResponse from '../fixtures/k8s_list_deployments-empty.json' assert { type: 'json' };
import emptyListServicesResponse from '../fixtures/k8s_list_services-empty.json' assert { type: 'json' };

describe('k8s-namespace-resource-survey template', () => {
  it('runs end-to-end with a populated namespace and renders an HTML survey report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    const calls: Array<{ server: string; tool: string; namespace: string | null }> = [];

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const server = String(body.server || '');
        const tool = String(body.tool || '');
        const args = body.arguments as Record<string, unknown>;
        const namespace =
          typeof args?.namespace === 'string' ? args.namespace : null;
        calls.push({ server, tool, namespace });
        if (server === 'openagentic_kubernetes' && tool === 'k8s_list_pods') {
          return HttpResponse.json(realListPodsResponse);
        }
        if (server === 'openagentic_kubernetes' && tool === 'k8s_list_deployments') {
          return HttpResponse.json(realListDeploymentsResponse);
        }
        if (server === 'openagentic_kubernetes' && tool === 'k8s_list_services') {
          return HttpResponse.json(realListServicesResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${server}.${tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to characterize this namespace. Let me think:\n' +
        '- The agentic-dev namespace runs the OpenAgentic core stack with 5 pods spanning api, ui, workflows, mcp-proxy plus a harbor-redis cache; the workflow plane shows signs of instability (one pod Pending with 8 restarts, mcp-proxy at 12 restarts).\n' +
        '- Three deployments are deployed: one healthy api, one mid-rollout workflows, and one stuck oap-azure-mcp — concentrated risk on the workflows + azure-mcp components.\n' +
        '- Network exposure is internal-only: three ClusterIP services (api, ui, mcp-proxy) with no external IPs and no LoadBalancer types — the namespace is well-scoped and gated behind an ingress.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 320, completion_tokens: 180 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('k8s-namespace-resource-survey');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + all three calls fired against the requested namespace.
    expect(result.status).toBe('completed');
    const podCall = calls.find((c) => c.tool === 'k8s_list_pods');
    const depCall = calls.find((c) => c.tool === 'k8s_list_deployments');
    const svcCall = calls.find((c) => c.tool === 'k8s_list_services');
    expect(podCall).toBeDefined();
    expect(depCall).toBeDefined();
    expect(svcCall).toBeDefined();
    expect(podCall?.namespace).toBe('agentic-dev');
    expect(depCall?.namespace).toBe('agentic-dev');
    expect(svcCall?.namespace).toBe('agentic-dev');

    // 2. Per-resource nodes — real-shape native dicts (no content[]).
    const podsOut = result.outputs.pods as {
      success?: boolean;
      pods?: unknown[];
      count?: number;
      namespace?: string;
    };
    const depsOut = result.outputs.deployments as {
      success?: boolean;
      deployments?: unknown[];
      count?: number;
    };
    const svcsOut = result.outputs.services as {
      success?: boolean;
      services?: unknown[];
      count?: number;
    };
    expect(podsOut).toBeDefined();
    expect(podsOut.success).toBe(true);
    expect(Array.isArray(podsOut.pods)).toBe(true);
    expect(podsOut.count).toBe(5);
    expect(depsOut.success).toBe(true);
    expect(Array.isArray(depsOut.deployments)).toBe(true);
    expect(depsOut.count).toBe(3);
    expect(svcsOut.success).toBe(true);
    expect(Array.isArray(svcsOut.services)).toBe(true);
    expect(svcsOut.count).toBe(3);

    // 3. merge_inventory — labeled object with three branches keyed by
    //    the parallel node labels (pods / deployments / services).
    const mergeOut = result.outputs.merge_inventory as Record<string, unknown>;
    expect(mergeOut).toBeDefined();
    expect(mergeOut.pods).toBeDefined();
    expect(mergeOut.deployments).toBeDefined();
    expect(mergeOut.services).toBeDefined();

    // 4. analyze — single transform pre-computes all the rendering state.
    const analyzeOut = result.outputs.analyze as {
      namespace_label?: string;
      pod_count?: number;
      deployment_count?: number;
      service_count?: number;
      pods_rows_html?: string;
      deployments_rows_html?: string;
      services_rows_html?: string;
      pods_array?: unknown[];
      deployments_array?: unknown[];
      services_array?: unknown[];
    };
    expect(analyzeOut).toBeDefined();
    expect(analyzeOut.namespace_label).toBe('agentic-dev');
    expect(analyzeOut.pod_count).toBe(5);
    expect(analyzeOut.deployment_count).toBe(3);
    expect(analyzeOut.service_count).toBe(3);
    expect(Array.isArray(analyzeOut.pods_array)).toBe(true);
    expect(Array.isArray(analyzeOut.deployments_array)).toBe(true);
    expect(Array.isArray(analyzeOut.services_array)).toBe(true);
    expect(analyzeOut.pods_array?.length).toBe(5);
    expect(analyzeOut.deployments_array?.length).toBe(3);
    expect(analyzeOut.services_array?.length).toBe(3);
    const podsRows = String(analyzeOut.pods_rows_html || '');
    const depRows = String(analyzeOut.deployments_rows_html || '');
    const svcRows = String(analyzeOut.services_rows_html || '');
    expect(podsRows).toContain('<tr');
    expect(podsRows).toContain('openagentic-api');
    expect(depRows).toContain('<tr');
    expect(depRows).toContain('openagentic-workflows');
    expect(svcRows).toContain('<tr');
    expect(svcRows).toContain('openagentic-mcp-proxy');

    // 5. narrative — raw LLM output captured.
    const narrativeOut = result.outputs.narrative as { content?: string };
    expect(narrativeOut).toBeDefined();
    expect(String(narrativeOut.content || '').length).toBeGreaterThan(0);

    // 6. clean_narrative — preamble stripper.
    const cleanOut = result.outputs.clean_narrative as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);

    // 7. report — webhook_response HTML. No unresolved {{...}} tokens.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Per-section visible.
    expect(bodyHtml.toLowerCase()).toContain('pods');
    expect(bodyHtml.toLowerCase()).toContain('deployments');
    expect(bodyHtml.toLowerCase()).toContain('services');
    // Real resource names visible.
    expect(bodyHtml).toContain('openagentic-api');
    expect(bodyHtml).toContain('openagentic-workflows');
    expect(bodyHtml).toContain('openagentic-mcp-proxy');
    // CoT preamble must NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // Namespace label surfaces.
    expect(bodyHtml).toContain('agentic-dev');
  });

  it('empty-namespace case: every resource list returns zero entries and the report still renders sensibly', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_list_pods') {
          return HttpResponse.json(emptyListPodsResponse);
        }
        if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_list_deployments') {
          return HttpResponse.json(emptyListDeploymentsResponse);
        }
        if (body.server === 'openagentic_kubernetes' && body.tool === 'k8s_list_services') {
          return HttpResponse.json(emptyListServicesResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- Namespace empty-namespace has zero pods, deployments, and services — nothing is currently deployed there.\n' +
        '- Recommend confirming this is the intended state or checking whether a recent rollout was cleaned up by mistake.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 90, completion_tokens: 50 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('k8s-namespace-resource-survey');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'empty-namespace' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    const analyzeOut = result.outputs.analyze as {
      namespace_label?: string;
      pod_count?: number;
      deployment_count?: number;
      service_count?: number;
    };
    expect(analyzeOut.namespace_label).toBe('empty-namespace');
    expect(analyzeOut.pod_count).toBe(0);
    expect(analyzeOut.deployment_count).toBe(0);
    expect(analyzeOut.service_count).toBe(0);

    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Sensible empty rendering — explicit "no resources" / "empty"
    // language somewhere in the body, not blank tables.
    expect(bodyHtml.toLowerCase()).toMatch(/no\s+(resources|pods|deployments|services)|empty/);
    expect(bodyHtml).toContain('empty-namespace');
  });
});
