/**
 * prometheus-active-alerts-digest template — end-to-end harness test.
 *
 * AIOps template 4 of 10 (2026-05-13). Goal: pull active Prometheus
 * alerts from the live openagentic_prometheus MCP, parse the formatted text
 * payload into an alerts array, sort by severity (critical > warning >
 * info) and slice the top N, ask the platform LLM for a 3-5 bullet
 * operator-facing digest of the most critical issues focused on next
 * actions, strip any CoT preamble, then render an HTML digest report
 * via webhook_response. Empty-cluster (zero active alerts) is the
 * operational default and the template MUST render a sensible "No
 * active alerts" page rather than a blank one.
 *
 * Real-data discipline:
 *   - fixtures/prom_alerts-real.json captures the canonical 3-layer
 *     proxy/jsonrpc/mcp envelope wrapping the python tool's FastMCP
 *     content[0].text payload. The text is the formatted multi-line
 *     string the python tool emits verbatim (server.py prometheus_alerts
 *     lines ~290-340). Three alerts: 2 FIRING (PostgresHighConnectionCount
 *     critical + KubeletPodCrashLooping warning) + 1 PENDING
 *     (HarborRegistryMemoryPressure warning) so the filter has
 *     severity-mix records to sort.
 *   - fixtures/prom_alerts-empty.json captures the same envelope for
 *     the zero-alerts case — the python tool short-circuits to
 *     "No active alerts" and FastMCP wraps it as content[0].text.
 *     Live-confirmed shape from the in-cluster prometheus
 *     (monitoring-stack/prometheus-55b9bd979c-fxkw8 currently has
 *     {"status":"success","data":{"alerts":[]}}).
 *   - mockChatCompletions returns a CoT-leading 3-bullet digest;
 *     the test asserts the clean_summary stripper removes the
 *     preamble from the rendered HTML.
 *
 * Per-node assertions:
 *   - alerts: real-shape FastMCP `content` string with "Active Alerts:"
 *     header + FIRING/PENDING sections + alertnames + severities
 *   - filter: parsed structured array sorted by severity desc, sliced
 *     top {{input.limit}}, plus alert_count + severity_label counts
 *   - summary: raw LLM content non-empty (CoT preamble allowed)
 *   - clean_summary: starts with a bullet, no CoT preamble
 *   - report: webhook_response HTML body — table of alerts + cleaned
 *     digest text; no unresolved {{...}} tokens; CoT preamble absent
 *
 * Empty-case assertions (second `it` block):
 *   - alerts.content === "No active alerts"
 *   - filter.alerts is an empty array, alert_count === 0
 *   - report HTML explicitly says "No active alerts" (not blank)
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realAlertsResponse from '../fixtures/prom_alerts-real.json' assert { type: 'json' };
import emptyAlertsResponse from '../fixtures/prom_alerts-empty.json' assert { type: 'json' };

describe('prometheus-active-alerts-digest template', () => {
  it('runs end-to-end with real-shape Prometheus alerts and renders an HTML digest report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let alertsCallReceived = false;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_prometheus' &&
          body.tool === 'prometheus_alerts'
        ) {
          alertsCallReceived = true;
          return HttpResponse.json(realAlertsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    // LLM mock — CoT preamble + 3-bullet operator digest. The
    // downstream clean_summary stripper must remove the preamble so
    // the rendered HTML contains ONLY the bullets. Alert names
    // mentioned are the three real alerts from the fixture.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize the most critical issues. Let me think about each alert:\n' +
        '- PostgresHighConnectionCount (critical) — postgresql-0 at 192/200 connections; increase max_connections or audit long-running idle sessions ASAP to avoid app-side connection refusal.\n' +
        '- KubeletPodCrashLooping (warning) — openagentic-workflows pod cycling 1.2 restarts/5m; pull `kubectl logs --previous` for the latest crash and check Prisma migration drift.\n' +
        '- HarborRegistryMemoryPressure (warning, pending) — harbor-core memory at 91%; bump memory limits or restart core to clear caches before this escalates to firing.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 200, completion_tokens: 140 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('prometheus-active-alerts-digest');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { severity: 'all', limit: 5 },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + MCP call fired.
    expect(result.status).toBe('completed');
    expect(alertsCallReceived).toBe(true);

    // 2. alerts node — real-shape FastMCP envelope; content string
    //    joined from content[].text by the mcp_tool normalizer.
    const alertsOut = result.outputs.alerts as { content?: string };
    expect(alertsOut).toBeDefined();
    const alertsText = String(alertsOut.content || '');
    expect(alertsText).toContain('Active Alerts:');
    expect(alertsText).toContain('FIRING');
    expect(alertsText).toContain('PostgresHighConnectionCount');
    expect(alertsText).toContain('KubeletPodCrashLooping');
    expect(alertsText).toContain('HarborRegistryMemoryPressure');
    expect(alertsText).toContain('critical');
    expect(alertsText).toContain('warning');

    // 3. filter node — parsed alerts array sorted by severity desc and
    //    sliced top {{input.limit}}. Critical first, then warnings.
    const filterOut = result.outputs.filter as {
      alerts?: Array<Record<string, unknown>>;
      alert_count?: number;
      critical_count?: number;
      warning_count?: number;
    };
    expect(filterOut).toBeDefined();
    expect(Array.isArray(filterOut.alerts)).toBe(true);
    expect(filterOut.alert_count).toBe(3);
    expect(filterOut.critical_count).toBe(1);
    expect(filterOut.warning_count).toBe(2);
    // First entry (post-sort) is the critical one.
    const firstAlert = (filterOut.alerts?.[0] || {}) as Record<string, unknown>;
    expect(String(firstAlert.alertname)).toBe('PostgresHighConnectionCount');
    expect(String(firstAlert.severity)).toBe('critical');

    // 4. summary node — raw LLM output captured. CoT preamble IS
    //    allowed here because clean_summary strips it downstream.
    const summaryOut = result.outputs.summary as { content?: string };
    expect(summaryOut).toBeDefined();
    expect(String(summaryOut.content || '').length).toBeGreaterThan(0);

    // 5. clean_summary node — preamble stripper output. MUST start
    //    with a bullet character and MUST NOT contain the seeded
    //    meta-narration preamble.
    const cleanOut = result.outputs.clean_summary as {
      clean_content?: string;
    };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    // All three alertnames must appear in the cleaned bullets.
    expect(clean).toContain('PostgresHighConnectionCount');
    expect(clean).toContain('KubeletPodCrashLooping');
    expect(clean).toContain('HarborRegistryMemoryPressure');

    // 6. report node — webhook_response HTML body. No unresolved
    //    {{...}} tokens; real markup; cleaned digest + alert table
    //    inlined; CoT preamble absent.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml).toContain('PostgresHighConnectionCount');
    expect(bodyHtml).toContain('KubeletPodCrashLooping');
    expect(bodyHtml).toContain('critical');
    // CoT preamble must NOT appear in rendered body.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // Non-empty case must NOT claim cluster is healthy.
    expect(bodyHtml).not.toMatch(/no active alerts|cluster healthy/i);
  });

  it('empty-case: cluster with zero active alerts renders a sensible "No active alerts" report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let alertsCallReceived = false;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_prometheus' &&
          body.tool === 'prometheus_alerts'
        ) {
          alertsCallReceived = true;
          return HttpResponse.json(emptyAlertsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- No active alerts detected in Prometheus — cluster is currently healthy. Recommend a routine future check in 1h.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 60, completion_tokens: 20 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('prometheus-active-alerts-digest');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { severity: 'all', limit: 5 },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');
    expect(alertsCallReceived).toBe(true);

    // alerts.content is the literal "No active alerts" string.
    const alertsOut = result.outputs.alerts as { content?: string };
    expect(String(alertsOut.content || '').trim()).toBe('No active alerts');

    // filter parses to an empty array, alert_count === 0.
    const filterOut = result.outputs.filter as {
      alerts?: unknown[];
      alert_count?: number;
    };
    expect(Array.isArray(filterOut.alerts)).toBe(true);
    expect(filterOut.alerts?.length).toBe(0);
    expect(filterOut.alert_count).toBe(0);

    // Report MUST render and MUST explicitly say "No active alerts" —
    // a blank/empty-table page is a fail.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml).toMatch(/no active alerts|cluster.*healthy|all clear/i);
  });
});
