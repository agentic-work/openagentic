/**
 * k8s-pod-health-summary template — end-to-end harness test.
 *
 * Real-data discipline (2026-05-13 user directive: "all templates must pass
 * tdd AND the real flows test harness"):
 *   - fixtures/k8s_list_pods-real.json captures the canonical 4-layer
 *     mcp-proxy /call envelope (proxy.result → jsonrpc.result → mcp.result
 *     → content[0].text = JSON of the python tool's return dict). The dict
 *     itself matches oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py
 *     k8s_list_pods (lines 252-302).
 *   - The fixture mixes 3 healthy pods with 2 unhealthy (one Pending, one
 *     Running-but-restarts=12) so the transform filter has real records
 *     to flag — no op:"set" literals masquerading as live data.
 *   - mockChatCompletions emits the OpenAI SSE stream the new streaming
 *     llm_completion executor reads (Tier B). The completion text is a
 *     plain 3-bullet summary with NO chain-of-thought preamble; the test
 *     asserts that gpt-oss/sonnet-style "Let me think..." or "The user
 *     wants me to..." prefixes never appear in the rendered output (Phase
 *     A2 strip in streamLLMCompletion is the upstream guard).
 *
 * Per-node assertions cover the four template-pass criteria from
 * _helpers.assertTemplatePass plus per-node strict validation:
 *   - status === 'completed'
 *   - kubectl_pods returned the wrapped MCP envelope
 *   - filter pulled real records from the kubectl text payload (no fake data)
 *   - summary text starts with a bullet (no CoT preamble leak)
 *   - report renders the inlined HTML through webhook_response with the
 *     summary substituted and zero unresolved {{...}} tokens.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realKubectlResponse from '../fixtures/k8s_list_pods-real.json' assert { type: 'json' };

describe('k8s-pod-health-summary template', () => {
  it('runs end-to-end with real-shape kubectl data and renders an HTML pod-health report', async () => {
    // 1. Wire the MCP proxy URL the mcp_tool executor reads. The proxy
    //    response shape mirrors the real /call envelope — proxy.result
    //    wraps the jsonrpc.result wraps the mcp.result wraps content blocks.
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let kubectlCallReceived = false;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        kubectlCallReceived = true;
        // The mcp_tool node POSTs { server, tool, arguments } — gate the
        // mock on this matching openagentic_kubernetes.k8s_list_pods to catch any
        // routing bug before the fixture data is returned.
        if (
          body.server === 'openagentic_kubernetes' &&
          body.tool === 'k8s_list_pods'
        ) {
          return HttpResponse.json(realKubectlResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    // 2. LLM completion mock — emits a real-shape SSE stream. The content
    //    DELIBERATELY leads with a CoT preamble so the post-LLM
    //    `clean_summary` transform's strip is exercised. Without that
    //    strip, the preamble would leak into the rendered HTML report —
    //    that's the original Phase 6 blocker. Asserting the stripper
    //    works on a known-bad input is the real test.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to write 3 bullets about unhealthy pods. Let me think about this. Here is the summary:\n' +
        '- openagentic-workflows-5c4e8a9b3f-q7n6w is Pending with 8 restarts — likely image-pull or PVC binding failure; check `kubectl describe`.\n' +
        '- openagentic-mcp-proxy-7e9c4d5a8b-r3k9p has 12 restarts despite Running — memory pressure suspected; review pod limits and recent OOMKills.\n' +
        '- 2 unhealthy pods across namespace agentic-dev; consider rolling-restart of workflows deploy after PVC fix.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 120, completion_tokens: 95 },
    });
    harnessServer.use(llmHandler);

    // 3. Load + execute the template through the real engine.
    const tpl = loadTemplate('k8s-pod-health-summary');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 4. Top-level: completed, mcp call happened.
    expect(result.status).toBe('completed');
    expect(kubectlCallReceived).toBe(true);

    // 5. kubectl_pods node — real-shape envelope reached the output map.
    //    Live-captured shape (2026-05-13 on the dev environment): the openagentic_kubernetes
    //    MCP returns a native python dict (NOT FastMCP content[] blocks);
    //    mcp_tool's 3-layer unwrap surfaces the dict verbatim — no
    //    content-string join because there were no content[] blocks. So
    //    the node output IS the structured dict with `pods` at the top.
    const kubectlOut = result.outputs.kubectl_pods as {
      success?: boolean;
      pods?: Array<Record<string, unknown>>;
      count?: number;
    };
    expect(kubectlOut).toBeDefined();
    expect(kubectlOut.success).toBe(true);
    expect(Array.isArray(kubectlOut.pods)).toBe(true);
    expect((kubectlOut.pods || []).length).toBeGreaterThan(0);
    expect(kubectlOut.count).toBeGreaterThan(0);
    expect(kubectlOut.pods?.[0]).toMatchObject({
      name: expect.any(String),
      namespace: expect.any(String),
      status: expect.any(String),
    });

    // 6. filter node — pulled the unhealthy pods out of the real payload
    //    via JSON.parse of the upstream `content` string. The fixture has
    //    exactly 2 unhealthy: one Pending, one Running-with-restarts>5.
    const filterOut = result.outputs.filter as {
      unhealthy?: unknown[];
      namespace_label?: string;
      pod_count?: number;
    };
    expect(filterOut).toBeDefined();
    expect(Array.isArray(filterOut.unhealthy)).toBe(true);
    expect(filterOut.unhealthy?.length).toBe(2);
    expect(filterOut.namespace_label).toBe('agentic-dev');
    expect(filterOut.pod_count).toBe(5);
    // The Pending pod (status !== Running) and the Running-but-flaky pod
    // (restarts > 5) must both appear.
    const unhealthyNames = (filterOut.unhealthy as Array<{ name: string }>).map(
      (p) => p.name,
    );
    expect(unhealthyNames).toContain('openagentic-workflows-5c4e8a9b3f-q7n6w');
    expect(unhealthyNames).toContain('openagentic-mcp-proxy-7e9c4d5a8b-r3k9p');

    // 7. summary node — raw LLM output captured. CoT preamble IS allowed
    //    here because the downstream `clean_summary` transform strips it.
    const summaryOut = result.outputs.summary as { content?: string };
    expect(summaryOut).toBeDefined();
    expect(String(summaryOut.content || '').length).toBeGreaterThan(0);

    // 8. clean_summary node — preamble stripper output. MUST start with a
    //    bullet character and MUST NOT contain the leading meta-narration
    //    we deliberately seeded into the LLM mock above.
    const cleanOut = result.outputs.clean_summary as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    expect(clean).toContain('openagentic-workflows-5c4e8a9b3f-q7n6w');

    // 9. report node — HTML rendered through webhook_response with the
    //    cleaned summary substituted. No unresolved {{...}} tokens, and
    //    the body contains real markup, not a generic "Html Artifact" stub.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // The cleaned summary text must be inlined into the body — that's the
    // whole point of the report node.
    expect(bodyHtml).toContain('openagentic-workflows');
    // The CoT preamble must NOT appear in the final rendered body.
    expect(bodyHtml).not.toMatch(/The user wants me to/i);
    expect(bodyHtml).not.toMatch(/Let me think/i);
  });
});
