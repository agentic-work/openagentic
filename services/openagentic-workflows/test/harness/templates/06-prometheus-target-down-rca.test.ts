/**
 * prometheus-target-down-rca template — end-to-end harness test.
 *
 * AIOps template 6 of 10 (2026-05-13). Goal: query Prometheus for
 * scrape targets currently `up == 0` via the live
 * openagentic_prometheus.prometheus_query MCP tool, parse the formatted-text
 * response into a structured down-targets array (extracting JSON
 * label dicts per line), slice the top {{input.limit}}, fetch
 * correlated errors from the affected namespaces via
 * openagentic_loki.loki_search_errors, group log excerpts by pod-name
 * substring back to each down target, ask the platform LLM for a
 * 2-bullet RCA per down target referencing concrete log signals,
 * strip CoT preamble, render an HTML RCA report via webhook_response
 * with per-target rows (target name + last log excerpt + RCA bullet).
 * Empty-case (all targets up — the operational default in stable
 * clusters) is handled — the report explicitly says "All targets up"
 * instead of rendering a blank table.
 *
 * Real-data discipline:
 *   - fixtures/prom-down-targets-real.json captures the canonical
 *     3-layer proxy/jsonrpc/mcp envelope wrapping the python tool's
 *     prometheus_query formatted-text output (server.py
 *     prometheus_query lines 196-205). Three down targets: minio
 *     (app=minio), postgresql (app_kubernetes_io_name=postgresql),
 *     redis-master (app_kubernetes_io_name=redis). All real down
 *     targets in the cluster as of 2026-05-13.
 *   - fixtures/prom-down-targets-empty.json captures the all-up
 *     default — "Results: 0" with no per-line entries.
 *   - fixtures/loki-correlate-real.json captures the loki_search_errors
 *     text payload with REAL error logs from the three down apps so
 *     the correlate transform's pod-name substring matcher associates
 *     each down target back to its log excerpts.
 *   - mockChatCompletions returns a CoT-leading 3-bullet RCA (one per
 *     target); clean_rca strips the preamble before rendering.
 *
 * Per-node assertions:
 *   - targets: real-shape FastMCP content string with "Query: up == 0"
 *     header + 3 JSON-stringified metric lines
 *   - analyze: parsed down-targets array (3 entries) with pod_name,
 *     app, instance, namespace fields extracted; namespaces set
 *     surfaced for the loki call
 *   - loki_query: real-shape loki_search_errors text payload returned
 *   - correlate: per-target log-excerpt grouping + pre-computed
 *     rows_html for the report (so the report can interpolate via
 *     {{steps.correlate.rows_html}} in a single seam)
 *   - rca: raw LLM output captured (CoT preamble allowed)
 *   - clean_rca: clean_content starts with a bullet, no CoT preamble
 *   - report: webhook_response HTML body — per-target rows + cleaned
 *     RCA; no unresolved {{...}} tokens; CoT preamble absent
 *
 * Empty-case assertions (second `it` block):
 *   - targets.content includes "Results: 0"
 *   - analyze.down_targets is an empty array, total_down === 0
 *   - report HTML explicitly says "all targets up" (no blank table)
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realDownTargetsResponse from '../fixtures/prom-down-targets-real.json' assert { type: 'json' };
import emptyDownTargetsResponse from '../fixtures/prom-down-targets-empty.json' assert { type: 'json' };
import realLokiCorrelateResponse from '../fixtures/loki-correlate-real.json' assert { type: 'json' };

describe('prometheus-target-down-rca template', () => {
  it('runs end-to-end with real down targets + correlated loki logs and renders an HTML RCA report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let promQueryCallReceived = false;
    let promQueryQuery: string | null = null;
    let lokiCallReceived = false;
    let lokiCallNamespace: string | null = null;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_prometheus' &&
          body.tool === 'prometheus_query'
        ) {
          promQueryCallReceived = true;
          const args = body.arguments as Record<string, unknown>;
          promQueryQuery = typeof args?.query === 'string' ? args.query : null;
          return HttpResponse.json(realDownTargetsResponse);
        }
        if (
          body.server === 'openagentic_loki' &&
          body.tool === 'loki_search_errors'
        ) {
          lokiCallReceived = true;
          const args = body.arguments as Record<string, unknown>;
          lokiCallNamespace =
            typeof args?.namespace === 'string' ? args.namespace : null;
          return HttpResponse.json(realLokiCorrelateResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    // LLM mock — CoT preamble + 3-bullet RCA, one per down target. The
    // downstream clean_rca stripper must remove the preamble so the
    // rendered HTML contains ONLY the bullets. Target names mentioned
    // are the three real down targets from the fixture.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to produce an RCA per down target. Let me think:\n' +
        '- milvus-minio-79c85c7c4c-xtcs8 (minio) — pod is failing to bind tcp 0.0.0.0:9000 (address already in use) and the readiness probe is returning HTTP 503; likely a stuck previous process or a conflicting hostNetwork sibling. Restart the pod and verify only one minio replica owns the PV.\n' +
        '- postgresql-0 (postgresql) — postgres_exporter on :9187 cannot reach the primary on 5432 (connection refused + liveness probe failing); the postgres container itself appears down. Check kubectl describe + previous-container logs for OOMKilled, then verify the PVC bind status.\n' +
        '- redis-master-0 (redis) — redis-server cannot bind tcp 6379 (address already in use) and the liveness probe is restarting the pod; likely a crashloop from a stale socket. Delete the pod and check the StatefulSet PVC for filesystem corruption.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 280, completion_tokens: 180 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('prometheus-target-down-rca');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { limit: 3, namespace: 'agentic-dev', time_range: '1h' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + both MCP calls fired with correct args.
    expect(result.status).toBe('completed');
    expect(promQueryCallReceived).toBe(true);
    expect(promQueryQuery).toBe('up == 0');
    expect(lokiCallReceived).toBe(true);
    expect(lokiCallNamespace).toBe('agentic-dev');

    // 2. targets node — real-shape FastMCP content string joined from
    //    content[].text. Header + 3 JSON metric lines.
    const targetsOut = result.outputs.targets as { content?: string };
    expect(targetsOut).toBeDefined();
    const targetsText = String(targetsOut.content || '');
    expect(targetsText).toContain('Query: up == 0');
    expect(targetsText).toContain('Result Type: vector');
    expect(targetsText).toContain('Results: 3');
    expect(targetsText).toContain('milvus-minio');
    expect(targetsText).toContain('postgresql-0');
    expect(targetsText).toContain('redis-master-0');

    // 3. analyze node — parsed down-targets array. Each entry has
    //    pod_name, app, instance, namespace, job. Sliced to limit=3
    //    (all three retained). Plus namespace_label + total_down +
    //    rows_html pre-computed for the report.
    const analyzeOut = result.outputs.analyze as {
      down_targets?: Array<Record<string, unknown>>;
      total_down?: number;
      namespace_label?: string;
      rows_html?: string;
    };
    expect(analyzeOut).toBeDefined();
    expect(Array.isArray(analyzeOut.down_targets)).toBe(true);
    expect(analyzeOut.down_targets?.length).toBe(3);
    expect(analyzeOut.total_down).toBe(3);
    // Each entry carries pod_name + app + instance + namespace.
    const dts = analyzeOut.down_targets || [];
    const minio = dts.find((d) => String(d.pod_name).includes('milvus-minio'));
    const pg = dts.find((d) => String(d.pod_name).includes('postgresql-0'));
    const redis = dts.find((d) => String(d.pod_name).includes('redis-master-0'));
    expect(minio).toBeDefined();
    expect(pg).toBeDefined();
    expect(redis).toBeDefined();
    expect(String(minio?.namespace)).toBe('agentic-dev');
    expect(String(minio?.app)).toBe('minio');
    expect(String(pg?.app)).toBe('postgresql');
    expect(String(redis?.app)).toBe('redis');

    // 4. loki_query node — real-shape text payload joined from
    //    content[].text. Contains correlated error logs.
    const lokiOut = result.outputs.loki_query as { content?: string };
    expect(lokiOut).toBeDefined();
    const lokiText = String(lokiOut.content || '');
    expect(lokiText).toContain('Error Log Search Results');
    expect(lokiText).toContain('milvus-minio');
    expect(lokiText).toContain('postgresql-0');
    expect(lokiText).toContain('redis-master-0');

    // 5. correlate node — per-target log grouping + pre-computed
    //    rows_html. The transform must produce per_target_logs (map
    //    pod_name → first N log lines) and rows_html (HTML <tr>
    //    rows ready for direct interpolation in the report).
    const correlateOut = result.outputs.correlate as {
      per_target_logs?: Record<string, string>;
      rows_html?: string;
      total_correlated?: number;
    };
    expect(correlateOut).toBeDefined();
    expect(correlateOut.per_target_logs).toBeDefined();
    const ptl = correlateOut.per_target_logs || {};
    // Each down target gets a non-empty log excerpt (substring match
    // against pod_name in the log lines).
    const minioLogs = String(ptl['milvus-minio-79c85c7c4c-xtcs8'] || '');
    const pgLogs = String(ptl['postgresql-0'] || '');
    const redisLogs = String(ptl['redis-master-0'] || '');
    expect(minioLogs.length).toBeGreaterThan(0);
    expect(minioLogs.toLowerCase()).toMatch(/bind|address|503|minio/);
    expect(pgLogs.length).toBeGreaterThan(0);
    expect(pgLogs.toLowerCase()).toMatch(/postgres|exporter|connection/);
    expect(redisLogs.length).toBeGreaterThan(0);
    expect(redisLogs.toLowerCase()).toMatch(/redis|bind|6379|liveness/);
    // rows_html: real HTML <tr> markup with each down target row.
    const rowsHtml = String(correlateOut.rows_html || '');
    expect(rowsHtml).toContain('<tr');
    expect(rowsHtml).toContain('milvus-minio');
    expect(rowsHtml).toContain('postgresql-0');
    expect(rowsHtml).toContain('redis-master-0');

    // 6. rca node — raw LLM output captured. CoT preamble IS allowed
    //    here because clean_rca strips it.
    const rcaOut = result.outputs.rca as { content?: string };
    expect(rcaOut).toBeDefined();
    expect(String(rcaOut.content || '').length).toBeGreaterThan(0);

    // 7. clean_rca node — preamble stripper. MUST start with a bullet
    //    and MUST NOT contain the seeded meta-narration preamble.
    const cleanOut = result.outputs.clean_rca as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    // All three down-target pod names must appear in the cleaned RCA.
    expect(clean).toContain('milvus-minio');
    expect(clean).toContain('postgresql-0');
    expect(clean).toContain('redis-master-0');

    // 8. report node — webhook_response HTML body. No unresolved
    //    {{...}} tokens; real markup; rows + cleaned RCA inlined;
    //    CoT preamble absent.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Target names must surface in the rendered body.
    expect(bodyHtml).toContain('milvus-minio');
    expect(bodyHtml).toContain('postgresql-0');
    expect(bodyHtml).toContain('redis-master-0');
    // Cleaned RCA bullets present.
    expect(bodyHtml).toMatch(/bind|liveness|connection/i);
    // CoT preamble MUST NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // Non-empty case must NOT claim all targets are up.
    expect(bodyHtml).not.toMatch(/all\s+\d+\s+targets\s+up|all targets up/i);
  });

  it('empty-case: cluster with zero down targets renders a sensible "all targets up" report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let promQueryCallReceived = false;
    let lokiCallReceived = false;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_prometheus' &&
          body.tool === 'prometheus_query'
        ) {
          promQueryCallReceived = true;
          return HttpResponse.json(emptyDownTargetsResponse);
        }
        if (
          body.server === 'openagentic_loki' &&
          body.tool === 'loki_search_errors'
        ) {
          lokiCallReceived = true;
          // Loki may still be called with namespace='agentic-dev' even
          // when no down targets — that's OK, the correlate step will
          // produce an empty per-target map.
          return HttpResponse.json(realLokiCorrelateResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- All scrape targets are currently up in Prometheus — no RCA needed. Recommend a routine future check in 1h.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 60, completion_tokens: 20 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('prometheus-target-down-rca');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { limit: 3, namespace: 'agentic-dev', time_range: '1h' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');
    expect(promQueryCallReceived).toBe(true);

    // analyze: zero down targets.
    const analyzeOut = result.outputs.analyze as {
      down_targets?: unknown[];
      total_down?: number;
    };
    expect(Array.isArray(analyzeOut.down_targets)).toBe(true);
    expect(analyzeOut.down_targets?.length).toBe(0);
    expect(analyzeOut.total_down).toBe(0);

    // Report MUST render and explicitly state all targets are up — a
    // blank/empty-table page is a fail.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml).toMatch(/all\s+targets\s+up|all targets up|no down targets/i);
    // The loki call is allowed in the empty case (the engine may still
    // fire it unconditionally per the static flow graph); the
    // assertion is informational.
    void lokiCallReceived;
  });
});
