/**
 * k8s-pod-health-typed template — end-to-end harness test.
 *
 * The typed-chain variant of `k8s-pod-health-summary` (slug 1). Same
 * upstream MCP call against openagentic_kubernetes.k8s_list_pods, same LLM
 * narrative, same HTML report — but the JS-expression `filter` transform
 * is replaced with three typed primitives chained back-to-back:
 *
 *   extract_key  (structuredContent.pods)  → pulls the array out of the
 *                                            MCP envelope (live mcp-proxy
 *                                            wraps the python dict in
 *                                            { content, structuredContent,
 *                                            isError }).
 *   filter_data  (status neq Running)      → keeps only unhealthy rows.
 *   select_data  (pick name/ns/status/restarts/ready) → projects columns.
 *
 * The single remaining `aggregate` transform reads the projected array
 * and assembles the LLM prompt inputs — the one case where JS-in-sandbox
 * is genuinely the right primitive (cross-field derivation).
 *
 * The fixture (k8s_list_pods-real.json from slug 1's evidence) mixes 3
 * healthy + 2 unhealthy pods so the typed predicate has something real
 * to drop. Per-node assertions cover the full chain:
 *
 *   - kubectl_pods   → real-shape mcp envelope unwrapped
 *   - filter_unhealthy → typed filter dropped the Running rows
 *   - project_fields  → array shape, only the picked keys remain
 *   - aggregate       → namespace_label + counts + rows_html ready
 *   - summary         → LLM raw output captured
 *   - clean_narrative → CoT preamble stripped, starts with bullet
 *   - report          → HTML rendered with substituted summary, no
 *                       unresolved {{...}} tokens, real markup
 *
 * Functional equivalence to slug 1: the rendered report names the same
 * unhealthy pods, hits the same 3-bullet shape, returns the same status
 * code + content-type. The visible difference is the intermediate
 * primitives, not the rendered report — which is the proof that the
 * typed-chain pattern opens authoring to non-engineers without
 * regressing output quality.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
// Reuses slug 1's fixture (k8s_list_pods-real.json). The live mcp-proxy
// returns the python dict at top-level for this MCP (top-level pods,
// count, success — the FastMCP content[] envelope is NOT wrapped around
// it). Confirmed via live canvas run 2026-05-14 against agentic-dev
// cluster: kubectl_pods output is { success, namespace, pods: [...],
// count } — so extract_key path 'pods' resolves directly.
import realKubectlResponse from '../fixtures/k8s_list_pods-real.json' assert { type: 'json' };

describe('k8s-pod-health-typed template (typed-chain variant)', () => {
  it('runs end-to-end with real-shape kubectl data via filter_data + select_data and renders the typed HTML report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let kubectlCallReceived = false;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        kubectlCallReceived = true;
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

    // LLM completion mock — deliberately seeds a CoT preamble so the
    // clean_narrative stripper is exercised end-to-end (same pattern as
    // slug 1).
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize unhealthy pods. Let me think. Here is the operator narrative:\n' +
        '- openagentic-workflows-5c4e8a9b3f-q7n6w is Pending with 8 restarts — likely image-pull or PVC binding failure.\n' +
        '- 1 unhealthy pod in agentic-dev (status != Running); the running pods include mcp-proxy with 12 restarts but stayed Running so the typed predicate kept it out — adjust to a multi-predicate flow if restart-count matters.\n' +
        '- Recommend kubectl describe pod openagentic-workflows-5c4e8a9b3f-q7n6w to confirm root cause.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 110, completion_tokens: 90 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('k8s-pod-health-typed');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level — completed + mcp call reached.
    expect(result.status).toBe('completed');
    expect(kubectlCallReceived).toBe(true);

    // 2. kubectl_pods — python dict at top-level (no FastMCP content[]
    //    wrapper for this MCP); pods array surfaced verbatim. Same shape
    //    as slug 1.
    const kubectlOut = result.outputs.kubectl_pods as {
      success?: boolean;
      pods?: Array<Record<string, unknown>>;
      count?: number;
    };
    expect(kubectlOut.success).toBe(true);
    expect(Array.isArray(kubectlOut.pods)).toBe(true);
    expect((kubectlOut.pods || []).length).toBe(5);

    // 2b. extract_pods — typed extraction of the pods array via dot-path
    //    'pods'. found=true and value=the array verbatim.
    const extractOut = result.outputs.extract_pods as {
      value?: Array<Record<string, unknown>>;
      found?: boolean;
    };
    expect(extractOut.found).toBe(true);
    expect(Array.isArray(extractOut.value)).toBe(true);
    expect(extractOut.value?.length).toBe(5);

    // 3. filter_unhealthy — typed predicate dropped the 4 Running rows,
    //    kept the 1 Pending row. Shape comes from filter_data executor
    //    contract: { filtered, droppedCount, totalCount }.
    const filterOut = result.outputs.filter_unhealthy as {
      filtered?: Array<{ status?: string; name?: string }>;
      droppedCount?: number;
      totalCount?: number;
    };
    expect(filterOut).toBeDefined();
    expect(Array.isArray(filterOut.filtered)).toBe(true);
    expect(filterOut.totalCount).toBe(5);
    expect(filterOut.filtered?.length).toBe(1);
    expect(filterOut.droppedCount).toBe(4);
    expect(filterOut.filtered?.[0].status).toBe('Pending');
    expect(filterOut.filtered?.[0].name).toBe(
      'openagentic-workflows-5c4e8a9b3f-q7n6w',
    );

    // 4. project_fields — typed projection keeps only the listed keys per
    //    row. select_data output shape mirrors input (array stays array).
    const projectOut = result.outputs.project_fields as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(projectOut)).toBe(true);
    expect(projectOut.length).toBe(1);
    expect(Object.keys(projectOut[0]).sort()).toEqual(
      ['name', 'namespace', 'ready', 'restarts', 'status'].sort(),
    );
    // Restart count is the projected number, not the original `labels`
    // map or the original `node` field (which were dropped).
    expect(projectOut[0].restarts).toBe(8);
    expect((projectOut[0] as Record<string, unknown>).labels).toBeUndefined();
    expect((projectOut[0] as Record<string, unknown>).node).toBeUndefined();

    // 5. aggregate — namespace, counts, and rows_html ready for the
    //    report. The transform reads `input.input` because select_data
    //    handed it a bare array (transform's `base = { input }` wrap).
    const aggOut = result.outputs.aggregate as {
      namespace_label?: string;
      unhealthy_projected?: Array<Record<string, unknown>>;
      unhealthy_count?: number;
      rows_html?: string;
    };
    expect(aggOut.namespace_label).toBe('agentic-dev');
    expect(aggOut.unhealthy_count).toBe(1);
    expect(Array.isArray(aggOut.unhealthy_projected)).toBe(true);
    expect(aggOut.unhealthy_projected?.length).toBe(1);
    expect(aggOut.rows_html).toContain(
      'openagentic-workflows-5c4e8a9b3f-q7n6w',
    );
    expect(aggOut.rows_html).toContain('<tr>');
    expect(aggOut.rows_html).toContain('Pending');

    // 6. summary — raw LLM output captured (CoT preamble allowed here;
    //    the downstream clean_narrative transform strips it).
    const summaryOut = result.outputs.summary as { content?: string };
    expect(String(summaryOut.content || '').length).toBeGreaterThan(0);

    // 7. clean_narrative — preamble stripped, starts with bullet.
    const cleanOut = result.outputs.clean_narrative as {
      clean_content?: string;
    };
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    expect(clean).toContain('openagentic-workflows-5c4e8a9b3f-q7n6w');

    // 8. report — HTML rendered with substituted summary + typed table.
    //    No unresolved {{...}} tokens, table includes the unhealthy pod
    //    row, the title carries the "typed chain" label so the two
    //    templates are distinguishable at a glance.
    const reportOut = result.outputs.report as { body?: string };
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<table');
    expect(bodyHtml).toContain('typed chain');
    expect(bodyHtml).toContain('openagentic-workflows-5c4e8a9b3f-q7n6w');
    expect(bodyHtml).toContain('Pending');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml).not.toMatch(/The user wants me to/i);
  });
});
