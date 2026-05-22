/**
 * azure-advisor-savings-report template — end-to-end harness test.
 *
 * AIOps template 9 of 10 (2026-05-13). Goal: pull Azure Advisor cost
 * recommendations for a subscription via the live openagentic_azure MCP, then
 * in ONE analyze transform: normalize the native dict, sort by parsed
 * annualSavingsAmount descending, take the top 10, compute totals
 * (rec_count, total_estimated_savings_usd), pre-compute the rows_html
 * for direct interpolation, and fold a no-recs banner. Ask the
 * platform LLM for a 3-4 bullet operator narrative focused on the top
 * 3 cost-savings actions, strip CoT preamble, and render an HTML
 * savings report via webhook_response. Empty-subscription case (zero
 * recs returned — common for small/young subs or after recent
 * remediation) renders a "No actionable cost recommendations" banner
 * instead of an empty table.
 *
 * Tool: openagentic_azure.azure_advisor_recommendations
 *   args: { subscription_id, category: 'Cost', impact?, max_results }
 *   returns native python dict: {
 *     success, subscription_id, count, filters, summary{by_category,by_impact},
 *     recommendations[]{ id, category, impact, impacted_field, impacted_value,
 *                        last_updated, short_description, solution, metadata,
 *                        extended_properties{annualSavingsAmount, savingsCurrency,
 *                                            recommendationType, fitScore, ...} },
 *     executed_as
 *   }
 *
 * Real-data discipline:
 *   - fixtures/azure_advisor_recommendations-real.json captures the canonical
 *     3-layer proxy/jsonrpc/mcp envelope wrapping the python tool's native
 *     dict with 4 representative Cost recs (VM rightsize, SQL DTU, blob tier,
 *     orphan disk) carrying annualSavingsAmount in extended_properties.
 *   - fixtures/azure_advisor_recommendations-empty.json mirrors the same
 *     envelope with zero recommendations for the empty-case test.
 *   - mockChatCompletions returns a CoT-leading 3-bullet narrative; the
 *     clean_narrative transform strips the preamble.
 *
 * The "no-perm" case (401/403 from Azure) is NOT exercised at the template
 * level — the oap-azure-mcp error_response wrapper returns
 * {success:false, error, status_code:403, hint, ...} which the
 * WorkflowExecutionEngine surfaces as a hard node_error (line ~2099 of
 * WorkflowExecutionEngine.ts), so the failure shows in the run timeline
 * with the upstream hint message. The template itself can't beautify
 * that — accept as engine-level UX, same as every other MCP-driven
 * template in the gallery.
 *
 * Per-node assertions (populated case):
 *   - recommendations: real-shape native dict with success=true, count=4,
 *     recommendations[] of length 4 with extended_properties on each.
 *   - analyze: pre-computed recs_array (sorted desc by savings), top_recs
 *     (slice of 10), rec_count, total_estimated_savings_usd, rows_html
 *     with real impacted_value names rendered, subscription_label,
 *     empty_banner = '' for populated case.
 *   - narrative: raw LLM output (CoT preamble allowed)
 *   - clean_narrative: clean_content starts with a bullet, no CoT
 *   - report: webhook_response HTML body — header + savings summary +
 *     table of recs + narrative; no unresolved {{...}} tokens; CoT absent;
 *     real resource names + savings amounts visible.
 *
 * Empty-case assertions:
 *   - analyze: rec_count === 0, total_estimated_savings_usd === 0,
 *     empty_banner is non-empty with "No actionable cost recommendations".
 *   - report HTML renders the banner and the "no recs" message — no
 *     blank table.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realAdvisorResponse from '../fixtures/azure_advisor_recommendations-real.json' assert { type: 'json' };
import emptyAdvisorResponse from '../fixtures/azure_advisor_recommendations-empty.json' assert { type: 'json' };

describe('azure-advisor-savings-report template', () => {
  it('runs end-to-end with populated Cost recommendations and renders an HTML savings report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    const calls: Array<{
      server: string;
      tool: string;
      subscription_id: string | null;
      category: string | null;
    }> = [];

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const server = String(body.server || '');
        const tool = String(body.tool || '');
        const args = body.arguments as Record<string, unknown>;
        calls.push({
          server,
          tool,
          subscription_id:
            typeof args?.subscription_id === 'string' ? args.subscription_id : null,
          category: typeof args?.category === 'string' ? args.category : null,
        });
        if (server === 'openagentic_azure' && tool === 'azure_advisor_recommendations') {
          return HttpResponse.json(realAdvisorResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${server}.${tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize the top cost-saving actions. Let me think:\n' +
        '- The highest-impact rec is vm-app-prod-01 right-sizing (Standard_D8s_v3 -> Standard_D2s_v4) — $3,120/year if you act on it; verify CPU/memory headroom against the 7-day usage Advisor scoped.\n' +
        '- db-prod-core SQL DTU scale-down (S6 -> S3) is the second-largest win at $1,440/year — pair with a brief APM check around peak hours before scaling.\n' +
        '- The blob tier change on stdataprodwus and the orphan disk-orphan-dev-001 are quick low-effort wins totaling $960/year — cool tier is a one-click change, orphan disk just needs delete approval.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 280, completion_tokens: 170 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('azure-advisor-savings-report');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {
        subscription_id: '11111111-2222-3333-4444-555555555555',
        category: 'Cost',
      },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + tool was called with the requested sub + category.
    expect(result.status).toBe('completed');
    const advisorCall = calls.find((c) => c.tool === 'azure_advisor_recommendations');
    expect(advisorCall).toBeDefined();
    expect(advisorCall?.subscription_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(advisorCall?.category).toBe('Cost');

    // 2. recommendations node — real-shape native dict (no content[]).
    const recsOut = result.outputs.recommendations as {
      success?: boolean;
      count?: number;
      subscription_id?: string;
      recommendations?: Array<Record<string, unknown>>;
    };
    expect(recsOut).toBeDefined();
    expect(recsOut.success).toBe(true);
    expect(recsOut.count).toBe(4);
    expect(Array.isArray(recsOut.recommendations)).toBe(true);
    expect(recsOut.recommendations?.length).toBe(4);

    // 3. analyze — single transform pre-computes everything.
    const analyzeOut = result.outputs.analyze as {
      subscription_label?: string;
      rec_count?: number;
      total_estimated_savings_usd?: number;
      recs_array?: Array<Record<string, unknown>>;
      top_recs?: Array<Record<string, unknown>>;
      rows_html?: string;
      empty_banner?: string;
      summary_payload?: Record<string, unknown>;
    };
    expect(analyzeOut).toBeDefined();
    expect(analyzeOut.subscription_label).toBe('11111111-2222-3333-4444-555555555555');
    expect(analyzeOut.rec_count).toBe(4);
    // Sum of the four real fixture annualSavingsAmount fields: 3120 + 1440 + 720 + 240 = 5520
    expect(analyzeOut.total_estimated_savings_usd).toBe(5520);
    expect(Array.isArray(analyzeOut.recs_array)).toBe(true);
    expect(analyzeOut.recs_array?.length).toBe(4);
    // Sorted desc by savings — first entry should be the $3,120 VM rightsize.
    const first = analyzeOut.recs_array?.[0] as Record<string, unknown>;
    expect(first?.impacted_value).toBe('vm-app-prod-01');
    // top_recs slice present and bounded.
    expect(Array.isArray(analyzeOut.top_recs)).toBe(true);
    expect(analyzeOut.top_recs?.length).toBe(4);
    const rows = String(analyzeOut.rows_html || '');
    expect(rows).toContain('<tr');
    expect(rows).toContain('vm-app-prod-01');
    expect(rows).toContain('db-prod-core');
    expect(rows).toContain('stdataprodwus');
    expect(rows).toContain('disk-orphan-dev-001');
    // Locale-formatted USD ($3,120 from Number.toLocaleString) — exercises the en-US formatter.
    expect(rows).toMatch(/\$3,120/);
    // Populated case — banner should be empty.
    expect(String(analyzeOut.empty_banner || '')).toBe('');

    // 4. narrative — raw LLM output captured.
    const narrativeOut = result.outputs.narrative as { content?: string };
    expect(narrativeOut).toBeDefined();
    expect(String(narrativeOut.content || '').length).toBeGreaterThan(0);

    // 5. clean_narrative — preamble stripper.
    const cleanOut = result.outputs.clean_narrative as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);

    // 6. report — webhook_response HTML. No unresolved {{...}} tokens.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Per-rec visible.
    expect(bodyHtml).toContain('vm-app-prod-01');
    expect(bodyHtml).toContain('db-prod-core');
    expect(bodyHtml).toContain('stdataprodwus');
    expect(bodyHtml).toContain('disk-orphan-dev-001');
    // Aggregate savings number rendered somewhere.
    expect(bodyHtml).toMatch(/5,?520/);
    // CoT preamble must NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // Subscription id rendered.
    expect(bodyHtml).toContain('11111111-2222-3333-4444-555555555555');
  });

  it('empty-subscription case: zero recommendations renders a sensible no-recs banner', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.server === 'openagentic_azure' && body.tool === 'azure_advisor_recommendations') {
          return HttpResponse.json(emptyAdvisorResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- No actionable Azure Advisor cost recommendations were found for subscription 99999999-8888-7777-6666-555555555555.\n' +
        '- This usually means either the subscription is small / young enough that Advisor has not yet generated cost findings, or the workloads have already been right-sized — schedule a re-check in 14 days.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 90, completion_tokens: 50 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('azure-advisor-savings-report');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {
        subscription_id: '99999999-8888-7777-6666-555555555555',
        category: 'Cost',
      },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    const analyzeOut = result.outputs.analyze as {
      subscription_label?: string;
      rec_count?: number;
      total_estimated_savings_usd?: number;
      empty_banner?: string;
    };
    expect(analyzeOut.subscription_label).toBe('99999999-8888-7777-6666-555555555555');
    expect(analyzeOut.rec_count).toBe(0);
    expect(analyzeOut.total_estimated_savings_usd).toBe(0);
    const banner = String(analyzeOut.empty_banner || '');
    expect(banner.length).toBeGreaterThan(0);
    expect(banner.toLowerCase()).toMatch(/no\s+actionable|no\s+cost\s+recommendations/);

    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml.toLowerCase()).toMatch(/no\s+actionable|no\s+cost\s+recommendations/);
    expect(bodyHtml).toContain('99999999-8888-7777-6666-555555555555');
  });
});
