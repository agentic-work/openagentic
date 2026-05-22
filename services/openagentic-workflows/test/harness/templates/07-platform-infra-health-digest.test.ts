/**
 * platform-infra-health-digest template — end-to-end harness test.
 *
 * AIOps template 7 of 10 (2026-05-13). Goal: pull health of the four
 * platform data services (PostgreSQL, Redis, Milvus) in parallel via
 * openagentic_admin.admin_system_<svc>_health_check, normalize the per-service
 * native-dict response shapes (Dict[str, Any] → FastMCP-serialized JSON
 * text via the mcp-proxy content-block joiner), pre-compute per-service
 * status rows + an overall_status flag in a single analyze transform,
 * ask the platform LLM for a 2-3 bullet narrative highlighting any
 * degraded service (or stating "all healthy" concisely if all are up),
 * strip CoT preamble via clean_narrative, render an HTML digest via
 * webhook_response with per-service cards + narrative + raw payloads.
 *
 * Real-data discipline:
 *   - fixtures/admin_postgres_health-healthy.json captures the canonical
 *     3-layer proxy/jsonrpc/mcp envelope wrapping the python tool's
 *     native Dict[str, Any] (services/mcps/oap-admin-mcp/src/admin_mcp_server/server.py
 *     lines 353-387). FastMCP serializes the dict as content[{type:'text',
 *     text: <json-string>}]. The workflow engine's content-block joiner
 *     (WorkflowExecutionEngine.ts lines 2108-2116) collapses to a single
 *     `content` string the analyze transform JSON.parse-s back out.
 *   - fixtures/admin_redis_health-healthy.json + admin_milvus_health-healthy.json
 *     mirror the same envelope pattern for the other two services.
 *   - fixtures/admin_redis_health-degraded.json captures the exception
 *     path (success=false, healthy=false, message='Redis connection
 *     failed: ...') used by the degraded-case test.
 *   - mockChatCompletions returns a CoT-leading 2-3 bullet narrative;
 *     the clean_narrative transform strips the preamble.
 *
 * Per-node assertions (all-healthy case):
 *   - postgres_health: real-shape FastMCP content JSON string with
 *     success:true, healthy:true, version, table_count, database_size_mb
 *   - redis_health:  real-shape FastMCP content JSON string with
 *     success:true, healthy:true, message
 *   - milvus_health: real-shape FastMCP content JSON string with
 *     success:true, healthy:true, details.collection_count
 *   - merge_health: labeled object with postgres_health/redis_health/
 *     milvus_health keys (per the engine's snake-case label coercion
 *     in executeMergeNode lines 3460-3471)
 *   - analyze: normalized per_service array of {name, status, message,
 *     extras} + overall_status === 'healthy' + healthy_count===3 +
 *     degraded_count===0 + rows_html pre-computed
 *   - narrative: raw LLM output (CoT preamble allowed)
 *   - clean_narrative: clean_content starts with a bullet, no CoT
 *   - report: webhook_response HTML body — per-service cards + cleaned
 *     narrative; no unresolved {{...}} tokens; CoT absent
 *
 * Degraded-case assertions (second `it` block):
 *   - redis_health: content has success:false, healthy:false
 *   - analyze: overall_status === 'degraded' + degraded_count === 1
 *   - report HTML highlights Redis as degraded with the connection-
 *     failed message visible
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { loadTemplate } from './_helpers.js';
import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';
import postgresHealthyResponse from '../fixtures/admin_postgres_health-healthy.json' assert { type: 'json' };
import redisHealthyResponse from '../fixtures/admin_redis_health-healthy.json' assert { type: 'json' };
import milvusHealthyResponse from '../fixtures/admin_milvus_health-healthy.json' assert { type: 'json' };
import redisDegradedResponse from '../fixtures/admin_redis_health-degraded.json' assert { type: 'json' };
import postgresRealRemoteDegraded from '../fixtures/admin_postgres_health-real-remote.json' assert { type: 'json' };
import redisRealRemoteHealthy from '../fixtures/admin_redis_health-real-remote.json' assert { type: 'json' };
import milvusRealRemoteHealthy from '../fixtures/admin_milvus_health-real-remote.json' assert { type: 'json' };

describe('platform-infra-health-digest template', () => {
  it('runs end-to-end with all-healthy data services and renders an HTML digest', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    const calls: Array<{ server: string; tool: string }> = [];

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const server = String(body.server || '');
        const tool = String(body.tool || '');
        calls.push({ server, tool });
        if (server === 'openagentic_admin' && tool === 'admin_system_postgres_health_check') {
          return HttpResponse.json(postgresHealthyResponse);
        }
        if (server === 'openagentic_admin' && tool === 'admin_system_redis_health_check') {
          return HttpResponse.json(redisHealthyResponse);
        }
        if (server === 'openagentic_admin' && tool === 'admin_system_milvus_health_check') {
          return HttpResponse.json(milvusHealthyResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${server}.${tool}` } },
          { status: 200 },
        );
      }),
    );

    // LLM mock — CoT preamble + 2-bullet all-healthy narrative. The
    // downstream clean_narrative stripper must remove the preamble so
    // the rendered HTML contains ONLY the bullets.
    const { handler: llmHandler } = mockChatCompletions({
      content:
        'The user wants me to summarize platform infra health. Let me think:\n' +
        '- All three platform data services are reporting healthy: PostgreSQL (64 tables, 187MB), Redis (responding to PING), and Milvus (12 collections registered). No operator action required.\n' +
        '- Recommend a routine future health check in 1h to verify the cluster stays in this state.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 200, completion_tokens: 120 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('platform-infra-health-digest');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    // 1. Top-level — all three health calls fired.
    expect(result.status).toBe('completed');
    const pgCall = calls.find((c) => c.tool === 'admin_system_postgres_health_check');
    const rdCall = calls.find((c) => c.tool === 'admin_system_redis_health_check');
    const mvCall = calls.find((c) => c.tool === 'admin_system_milvus_health_check');
    expect(pgCall).toBeDefined();
    expect(rdCall).toBeDefined();
    expect(mvCall).toBeDefined();
    expect(pgCall?.server).toBe('openagentic_admin');
    expect(rdCall?.server).toBe('openagentic_admin');
    expect(mvCall?.server).toBe('openagentic_admin');

    // 2. Per-service health nodes — real-shape FastMCP content JSON
    //    strings (FastMCP wraps the python Dict return as a single
    //    text content block; the engine joins to one `content` string).
    const pgOut = result.outputs.postgres_health as { content?: string };
    const rdOut = result.outputs.redis_health as { content?: string };
    const mvOut = result.outputs.milvus_health as { content?: string };
    expect(pgOut).toBeDefined();
    expect(rdOut).toBeDefined();
    expect(mvOut).toBeDefined();
    const pgJson = JSON.parse(String(pgOut.content || '{}'));
    const rdJson = JSON.parse(String(rdOut.content || '{}'));
    const mvJson = JSON.parse(String(mvOut.content || '{}'));
    expect(pgJson.healthy).toBe(true);
    expect(rdJson.healthy).toBe(true);
    expect(mvJson.healthy).toBe(true);
    expect(typeof pgJson.version).toBe('string');
    expect(pgJson.table_count).toBeGreaterThan(0);
    expect(mvJson.details.collection_count).toBeGreaterThan(0);

    // 3. merge_health node — labeled object with the three branches
    //    keyed by snake-cased source-node label (per engine
    //    executeMergeNode lines 3460-3471). Each branch carries the
    //    FastMCP content string back to the analyze transform.
    const mergeOut = result.outputs.merge_health as Record<string, unknown>;
    expect(mergeOut).toBeDefined();
    expect(mergeOut.postgres_health).toBeDefined();
    expect(mergeOut.redis_health).toBeDefined();
    expect(mergeOut.milvus_health).toBeDefined();

    // 4. analyze node — normalized per-service shape + overall flag +
    //    pre-computed rows_html for direct interpolation in the
    //    report seam.
    const analyzeOut = result.outputs.analyze as {
      per_service?: Array<{ name: string; status: string; message?: string }>;
      overall_status?: string;
      healthy_count?: number;
      degraded_count?: number;
      rows_html?: string;
    };
    expect(analyzeOut).toBeDefined();
    expect(Array.isArray(analyzeOut.per_service)).toBe(true);
    expect(analyzeOut.per_service?.length).toBe(3);
    expect(analyzeOut.overall_status).toBe('healthy');
    expect(analyzeOut.healthy_count).toBe(3);
    expect(analyzeOut.degraded_count).toBe(0);
    const services = analyzeOut.per_service || [];
    const pgSvc = services.find((s) => s.name === 'postgres');
    const rdSvc = services.find((s) => s.name === 'redis');
    const mvSvc = services.find((s) => s.name === 'milvus');
    expect(pgSvc?.status).toBe('healthy');
    expect(rdSvc?.status).toBe('healthy');
    expect(mvSvc?.status).toBe('healthy');
    const rowsHtml = String(analyzeOut.rows_html || '');
    expect(rowsHtml).toContain('<tr');
    expect(rowsHtml.toLowerCase()).toContain('postgres');
    expect(rowsHtml.toLowerCase()).toContain('redis');
    expect(rowsHtml.toLowerCase()).toContain('milvus');

    // 5. narrative node — raw LLM output captured.
    const narrativeOut = result.outputs.narrative as { content?: string };
    expect(narrativeOut).toBeDefined();
    expect(String(narrativeOut.content || '').length).toBeGreaterThan(0);

    // 6. clean_narrative node — preamble stripper.
    const cleanOut = result.outputs.clean_narrative as { clean_content?: string };
    expect(cleanOut).toBeDefined();
    const clean = String(cleanOut.clean_content || '');
    expect(clean.length).toBeGreaterThan(0);
    expect(clean).not.toMatch(
      /^(The user wants|Let me think|Let me reason|First, I need|I'll generate|Here's how|Okay,|Sure,|Here is)/i,
    );
    expect(clean.startsWith('-')).toBe(true);

    // 7. report node — webhook_response HTML body. No unresolved
    //    {{...}} tokens; real markup; cards + cleaned narrative
    //    inlined; CoT preamble absent.
    const reportOut = result.outputs.report as { body?: string };
    expect(reportOut).toBeDefined();
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).toMatch(/<h2|<div|<table|<pre/);
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml.toLowerCase()).toContain('postgres');
    expect(bodyHtml.toLowerCase()).toContain('redis');
    expect(bodyHtml.toLowerCase()).toContain('milvus');
    // CoT preamble MUST NOT appear.
    expect(bodyHtml).not.toMatch(/Let me think/i);
    expect(bodyHtml).not.toMatch(/The user wants/i);
    // All-healthy case should explicitly flag "healthy" / "all" status.
    expect(bodyHtml.toLowerCase()).toMatch(/healthy|all\s+services/);
  });

  it('degraded-case: when Redis health-check returns healthy=false the report flags it explicitly', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_postgres_health_check') {
          return HttpResponse.json(postgresHealthyResponse);
        }
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_redis_health_check') {
          return HttpResponse.json(redisDegradedResponse);
        }
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_milvus_health_check') {
          return HttpResponse.json(milvusHealthyResponse);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- Redis is DEGRADED: the openagentic_admin health-check returned a connection-refused error against redis-master.agentic-dev.svc.cluster.local:6379. Check the redis-master-0 pod status and the StatefulSet PVC.\n' +
        '- PostgreSQL and Milvus remain healthy — no action required for those services.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 220, completion_tokens: 90 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('platform-infra-health-digest');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    // redis_health node MUST carry the degraded payload.
    const rdOut = result.outputs.redis_health as { content?: string };
    const rdJson = JSON.parse(String(rdOut.content || '{}'));
    expect(rdJson.healthy).toBe(false);
    expect(String(rdJson.message)).toMatch(/Redis connection failed|connection refused/i);

    // analyze: overall_status === 'degraded' + degraded_count === 1.
    const analyzeOut = result.outputs.analyze as {
      overall_status?: string;
      degraded_count?: number;
      healthy_count?: number;
      per_service?: Array<{ name: string; status: string }>;
    };
    expect(analyzeOut.overall_status).toBe('degraded');
    expect(analyzeOut.degraded_count).toBe(1);
    expect(analyzeOut.healthy_count).toBe(2);
    const services = analyzeOut.per_service || [];
    const rdSvc = services.find((s) => s.name === 'redis');
    expect(rdSvc?.status).toBe('unhealthy');

    // Report HTML must flag Redis as the degraded service.
    const reportOut = result.outputs.report as { body?: string };
    const bodyHtml = String(reportOut.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml.toLowerCase()).toMatch(/redis/);
    expect(bodyHtml.toLowerCase()).toMatch(/degraded|unhealthy|connection refused|failed/);
  });

  it('real-remote shape: openagentic_admin remote-transport mixed python-repr + JSON content parses correctly', async () => {
    // Captured live 2026-05-13 from chat-dev: the openagentic_admin remote MCP
    // returns content as a python list-of-tuples repr STRING concatenated
    // with an embedded { "result": {...} } JSON block at the same level.
    // The analyze transform's extract() helper must find the embedded
    // result-block and parse healthy/message out of it. This regression
    // pins the live-cluster shape so a future openagentic-admin server update
    // that normalizes the envelope back to standard FastMCP would land
    // here first.
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_postgres_health_check') {
          return HttpResponse.json(postgresRealRemoteDegraded);
        }
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_redis_health_check') {
          return HttpResponse.json(redisRealRemoteHealthy);
        }
        if (body.server === 'openagentic_admin' && body.tool === 'admin_system_milvus_health_check') {
          return HttpResponse.json(milvusRealRemoteHealthy);
        }
        return HttpResponse.json(
          { error: { code: -32601, message: `unknown ${body.server}.${body.tool}` } },
          { status: 200 },
        );
      }),
    );

    const { handler: llmHandler } = mockChatCompletions({
      content:
        '- postgres is DEGRADED: PostgreSQL connection not available from the openagentic-admin pod. Check NetworkPolicy + postgresql.agentic-dev.svc.cluster.local DNS resolution from the openagentic-admin namespace.\n' +
        '- redis and milvus are healthy.',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 220, completion_tokens: 90 },
    });
    harnessServer.use(llmHandler);

    const tpl = loadTemplate('platform-infra-health-digest');
    const result = await runFlow({
      flow: tpl.definition as Parameters<typeof runFlow>[0]['flow'],
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.harness.jwt' },
    });

    expect(result.status).toBe('completed');

    // analyze must correctly classify postgres=unhealthy, redis/milvus=healthy
    // by extracting the embedded {"result": {...}} block from the
    // python-repr content string.
    const analyzeOut = result.outputs.analyze as {
      per_service?: Array<{ name: string; status: string; message: string; extras: Record<string, unknown> }>;
      overall_status?: string;
      degraded_count?: number;
      healthy_count?: number;
    };
    expect(analyzeOut).toBeDefined();
    expect(analyzeOut.overall_status).toBe('degraded');
    expect(analyzeOut.healthy_count).toBe(2);
    expect(analyzeOut.degraded_count).toBe(1);
    const services = analyzeOut.per_service || [];
    const pgSvc = services.find((s) => s.name === 'postgres');
    const rdSvc = services.find((s) => s.name === 'redis');
    const mvSvc = services.find((s) => s.name === 'milvus');
    expect(pgSvc?.status).toBe('unhealthy');
    expect(pgSvc?.message).toMatch(/PostgreSQL connection not available/);
    expect(rdSvc?.status).toBe('healthy');
    expect(rdSvc?.message).toMatch(/Redis connection is healthy/);
    expect(mvSvc?.status).toBe('healthy');
    expect(mvSvc?.message).toMatch(/Milvus connection is healthy/);
    expect(mvSvc?.extras.collection_count).toBe(9);

    // Report renders with postgres flagged
    const reportOut = result.outputs.report as { body?: string };
    const bodyHtml = String(reportOut?.body || '');
    expect(bodyHtml).toContain('<');
    expect(bodyHtml).not.toMatch(/\{\{[^}]+\}\}/);
    expect(bodyHtml.toLowerCase()).toContain('postgres');
    expect(bodyHtml).toMatch(/PostgreSQL connection not available|degraded/);
  });
});
