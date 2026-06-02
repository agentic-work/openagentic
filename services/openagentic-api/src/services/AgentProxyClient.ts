/**
 * OpenAgenticProxyClient — Phase 6, V3 Enterprise Chatmode.
 *
 * Routes V3 chatLoop sub-agent dispatches (Task tool / `delegate_to_agents`)
 * to the openagentic-proxy service (services/openagentic-proxy/) over HTTP. Replaces
 * the in-api legacy orchestrator path on the chat critical chain.
 *
 * The openagentic-proxy service is its own auth+OBO-aware microservice with
 * sandboxed execution + recursive sub-agent support. Routing through it
 * (instead of in-process orchestration) gives:
 *   - Process isolation between the chat loop and sub-agent ReAct loops.
 *   - Independent scaling — openagentic-proxy can be replicated separately
 *     from api when sub-agent traffic spikes.
 *   - Clean audit boundary — every sub-agent dispatch crosses an HTTP
 *     hop with a stamped correlationId, joinable in observability.
 *
 * Auth scheme matches the existing api → openagentic-proxy callers
 * (listAgentsFromSOT.ts, AgentSeederFromDefinitions.ts, admin-agents.ts):
 *   - Header `Authorization: Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY}`
 *   - Header `X-Agent-Proxy: true`
 *
 * The openagentic-proxy auth middleware
 * (services/openagentic-proxy/src/middleware/auth.ts:22) treats this header
 * pair as a trusted service caller; the user's per-tenant OBO token
 * (`userToken` field in the body) is forwarded through the proxy to MCP
 * fanouts so the sub-agent calls Azure/AWS/GCP AS the end user.
 *
 * Fail-CLOSED: refuses to construct without OPENAGENTIC_PROXY_INTERNAL_KEY,
 * AND refuses dev-secret literals (FedRAMP — internal-JWT minting contract).
 *
 * Spec §7: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md
 */

export interface OpenAgenticProxyExecuteRequest {
  userId: string;
  sessionId: string;
  /**
   * Stamped on the HTTP request as `X-Correlation-Id` AND placed on the
   * body as `turnId` so openagentic-proxy's AgentProgressContext binds its
   * progress callback to the parent's turn key. The chat-side stream
   * handler subscribes on this id and re-emits progress as
   * `agent_progress` NDJSON frames.
   */
  parentToolUseId: string;
  /** Sub-agent type (matches AgentRegistry.agent_type — e.g. 'cloud_operations'). */
  agentName: string;
  /** Natural-language prompt the sub-agent receives verbatim. */
  task: string;
  /**
   * Per-tenant OBO token forwarded as `userToken` in the body. The proxy
   * forwards this to MCP fanouts so downstream Azure/AWS/GCP API calls
   * authenticate AS the end user. Required for FedRAMP — without it the
   * sub-agent would call Azure as the platform service principal (which
   * has no resource rights).
   */
  userToken?: string;
  /**
   * Azure-AD ID token (separate audience from userToken). Used as
   * `X-Azure-ID-Token` / `X-AWS-ID-Token` by the proxy's MCP bridge for
   * OBO when sub-agents need to call Azure/AWS as the user.
   */
  userIdToken?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface OpenAgenticProxyExecuteResult {
  ok: boolean;
  output?: string;
  error?: string;
  /** Cents (matches AgentResult.metrics.costCents from openagentic-proxy). */
  costCents?: number;
  /** Wall-clock ms inside the proxy's run. */
  durationMs?: number;
  /** Combined input+output tokens from the sub-agent's turns. */
  tokens?: number;
  /** Tool names the sub-agent invoked (for audit + UI). */
  toolsUsed?: string[];
}

export interface OpenAgenticProxyClientOptions {
  /** Base URL — e.g. `http://openagentic-openagentic-proxy:3300`. */
  baseUrl: string;
  /**
   * Shared service-internal key. Mirrors the value the openagentic-proxy auth
   * middleware reads from `OPENAGENTIC_PROXY_INTERNAL_KEY`. Refuses
   * dev-secret literals (FedRAMP fail-CLOSED).
   */
  internalKey: string;
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
  /** Inject for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Timeout in ms; defaults to 5 min (sub-agent loops can run long). */
  timeoutMs?: number;
}

interface OpenAgenticProxySyncResponse {
  executionId: string;
  status: string;
  results: Array<{
    agentId: string;
    role: string;
    status: 'success' | 'error' | 'timeout' | 'budget_exceeded' | 'loop_detected';
    output: string;
    error?: string;
    metrics: {
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      costCents: number;
    };
    toolCallsExecuted: Array<{ name: string; success: boolean; durationMs: number }>;
  }>;
}

const DEV_SECRET_PREFIX = 'dev-secret';

export class OpenAgenticProxyClient {
  private baseUrl: string;
  private internalKey: string;
  private logger: OpenAgenticProxyClientOptions['logger'];
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: OpenAgenticProxyClientOptions) {
    if (!opts.baseUrl || opts.baseUrl.trim() === '') {
      throw new Error('OpenAgenticProxyClient: baseUrl is required.');
    }
    if (!opts.internalKey || opts.internalKey.trim() === '') {
      throw new Error('OpenAgenticProxyClient: internalKey is required (FedRAMP fail-CLOSED).');
    }
    if (opts.internalKey.startsWith(DEV_SECRET_PREFIX)) {
      throw new Error(
        'OpenAgenticProxyClient: refusing to construct with a dev-secret internalKey literal. ' +
        'Operator must override OPENAGENTIC_PROXY_INTERNAL_KEY in the production secret.',
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.internalKey = opts.internalKey;
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 300_000; // 5 min default
  }

  /**
   * Dispatch a single sub-agent and wait for its full result.
   *
   * Uses the proxy's synchronous endpoint (`/api/agents/execute-sync`) so
   * the chat loop's Task tool can return a structured result the model
   * can read on the same turn.
   */
  async executeAgent(req: OpenAgenticProxyExecuteRequest): Promise<OpenAgenticProxyExecuteResult> {
    const startedAt = Date.now();
    const correlationId = req.parentToolUseId;

    const url = `${this.baseUrl}/api/agents/execute-sync`;
    const body = {
      // Single-agent dispatch: orchestration='sequential' + aggregation='first'
      // collapses the proxy's multi-agent pipeline to a one-shot run with the
      // sub-agent's output returned verbatim.
      agents: [
        {
          role: req.agentName,
          task: req.task,
        },
      ],
      orchestration: 'sequential',
      aggregation: 'first',
      sessionId: req.sessionId,
      // Phase C — openagentic-proxy's AgentProgressContext binds its HTTP
      // progress publisher to this key. The chat-side stream handler
      // subscribes on `parentToolUseId` and re-emits progress as
      // `agent_progress` NDJSON frames so the parent UI shows live
      // sub-agent activity (tool_executing / tool_complete / thinking).
      turnId: correlationId,
      userId: req.userId,
      userMessage: req.task,
      // Sev-0 #927 (2026-05-17) — RunContext identity defaults.
      //
      // The openagentic-proxy's execute-sync handler (routes/execute.ts:68-74)
      // overwrites body.userGroups/authMethod/isAdmin from the validated
      // token IF either (a) the caller is NOT internal, OR (b) body.userId
      // is empty. The chat-side dispatch path hits the OTHER branch:
      // internal-caller WITH a real userId — so the handler SKIPS that
      // overwrite and trusts the body verbatim.
      //
      // Pre-fix, this body shipped without userGroups/authMethod/isAdmin
      // → openagentic-proxy's RunContext.userGroups was undefined → AgentRunner
      // .buildAuthHeaders did `ctx.userGroups.length` (no optional chain)
      // → "Cannot read properties of undefined (reading 'length')" mid-
      // tool-loop. Sub-agent crashed at 4.6s, model recovered honestly
      // ("schema-validation error on the structured output… re-run
      // without the schema constraint") but the crash had nothing to do
      // with structured output — it was an unguarded length access on an
      // identity field the chat-side dispatcher forgot to forward.
      //
      // Fix: always ship safe defaults. The proxy's auth path attaches
      // `groups: []` for internal callers regardless; we're just keeping
      // the body shape self-sufficient so a future RunContext consumer
      // never needs to defend against undefined here.
      userGroups: [] as string[],
      authMethod: 'internal',
      isAdmin: false,
      ...(req.userToken ? { userToken: req.userToken } : {}),
      ...(req.userIdToken ? { userIdToken: req.userIdToken } : {}),
    };

    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.internalKey}`,
          'X-Agent-Proxy': 'true',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '<no-body>');
        this.logger.warn(
          { correlationId, status: res.status, body: text.slice(0, 500) },
          '[OpenAgenticProxyClient] non-2xx response from openagentic-proxy',
        );
        return {
          ok: false,
          error: `openagentic-proxy ${res.status}: ${text.slice(0, 200)}`,
          durationMs: Date.now() - startedAt,
        };
      }

      const data = (await res.json()) as OpenAgenticProxySyncResponse;
      if (!Array.isArray(data?.results) || data.results.length === 0) {
        this.logger.warn(
          { correlationId, status: data?.status },
          '[OpenAgenticProxyClient] proxy returned no agent results',
        );
        return {
          ok: false,
          error: 'openagentic-proxy returned no agent result',
          durationMs: Date.now() - startedAt,
        };
      }

      const first = data.results[0];
      const ok = first.status === 'success';
      const tokens = (first.metrics?.inputTokens ?? 0) + (first.metrics?.outputTokens ?? 0);
      const toolsUsed = (first.toolCallsExecuted ?? [])
        .map((t) => t?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);

      return {
        ok,
        output: ok ? first.output : undefined,
        error: ok ? undefined : (first.error || `sub-agent ${first.status}`),
        costCents: first.metrics?.costCents ?? 0,
        durationMs: first.metrics?.durationMs ?? Date.now() - startedAt,
        tokens,
        toolsUsed,
      };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.logger.error(
        { correlationId, err: message },
        '[OpenAgenticProxyClient] dispatch failed',
      );
      return {
        ok: false,
        error: message,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}
