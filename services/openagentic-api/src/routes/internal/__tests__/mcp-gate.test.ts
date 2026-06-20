/**
 * 2026-06-20 — HIGH-severity approval-gate bypass fix.
 *
 * POST /api/internal/mcp/exec is the cross-service seam the workflow engine
 * (separate openagentic-workflows service) calls BEFORE its mcp_tool node hits
 * the proxy, so a Flow's tool call runs through the SAME runAuditAndGate the
 * chat/orchestrate paths use (origin 'subagent'). These tests pin the route's
 * auth + decision contract with an injected gate worker (no DB needed).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalMcpGateRoute } from '../mcp-gate.js';

const SECRET = 'unit-test-mcp-gate-secret';

async function buildApp(opts: {
  internalSecret?: string;
  runGate: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalMcpGateRoute(app, {
    internalSecret: opts.internalSecret ?? SECRET,
    runGate: opts.runGate as any,
  });
  await app.ready();
  return app;
}

describe('POST /api/internal/mcp/exec', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when x-internal-secret header is missing', async () => {
    const runGate = vi.fn();
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      payload: { toolName: 'kubernetes_delete_pod' },
    });
    expect(res.statusCode).toBe(401);
    expect(runGate).not.toHaveBeenCalled();
  });

  it('401 when x-internal-secret value is wrong', async () => {
    const runGate = vi.fn();
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': 'nope' },
      payload: { toolName: 'kubernetes_delete_pod' },
    });
    expect(res.statusCode).toBe(401);
    expect(runGate).not.toHaveBeenCalled();
  });

  it('401 (fail-closed) when server-side secret is empty', async () => {
    const runGate = vi.fn();
    app = await buildApp({ internalSecret: '', runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': '' },
      payload: { toolName: 'kubernetes_delete_pod' },
    });
    expect(res.statusCode).toBe(401);
    expect(runGate).not.toHaveBeenCalled();
  });

  it('400 when toolName is missing', async () => {
    const runGate = vi.fn();
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': SECRET },
      payload: { serverName: 'openagentic_kubernetes' },
    });
    expect(res.statusCode).toBe(400);
    expect(runGate).not.toHaveBeenCalled();
  });

  it('blocks a MUTATING call (gate denied) and tags origin=subagent', async () => {
    const runGate = vi.fn().mockResolvedValue({
      allowed: false,
      blockReason: "Mutating tool 'kubernetes_delete_pod' denied by approval gate",
      classification: 'MUTATING',
      auditId: 'audit-1',
    });
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': SECRET, 'x-user-id': 'trent' },
      payload: {
        toolName: 'kubernetes_delete_pod',
        serverName: 'openagentic_kubernetes',
        args: { namespace: 'prod', name: 'api-0' },
        sessionId: 'exec-99',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(false);
    expect(body.classification).toBe('MUTATING');
    expect(body.blockReason).toMatch(/denied by approval gate/);

    // The gate was invoked with origin 'subagent' and the run-as user (header).
    expect(runGate).toHaveBeenCalledTimes(1);
    expect(runGate.mock.calls[0][0]).toMatchObject({
      toolName: 'kubernetes_delete_pod',
      serverName: 'openagentic_kubernetes',
      args: { namespace: 'prod', name: 'api-0' },
      origin: 'subagent',
      userId: 'trent',
      sessionId: 'exec-99',
    });
  });

  it('allows a READ call (gate auto)', async () => {
    const runGate = vi.fn().mockResolvedValue({
      allowed: true,
      classification: 'READ',
      auditId: 'audit-2',
    });
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': SECRET },
      payload: { toolName: 'kubernetes_list_pods', serverName: 'openagentic_kubernetes' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(true);
    expect(body.classification).toBe('READ');
  });

  it('FAIL SAFE: denies when the gate worker throws', async () => {
    const runGate = vi.fn().mockRejectedValue(new Error('db down'));
    app = await buildApp({ runGate });
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/mcp/exec',
      headers: { 'x-internal-secret': SECRET },
      payload: { toolName: 'aws_ec2_terminate_instances', serverName: 'openagentic_aws' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(false);
    expect(body.classification).toBe('MUTATING');
  });
});
