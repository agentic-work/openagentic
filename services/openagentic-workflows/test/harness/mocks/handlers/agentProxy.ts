/**
 * MSW handler factory for openagentic-proxy /api/agents/execute-sync.
 *
 * 14 harness tests stub this endpoint with the same shape. The factory
 * collapses the boilerplate while still letting tests assert on the
 * inbound wire payload via the returned `captured` object.
 *
 * Usage:
 *   const { handler, captured } = mockOpenAgenticProxyExecuteSync({
 *     results: [{ agentId: 'a', role: 'reasoning', status: 'completed', content: '...' }],
 *     output: 'merged content',
 *     metrics: { totalTokens: 42 },
 *   });
 *   harnessServer.use(handler);
 *   // ... run flow ...
 *   expect(captured.role).toBe('reasoning');
 *
 * `output` defaults to the first result's `content` when not supplied.
 */

import { http, HttpResponse } from 'msw';

export interface AgentResult {
  agentId?: string;
  role?: string;
  status?: string;
  content?: string;
  [key: string]: unknown;
}

export interface OpenAgenticProxyMockOptions {
  /** Results array returned by openagentic-proxy. */
  results: AgentResult[];
  /** Aggregated output string. Defaults to results[0].content. */
  output?: string;
  /** Top-level status. Defaults to 'completed'. */
  status?: string;
  /** Metrics roll-up returned by openagentic-proxy. */
  metrics?: Record<string, unknown>;
  /** Extra top-level fields to merge into the response body. */
  extra?: Record<string, unknown>;
}

export interface OpenAgenticProxyCaptured {
  /** Full inbound request body, last call. */
  body?: Record<string, unknown>;
  /** Convenience: first agent's role. */
  role?: string;
  /** Convenience: first agent's task. */
  task?: string;
  /** Convenience: first agent's tools array. */
  tools?: string[];
  /** Convenience: orchestration field on the body. */
  orchestration?: string;
  /** Convenience: full agents array from the body. */
  agents?: Array<Record<string, unknown>>;
}

/**
 * Build an MSW handler for the openagentic-proxy execute-sync endpoint.
 *
 * Returns the handler + a `captured` object the test can read after
 * runFlow() resolves to assert on what the engine sent on the wire.
 */
export function mockOpenAgenticProxyExecuteSync(opts: OpenAgenticProxyMockOptions): {
  handler: ReturnType<typeof http.post>;
  captured: OpenAgenticProxyCaptured;
} {
  const captured: OpenAgenticProxyCaptured = {};
  const output = opts.output ?? opts.results[0]?.content ?? '';
  const status = opts.status ?? 'completed';

  const handler = http.post(
    'http://openagentic-proxy:3300/api/agents/execute-sync',
    async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      captured.body = body;
      const agents = (body.agents as Array<Record<string, unknown>>) ?? [];
      captured.agents = agents;
      captured.role = agents[0]?.role as string | undefined;
      captured.task = agents[0]?.task as string | undefined;
      captured.tools = agents[0]?.tools as string[] | undefined;
      captured.orchestration = body.orchestration as string | undefined;

      return HttpResponse.json({
        status,
        output,
        results: opts.results,
        ...(opts.metrics !== undefined ? { metrics: opts.metrics } : {}),
        ...(opts.extra ?? {}),
      });
    },
  );

  return { handler, captured };
}
