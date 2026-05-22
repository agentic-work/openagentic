/**
 * loki-error-log-research-report template — end-to-end harness test.
 *
 * Real-data discipline (2026-05-13 user directive: "add a loki lookup error
 * logs and web_search_research one that allows a flow to read loki logs for
 * the day and search on the summary of them and present a report on issues"):
 *   - fixtures/loki_search_errors-real.json captures the canonical mcp-proxy
 *     /call envelope for openagentic_loki.loki_search_errors. The wrapped FastMCP
 *     content[0].text is the multi-line formatted error report string the
 *     python tool emits verbatim (server.py loki_search_errors lines 286-361).
 *     Real recurring cluster errors are present: postgres missing-relation
 *     drift (UserMemoryEntry, admin.user_context_index), milvus collection
 *     not-found (agents collection), mcp-proxy access-policy fetch fails.
 *   - fixtures/web_search-real.json captures the openagentic_web.web_search dict
 *     wrapped through FastMCP — real SearXNG result shape with 4 hits for a
 *     plausible P2021/relation-missing AIOps research query.
 *   - mockChatCompletions emits the OpenAI SSE stream the streaming
 *     llm_completion executor reads. The completion text is a 3-bullet
 *     summary of distinct error PATTERNS (not raw log lines) extracted from
 *     the loki text by the upstream transform — exercises the
 *     parse-text-then-summarize chain, which is the whole point of this
 *     template.
 *
 * Per-node assertions:
 *   - loki_logs returns the FastMCP-joined `content` string with the real
 *     "=== Error Log Search Results ===" header + ERROR section + log lines.
 *   - extract_patterns transform pulls distinct error patterns out of that
 *     text (deduped by signature; counts attached). Expect at least 3.
 *   - summary text on-topic referencing real patterns; NO CoT preamble.
 *   - clean_summary stripper output starts with a bullet.
 *   - web_research returns the structured SearXNG hits array.
 *   - report HTML inlines summary + research links + raw pattern counts;
 *     zero unsubstituted {{...}} tokens.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import realLokiResponse from '../fixtures/loki_search_errors-real.json' assert { type: 'json' };
import realWebSearchResponse from '../fixtures/web_search-real.json' assert { type: 'json' };

describe('loki-error-log-research-report template', () => {
  it('runs end-to-end with real-shape loki + web_search data and renders an HTML AIOps research report', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let lokiCallReceived = false;
    let webSearchCallReceived = false;

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (
          body.server === 'openagentic_loki' &&
          body.tool === 'loki_search_errors'
        ) {
          lokiCallReceived = true;
          return HttpResponse.json(realLokiResponse);
        }
        if (
          (body.server === 'openagentic_web' || body.tool === 'web_search') &&
          body.tool === 'web_search'
        ) {
          webSearchCallReceived = true;
          return HttpResponse.json(realWebSearchResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    // LLM completion mock — emits a 3-bullet pattern summary that DELIBERATELY
    // leads with a CoT preamble so the downstream `clean_summary` transform's
    // strip is exercised. Without that strip, the preamble would leak into the
    // rendered HTML report.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        "Let me think about this. The user wants a summary of error patterns. Here are the key issues:\n" +
        "- postgresql ERROR relation \"UserMemoryEntry\" does not exist — likely Prisma migration drift (P2021); needs prisma migrate deploy.\n" +
        "- milvus collection not found[database=default][collection=agents] — vector store missing the agents collection; bootstrap seed gap.\n" +
        "- mcp-proxy Failed to fetch access policies for group system-admins — invalid policy URL configuration, missing http:// scheme.",
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 180, completion_tokens: 120 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('loki-error-log-research-report');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: { namespace: 'agentic-dev', time_range: '24h' },
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level: completed, both MCP calls happened.
    expect(result.status).toBe('completed');
    expect(lokiCallReceived).toBe(true);
    expect(webSearchCallReceived).toBe(true);

    // 2. loki_logs node — real-shape FastMCP envelope reached the output map.
    //    The mcp_tool joiner collapses content[].text into a single `content`
    //    string. We expect the formatted "=== Error Log Search Results ==="
    //    header + ERROR section + real log lines.
    const lokiOut = result.outputs.loki_logs as { content?: string };
    expect(lokiOut).toBeDefined();
    const lokiText = String(lokiOut.content || '');
    expect(lokiText).toContain('Error Log Search Results');
    expect(lokiText).toContain('Total errors found');
    expect(lokiText).toContain('postgresql-0');
    expect(lokiText).toContain('UserMemoryEntry');
    expect(lokiText).toContain('collection not found');
    expect(lokiText).toContain('mcp-proxy');

    // 3. extract_patterns node — distinct pattern extraction from the text.
    //    The transform parses the multi-line text, signature-buckets similar
    //    lines, and emits a structured array of { signature, count, sample }.
    const patternsOut = result.outputs.extract_patterns as {
      patterns?: Array<{ signature: string; count: number; sample: string }>;
      total_errors?: number;
      namespace_label?: string;
    };
    expect(patternsOut).toBeDefined();
    expect(Array.isArray(patternsOut.patterns)).toBe(true);
    expect((patternsOut.patterns || []).length).toBeGreaterThanOrEqual(3);
    expect((patternsOut.patterns || []).length).toBeLessThanOrEqual(5);
    expect(patternsOut.total_errors).toBeGreaterThan(0);
    expect(patternsOut.namespace_label).toBe('agentic-dev');
    // Each pattern carries a non-empty signature + a real sample log line.
    for (const p of patternsOut.patterns || []) {
      expect(typeof p.signature).toBe('string');
      expect(p.signature.length).toBeGreaterThan(0);
      expect(typeof p.count).toBe('number');
      expect(p.count).toBeGreaterThanOrEqual(1);
      expect(typeof p.sample).toBe('string');
      expect(p.sample.length).toBeGreaterThan(0);
    }

    // 4. summary node — raw LLM output captured. CoT preamble IS allowed
    //    here because the downstream `clean_summary` strips it.
    const summaryOut = result.outputs.summary as { content?: string };
    expect(summaryOut).toBeDefined();
    expect(String(summaryOut.content || '').length).toBeGreaterThan(0);

    // 5. clean_summary node — preamble stripper output. MUST start with a
    //    bullet character and MUST NOT contain the leading meta-narration.
    const cleanOut = result.outputs.clean_summary as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);
    expect(clean).toContain('UserMemoryEntry');
    expect(clean).toContain('collection');

    // 6. web_research node — JSON-stringified SearXNG dict surfaced as
    //    content. The mcp_tool joiner collapses content[].text into a
    //    single string, which downstream parses or inlines as-is.
    const researchOut = result.outputs.web_research as { content?: string };
    expect(researchOut).toBeDefined();
    const researchText = String(researchOut.content || '');
    expect(researchText).toContain('prisma.io');
    expect(researchText).toContain('P2021');
    expect(researchText).toContain('relation does not exist');

    // 7. report node — HTML rendered through webhook_response. Body must
    //    contain real markup, the cleaned summary, links from web research,
    //    and zero unresolved {{...}} tokens.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    // Cleaned summary must inline.
    expect(bodyHtml).toContain('UserMemoryEntry');
    // At least one real research link must inline (prisma docs URL).
    expect(bodyHtml).toContain('prisma.io');
    // CoT preamble must NOT appear anywhere in the rendered body.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
  });
});
