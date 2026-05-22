/**
 * azure-security-posture-snapshot template — end-to-end harness test.
 *
 * AIOps template 10 of 10 (2026-05-14). Goal: snapshot a subscription's
 * Microsoft Defender for Cloud security posture by pulling the overall
 * secure score (azure_security_secure_score) and the active assessments
 * (azure_security_list_assessments) in parallel via the live openagentic_azure
 * MCP. The analyze transform classifies each finding by severity (High >
 * Medium > Low), sorts unhealthy findings descending, takes the top 10,
 * pre-computes the rows_html for direct interpolation, computes the
 * severity_summary roll-up + empty_banner, and shapes a summary_payload
 * for the LLM. The platform LLM writes a 3-4 bullet operator narrative
 * on the top posture concerns ordered by severity, CoT preamble is
 * stripped via clean_narrative, and a webhook_response renders the
 * HTML posture report. Empty-subscription case (no Defender enrollment
 * or fully clean posture — common for small/young subs) renders a
 * "No unhealthy security assessments" banner instead of an empty table.
 *
 * Tools:
 *   openagentic_azure.azure_security_secure_score(subscription_id)
 *     -> { success, subscription_id, count, secure_scores[]{name, id,
 *           display_name, current, max, percentage, weight}, executed_as }
 *   openagentic_azure.azure_security_list_assessments(subscription_id)
 *     -> { success, subscription_id, count, assessments[]{name, id,
 *           display_name, status, severity, description, categories},
 *           executed_as }
 *
 * Real-data discipline:
 *   - fixtures/azure_security_secure_score-real.json + ...-empty.json
 *   - fixtures/azure_security_list_assessments-real.json (5 representative
 *     findings: 2 High, 2 Medium, 1 Low — public storage, missing MFA,
 *     unencrypted SQL, SSH exposure, HTTP-only web app) + ...-empty.json
 *   - mockChatCompletions returns a CoT-leading 4-bullet narrative; the
 *     clean_narrative transform strips the preamble.
 *
 * The "no-perm" case (401/403 from Azure) is not exercised at the
 * template level — same engine-level UX as every other MCP-driven template.
 *
 * Per-node assertions (populated case):
 *   - secure_score: real-shape native dict with one 'ascScore' entry
 *     at 62% (current=31, max=50).
 *   - assessments: real-shape native dict with success=true, count=5,
 *     assessments[] of length 5.
 *   - analyze: secure_score_pct=62.0, finding_count=5,
 *     severity_summary={High:2, Medium:2, Low:1, Other:0},
 *     assessments_array sorted by severity rank (High first),
 *     top_findings=slice(10), rows_html with display_names rendered,
 *     subscription_label='11111111-...', empty_banner=''.
 *   - narrative: raw LLM output (CoT preamble allowed)
 *   - clean_narrative: clean_content starts with a bullet, no CoT
 *   - report: webhook_response HTML body with header + posture summary
 *     + findings table + narrative; no unresolved {{...}} tokens.
 *
 * Empty-case assertions:
 *   - secure_score: empty secure_scores[].
 *   - assessments: empty assessments[].
 *   - analyze: finding_count=0, secure_score_pct=null,
 *     empty_banner non-empty with "no unhealthy" text.
 *   - report HTML renders the banner — no blank table.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realSecureScoreResponse from '../fixtures/azure_security_secure_score-real.json' assert { type: 'json' };
import realAssessmentsResponse from '../fixtures/azure_security_list_assessments-real.json' assert { type: 'json' };
import emptySecureScoreResponse from '../fixtures/azure_security_secure_score-empty.json' assert { type: 'json' };
import emptyAssessmentsResponse from '../fixtures/azure_security_list_assessments-empty.json' assert { type: 'json' };

describe('azure-security-posture-snapshot template', () => {
  it('runs end-to-end with populated Defender findings and renders an HTML posture report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    const calls: Array<{
      server: string;
      tool: string;
      subscription_id: string | null;
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
        });
        if (server === 'openagentic_azure' && tool === 'azure_security_secure_score') {
          return HttpResponse.json(realSecureScoreResponse);
        }
        if (server === 'openagentic_azure' && tool === 'azure_security_list_assessments') {
          return HttpResponse.json(realAssessmentsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${server}.${tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize the top security posture concerns. Let me think:\n' +
        '- The highest-severity finding is "Storage accounts should restrict network access" (High) — at least one storage account allows internet access; bind it to a private endpoint or service endpoint immediately.\n' +
        '- "MFA should be enabled for accounts with owner permissions on your subscription" is the second High-severity concern — enroll all subscription owners in MFA via Entra ID Conditional Access before any policy rollout.\n' +
        '- The remaining 3 findings (TDE on SQL, JIT on VM management ports, HTTPS-only on web app) are Medium/Low — pair the TDE + JIT enablement with the next maintenance window; the HTTPS-only flip is a one-click toggle.\n' +
        '- The 62% secure score leaves significant headroom; closing the two High findings alone should lift it materially.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 320, completion_tokens: 200 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('azure-security-posture-snapshot');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {
        subscription_id: '11111111-2222-3333-4444-555555555555',
      },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level + both MCP tools were called with the requested sub.
    expect(result.status).toBe('completed');
    const scoreCall = calls.find((c) => c.tool === 'azure_security_secure_score');
    const assessmentsCall = calls.find((c) => c.tool === 'azure_security_list_assessments');
    expect(scoreCall).toBeDefined();
    expect(assessmentsCall).toBeDefined();
    expect(scoreCall?.subscription_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(assessmentsCall?.subscription_id).toBe('11111111-2222-3333-4444-555555555555');

    // 2. secure_score node — real-shape native dict.
    const scoreOut = result.outputs.secure_score as {
      success?: boolean;
      count?: number;
      secure_scores?: Array<Record<string, unknown>>;
    };
    expect(scoreOut).toBeDefined();
    expect(scoreOut.success).toBe(true);
    expect(scoreOut.count).toBe(1);
    expect(Array.isArray(scoreOut.secure_scores)).toBe(true);

    // 3. assessments node — real-shape native dict with 5 findings.
    const assessOut = result.outputs.assessments as {
      success?: boolean;
      count?: number;
      assessments?: Array<Record<string, unknown>>;
    };
    expect(assessOut).toBeDefined();
    expect(assessOut.success).toBe(true);
    expect(assessOut.count).toBe(5);
    expect(Array.isArray(assessOut.assessments)).toBe(true);
    expect(assessOut.assessments?.length).toBe(5);

    // 4. analyze — single transform pre-computes everything.
    const analyzeOut = result.outputs.analyze as {
      subscription_label?: string;
      secure_score_pct?: number | null;
      finding_count?: number;
      severity_summary?: { High?: number; Medium?: number; Low?: number; Other?: number };
      assessments_array?: Array<Record<string, unknown>>;
      top_findings?: Array<Record<string, unknown>>;
      rows_html?: string;
      empty_banner?: string;
      summary_payload?: Record<string, unknown>;
    };
    expect(analyzeOut).toBeDefined();
    expect(analyzeOut.subscription_label).toBe('11111111-2222-3333-4444-555555555555');
    // percentage 0.62 -> 62.0%
    expect(analyzeOut.secure_score_pct).toBe(62);
    expect(analyzeOut.finding_count).toBe(5);
    expect(analyzeOut.severity_summary).toMatchObject({ High: 2, Medium: 2, Low: 1 });
    // Sorted desc by severity — first entry MUST be a High-severity finding.
    expect(Array.isArray(analyzeOut.assessments_array)).toBe(true);
    expect(analyzeOut.assessments_array?.length).toBe(5);
    const first = analyzeOut.assessments_array?.[0] as Record<string, unknown>;
    expect(String(first?.severity)).toBe('High');
    // top_findings slice present + bounded.
    expect(Array.isArray(analyzeOut.top_findings)).toBe(true);
    expect(analyzeOut.top_findings?.length).toBe(5);
    const rows = String(analyzeOut.rows_html || '');
    expect(rows).toContain('<tr');
    expect(rows).toContain('Storage accounts should restrict network access');
    expect(rows).toContain('MFA should be enabled for accounts');
    expect(rows).toContain('Transparent Data Encryption');
    expect(rows).toContain('just-in-time network access');
    expect(rows).toContain('only be accessible over HTTPS');
    // Populated case — banner should be empty.
    expect(String(analyzeOut.empty_banner || '')).toBe('');

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
    // Per-finding visible.
    expect(bodyHtml).toContain('Storage accounts should restrict network access');
    expect(bodyHtml).toContain('MFA should be enabled');
    expect(bodyHtml).toContain('Transparent Data Encryption');
    // Secure score percentage rendered.
    expect(bodyHtml).toContain('62');
    // High count rendered.
    expect(bodyHtml).toMatch(/High:.{0,30}2/);
    // CoT preamble must NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // Subscription id rendered.
    expect(bodyHtml).toContain('11111111-2222-3333-4444-555555555555');
  });

  it('empty-subscription case: zero unhealthy assessments renders a sensible no-findings banner', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.server === 'openagentic_azure' && body.tool === 'azure_security_secure_score') {
          return HttpResponse.json(emptySecureScoreResponse);
        }
        if (body.server === 'openagentic_azure' && body.tool === 'azure_security_list_assessments') {
          return HttpResponse.json(emptyAssessmentsResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- No unhealthy Defender for Cloud assessments were found for subscription 99999999-8888-7777-6666-555555555555.\n' +
        '- Confirm that Defender for Cloud plans are enrolled on this subscription — empty assessments combined with a missing secure score usually means the plan was never activated.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 90, completion_tokens: 60 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('azure-security-posture-snapshot');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {
        subscription_id: '99999999-8888-7777-6666-555555555555',
      },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    const analyzeOut = result.outputs.analyze as {
      subscription_label?: string;
      secure_score_pct?: number | null;
      finding_count?: number;
      empty_banner?: string;
    };
    expect(analyzeOut.subscription_label).toBe('99999999-8888-7777-6666-555555555555');
    expect(analyzeOut.finding_count).toBe(0);
    // Empty secure_scores -> pct is null.
    expect(analyzeOut.secure_score_pct).toBeNull();
    const banner = String(analyzeOut.empty_banner || '');
    expect(banner.length).toBeGreaterThan(0);
    expect(banner.toLowerCase()).toMatch(/no unhealthy|no security assessments|no unhealthy security/);

    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml.toLowerCase()).toMatch(/no unhealthy|no security assessments/);
    expect(bodyHtml).toContain('99999999-8888-7777-6666-555555555555');
  });
});
