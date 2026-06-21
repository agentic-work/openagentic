/**
 * Large Result Storage Service
 *
 * Stores massive tool results in Redis to prevent context window bloat.
 * Multi-pod safe: uses shared Redis backend, NOT in-memory storage.
 * Enables semantic querying of stored results instead of re-including full data.
 *
 * Architecture (multi-pod AKS):
 *   Tool execution → Result > 100KB → Store in Redis (shared) → Return dataset ref to LLM
 *   LLM calls query_data → DataQueryTool → LargeResultStorageService.getResult() → Redis
 *   Any pod can serve any request since all state is in Redis.
 *
 * #974 RBAC (2026-05-20 PM):
 *   Pre-#974 keys were random `result_<ts>_<rand9>` — handle leak = cross-user
 *   read. New keys embed `${tenantId}:${userId}:${resultId}` so a stolen handle
 *   matches the original requester's namespace, not just the random id. The
 *   `getResultAsync(resultId, { userId, tenantId, allowedMcpServers? })`
 *   overload enforces RBAC at read-time: caller must match the namespace OR
 *   must have access to the originating tool's MCP server.
 */

import type { Logger } from 'pino';
import { Counter, register } from 'prom-client';
import { getRedisClient, type UnifiedRedisClient } from '../utils/redis-client.js';

export interface StoredResultInfo {
  resultId: string;
  summary: string;
  sizeBytes: number;
  chunkCount: number;
}

interface StoredResult {
  userId: string;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  result: any;
  chunks: Array<{ text: string; metadata: Record<string, any> }>;
  summary: string;
  timestamp: number;
  /** #974 — embedded tenant scope. Defaults to '' for pre-RBAC writes. */
  tenantId?: string;
}

const REDIS_KEY_PREFIX = 'large_result:';

// ─── #974 Prom counters ──────────────────────────────────────────────────────
// One-shot module-level construction (prom-client throws on double-register).
// `findOrCreate` pattern: if the metric name is already registered, reuse it —
// keeps the test register stable across vitest worker reloads.
function findOrCreateCounter(name: string, help: string, labelNames: string[]): Counter<string> {
  const existing = register.getSingleMetric(name) as Counter<string> | undefined;
  if (existing) return existing;
  return new Counter({ name, help, labelNames, registers: [register] });
}

export const largeResultOffloadsTotal = findOrCreateCounter(
  'large_result_offloads_total',
  'Count of large MCP tool results offloaded to Redis storage (per tool/tenant).',
  ['tool', 'tenant'],
);

export const largeResultBytesSavedTotal = findOrCreateCounter(
  'large_result_bytes_saved_total',
  'Cumulative bytes offloaded to LargeResultStorage (sizeBytes summed per tool/tenant).',
  ['tool', 'tenant'],
);

export class LargeResultStorageService {
  private readonly SIZE_THRESHOLD = 100 * 1024; // 100KB
  private readonly TOKEN_THRESHOLD = 25000; // 25K tokens
  private readonly TTL_SECONDS = 48 * 60 * 60; // 48 hours

  private redis: UnifiedRedisClient | null = null;

  constructor(private readonly logger: Logger) {
    this.initRedis();
  }

  private async initRedis(): Promise<void> {
    try {
      this.redis = getRedisClient();
    } catch (error) {
      this.logger.warn({ error }, 'LargeResultStorageService: Redis not available');
    }
  }

  /**
   * Check if a tool result should be stored (size threshold)
   */
  shouldStoreResult(result: any): boolean {
    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');
    const estimatedTokens = Math.ceil(sizeBytes / 4);

    this.logger.info({
      sizeBytes,
      estimatedTokens,
      threshold: this.SIZE_THRESHOLD,
      shouldStore: sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD
    }, 'Checking if result should be stored');

    return sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD;
  }

  /**
   * Store a large tool result in Redis (multi-pod safe).
   *
   * #974 — `tenantId` is now part of the key namespace so a leaked handle
   * cannot cross-read another tenant's data. `userId` was already in the
   * payload; we now also embed it in the key, making a single SCAN cheap
   * to RBAC-filter at read time.
   */
  async storeResult(params: {
    userId: string;
    sessionId: string;
    toolName: string;
    toolCallId: string;
    result: any;
    /** #974 — tenant scope for the result. Defaults to '' (pre-RBAC) when omitted. */
    tenantId?: string;
  }): Promise<StoredResultInfo> {
    const { userId, sessionId, toolName, toolCallId, result, tenantId = '' } = params;

    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const resultId = `result_${timestamp}_${random}`;

    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');

    this.logger.info({
      resultId,
      userId,
      tenantId,
      sessionId,
      toolName,
      sizeBytes,
      sizeMB: (sizeBytes / 1024 / 1024).toFixed(2),
      threshold: this.SIZE_THRESHOLD
    }, '📦 Storing large tool result in Redis (multi-pod safe)');

    const summary = this.generateSummary(toolName, result);
    const chunks = this.chunkResult(toolName, result);

    const stored: StoredResult = {
      userId,
      sessionId,
      toolName,
      toolCallId,
      result,
      chunks,
      summary,
      timestamp,
      tenantId,
    };

    // Store in Redis — multi-pod safe. Key namespace embeds tenantId+userId
    // so a stolen handle requires matching auth (RBAC enforced at read time).
    const key = this.buildKey(tenantId, userId, resultId);
    if (this.redis) {
      try {
        await this.redis.set(key, stored, this.TTL_SECONDS);
        this.logger.info({ resultId, key }, '✅ Large result stored in Redis');
      } catch (error) {
        this.logger.error({ error, resultId }, '❌ Failed to store large result in Redis — result will be lost');
        throw new Error(`Failed to store large result in Redis: ${error}`);
      }
    } else {
      this.logger.error({ resultId }, '❌ Redis not available — cannot store large result (multi-pod requires Redis)');
      throw new Error('Redis not available — large result storage requires Redis for multi-pod safety');
    }

    // #974 — Prom counters. Cardinality: tool (slug) × tenant (id). Safe — both
    // are bounded sets in practice.
    try {
      largeResultOffloadsTotal.inc({ tool: toolName, tenant: tenantId });
      largeResultBytesSavedTotal.inc({ tool: toolName, tenant: tenantId }, sizeBytes);
    } catch {
      // Prom registry shenanigans must never break a tool call — fail-soft.
    }

    this.logger.info({
      resultId,
      chunkCount: chunks.length,
      summary,
      tokensSaved: Math.ceil(sizeBytes / 4)
    }, '✅ Large result stored successfully in Redis - context tokens saved!');

    // #1085 sidecar — fire-and-forget upsert into the user's Milvus memory so
    // memory_search can recall the large result's summary on later turns.
    // Failures swallowed; Redis-side storage is the SoT, memory is best-effort.
    if (userId) {
      void (async () => {
        try {
          const { getMilvusMemoryService } = await import('./MilvusMemoryService.js');
          await getMilvusMemoryService(this.logger as any).upsertUserMemory(userId, {
            kind: 'large_tool_result',
            title: `${toolName} result (${resultId})`,
            content: typeof summary === 'string' ? summary : JSON.stringify(summary).slice(0, 4000),
          });
        } catch (err: any) {
          this.logger.warn(
            { err: err?.message ?? String(err), resultId, toolName },
            '[large-result] memory upsert failed — result still stored in Redis',
          );
        }
      })();
    }

    return {
      resultId,
      summary,
      sizeBytes,
      chunkCount: chunks.length
    };
  }

  /**
   * #974 — Build the namespaced Redis key. Format:
   *   `large_result:${tenantId}:${userId}:${resultId}`
   *
   * Empty tenantId / userId are kept as empty path segments so legacy callers
   * (system-side persistence with no user) still get a deterministic key.
   */
  private buildKey(tenantId: string, userId: string, resultId: string): string {
    return `${REDIS_KEY_PREFIX}${tenantId}:${userId}:${resultId}`;
  }

  /**
   * #974 — Find the live key for a `resultId` by scanning the RBAC namespace.
   * Returns the matching key string or null when nothing matches. Callers do
   * the auth check against the discovered key's segments before returning the
   * payload to the model.
   *
   * The cost is one SCAN over `large_result:*:*:<resultId>` (cheap — Redis
   * patterns match against tenant/user prefixes that are bounded sets).
   */
  private async findKeyForResultId(resultId: string): Promise<string | null> {
    if (!this.redis) return null;
    // Try direct lookup against tenant+user-known callers first. When the
    // namespace is unknown we SCAN with the suffix pattern.
    try {
      const keys = await this.redis.keys(`${REDIS_KEY_PREFIX}*:${resultId}`);
      if (Array.isArray(keys) && keys.length > 0) {
        return keys[0];
      }
      // Backwards-compat: pre-#974 keys had shape `large_result:${resultId}`.
      // One probe to that shape catches in-flight reads against legacy data.
      const legacyKey = `${REDIS_KEY_PREFIX}${resultId}`;
      const legacy = await this.redis.get(legacyKey);
      if (legacy) return legacyKey;
    } catch (err) {
      this.logger.warn({ err, resultId }, 'findKeyForResultId scan failed');
    }
    return null;
  }

  /**
   * Retrieve a stored result by ID from Redis (multi-pod safe)
   */
  getResult(resultId: string): { result: any; toolName: string; summary: string; timestamp: number } | null {
    // This needs to be async for Redis, but interface is sync for backwards compat
    // Use getResultAsync instead for new code
    this.logger.warn({ resultId }, 'Sync getResult() called — use getResultAsync() for multi-pod');
    return null;
  }

  /**
   * Async version - retrieves from Redis (multi-pod safe).
   *
   * #974 RBAC overload: when `auth` is supplied, the caller's identity is
   * checked against the stored result's owner. Mismatch → null (with a
   * structured warn log). When `auth.allowedMcpServers` is non-empty, the
   * stored tool's MCP server must be in the allow-list (derived from the
   * tool slug's prefix — `openagentic_<server>_<tool>`).
   *
   * `auth` is omitted in the legacy callsite (TraceStore + system reads) —
   * legacy behavior preserved when no auth is passed. Production chat
   * pipeline ALWAYS passes auth so a stolen handle from another user can
   * not cross-read.
   */
  async getResultAsync(
    resultId: string,
    auth?: {
      userId: string;
      tenantId: string;
      allowedMcpServers?: string[];
    },
  ): Promise<{ result: any; toolName: string; summary: string; timestamp: number } | null> {
    if (!this.redis) {
      this.logger.warn({ resultId }, 'Redis not available for result retrieval');
      return null;
    }

    try {
      // Discover the namespaced key. When auth is supplied we try the
      // direct namespaced key first (fast path); the SCAN fallback handles
      // legacy + cross-namespace probes (which then RBAC-fail below).
      let stored: StoredResult | null = null;
      let matchedKey: string | null = null;

      if (auth) {
        const directKey = this.buildKey(auth.tenantId, auth.userId, resultId);
        stored = await this.redis.get<StoredResult>(directKey);
        if (stored) {
          matchedKey = directKey;
        }
      }

      if (!stored) {
        // Either auth was omitted (legacy callsite) OR direct lookup missed
        // (different namespace). SCAN for the result.
        matchedKey = await this.findKeyForResultId(resultId);
        if (matchedKey) {
          stored = await this.redis.get<StoredResult>(matchedKey);
        }
      }

      if (!stored || !matchedKey) {
        this.logger.debug({ resultId }, 'Result not found in Redis');
        return null;
      }

      // #974 — RBAC check when caller passed auth context.
      if (auth) {
        const ownerTenant = stored.tenantId ?? '';
        const ownerUser = stored.userId ?? '';
        const sameOwner = ownerTenant === auth.tenantId && ownerUser === auth.userId;
        if (!sameOwner) {
          this.logger.warn(
            {
              resultId,
              requestingUserId: auth.userId,
              requestingTenantId: auth.tenantId,
              ownerUserId: ownerUser,
              ownerTenantId: ownerTenant,
              reason: 'rbac_owner_mismatch',
            },
            '⛔ getResultAsync rejected — caller does not own this result',
          );
          return null;
        }

        // Allowed-MCP-servers check (when provided). Tool slug shape is
        // `openagentic_<server>_<tool>` per buildChatV2Deps header-plumb comments.
        if (Array.isArray(auth.allowedMcpServers) && auth.allowedMcpServers.length > 0) {
          const serverFromTool = inferMcpServerFromToolName(stored.toolName);
          if (serverFromTool && !auth.allowedMcpServers.includes(serverFromTool)) {
            this.logger.warn(
              {
                resultId,
                requestingUserId: auth.userId,
                toolName: stored.toolName,
                inferredServer: serverFromTool,
                allowedMcpServers: auth.allowedMcpServers,
                reason: 'rbac_mcp_server_not_allowed',
              },
              '⛔ getResultAsync rejected — caller lacks access to originating MCP server',
            );
            return null;
          }
        }
      }

      this.logger.info({
        resultId,
        toolName: stored.toolName,
        summary: stored.summary
      }, '📦 Retrieved stored result from Redis');

      return {
        result: stored.result,
        toolName: stored.toolName,
        summary: stored.summary,
        timestamp: stored.timestamp
      };
    } catch (error) {
      this.logger.error({ error, resultId }, 'Failed to retrieve result from Redis');
      return null;
    }
  }

  /**
   * Check if a result exists in Redis. #974 — namespaced key lookup.
   */
  async hasResult(resultId: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const key = await this.findKeyForResultId(resultId);
      return key !== null;
    } catch {
      return false;
    }
  }

  /**
   * Generate a brief summary of the result
   */
  private generateSummary(toolName: string, result: any): string {
    const toolLower = toolName.toLowerCase();

    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      return `Found ${result.subscriptions.length} subscriptions`;
    }

    if ((toolLower.includes('resource') || toolLower.includes('list')) && Array.isArray(result)) {
      return `Found ${result.length} resources`;
    }

    if (Array.isArray(result)) {
      return `Returned ${result.length} items`;
    }

    if (typeof result === 'object' && result !== null) {
      const keys = Object.keys(result);
      return `Result with ${keys.length} properties: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
    }

    return 'Large result stored';
  }

  /**
   * Break result into semantic chunks for querying
   */
  private chunkResult(
    toolName: string,
    result: any
  ): Array<{ text: string; metadata: Record<string, any> }> {
    const chunks: Array<{ text: string; metadata: Record<string, any> }> = [];

    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      for (const sub of result.subscriptions) {
        const text = `Subscription: ${sub.displayName || sub.name || 'Unknown'} (ID: ${sub.subscriptionId || sub.id})
State: ${sub.state || 'unknown'}`;
        chunks.push({
          text,
          metadata: {
            subscriptionId: sub.subscriptionId || sub.id,
            displayName: sub.displayName || sub.name,
            state: sub.state
          }
        });
      }
      return chunks;
    }

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) {
        chunks.push({
          text: JSON.stringify(result[i], null, 2),
          metadata: { type: 'array_item', index: i }
        });
      }
      return chunks;
    }

    if (typeof result === 'object' && result !== null) {
      for (const [key, value] of Object.entries(result)) {
        chunks.push({
          text: `${key}: ${JSON.stringify(value, null, 2)}`,
          metadata: { property: key }
        });
      }
    }

    return chunks;
  }

  /**
   * Query stored results from Redis (multi-pod safe)
   */
  async queryStoredResult(params: {
    resultId: string;
    query: string;
    limit?: number;
  }): Promise<Array<{ text: string; score: number; metadata: Record<string, any> }>> {
    const { resultId, query, limit = 10 } = params;

    const stored = await this.getResultFromRedis(resultId);
    if (!stored) {
      throw new Error(`Stored result '${resultId}' not found or has expired (TTL: ${this.TTL_SECONDS / 3600}h). Please re-fetch the data.`);
    }

    this.logger.info({
      resultId,
      query,
      chunkCount: stored.chunks.length
    }, 'Querying stored result from Redis');

    const queryLower = query.toLowerCase();
    const results = stored.chunks
      .map((chunk: any) => ({
        text: chunk.text,
        metadata: chunk.metadata,
        score: this.calculateMatchScore(chunk.text, queryLower)
      }))
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);

    this.logger.info({
      resultId,
      matchCount: results.length,
      topScore: results[0]?.score || 0
    }, 'Query completed from Redis');

    return results;
  }

  private async getResultFromRedis(resultId: string): Promise<StoredResult | null> {
    if (!this.redis) return null;
    try {
      // #974 — namespaced key lookup via SCAN. queryStoredResult is the only
      // remaining caller of this path; it does NOT enforce RBAC by design
      // (the caller is expected to have already passed the gate via
      // getResultAsync).
      const key = await this.findKeyForResultId(resultId);
      if (!key) return null;
      return await this.redis.get<StoredResult>(key);
    } catch (error) {
      this.logger.error({ error, resultId }, 'Redis get failed');
      return null;
    }
  }

  private calculateMatchScore(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const keywords = query.split(/\s+/);
    let score = 0;
    for (const keyword of keywords) {
      if (textLower.includes(keyword)) score += 1;
    }
    return score;
  }

  /**
   * Create a compact tool message for stored results
   */
  createStoredResultMessage(params: {
    resultId: string;
    toolName: string;
    summary: string;
    sizeBytes: number;
    chunkCount: number;
  }): string {
    const { resultId, toolName, summary, sizeBytes, chunkCount } = params;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
    const tokensSaved = Math.ceil(sizeBytes / 4);
    const ttlHours = this.TTL_SECONDS / 3600;

    return `📦 **Large result stored in Redis** (${sizeMB}MB / ~${tokensSaved.toLocaleString()} tokens saved from context!)

**Tool**: ${toolName}
**Summary**: ${summary}
**Chunks**: ${chunkCount} semantic chunks available

**How to query this data**:
To search for specific information in this stored result, ask me questions like:
- "Which subscriptions have AKS clusters?"
- "Show me production subscriptions"
- "Find subscriptions in eastus region"

I'll automatically search the stored data semantically instead of re-loading all ${sizeMB}MB into context.

**Result ID**: \`${resultId}\` (auto-expires in ${ttlHours} hours, shared across all pods)`;
  }

  /**
   * Get full result from Redis
   */
  async getFullResult(resultId: string): Promise<any | null> {
    const stored = await this.getResultFromRedis(resultId);
    return stored?.result || null;
  }
}

// =============================================================================
// #974 RBAC helpers — exported for unit tests
// =============================================================================

/**
 * Infer the MCP server name from a tool slug.
 *
 * Tool slugs follow `openagentic_<server>_<verb>_<resource>` (e.g.
 * `openagentic_azure_list_subscriptions` → `azure`). Returns null when no inference
 * is possible — callers treat null as "skip the server-check gate".
 *
 * This is intentionally permissive: a missing prefix means the tool ran
 * outside the openagentic_ MCP family (e.g. a Synth call) and the allowedMcpServers
 * list (which is a list of MCP server slugs) doesn't apply.
 */
export function inferMcpServerFromToolName(toolName: string): string | null {
  if (!toolName) return null;
  // Strip the openagentic_ prefix when present, then take the first segment.
  const normalized = toolName.toLowerCase();
  const match = normalized.match(/^awp[_-]([a-z0-9]+)/);
  if (match) return match[1] ?? null;
  // Fallback: also accept `<server>_<verb>_<resource>` (legacy chat-v2
  // routes call `azure_list_subscriptions` without the openagentic_ prefix).
  const fallback = normalized.match(/^([a-z0-9]+)[_-]/);
  return fallback ? (fallback[1] ?? null) : null;
}

// =============================================================================
// SINGLETON ACCESSOR
// =============================================================================

import logger from '../utils/logger.js';

let _instance: LargeResultStorageService | null = null;

export function getLargeResultStorageService(): LargeResultStorageService {
  if (!_instance) {
    _instance = new LargeResultStorageService(logger.child({ service: 'LargeResultStorageService' }));
  }
  return _instance;
}

export function setLargeResultStorageServiceInstance(instance: LargeResultStorageService): void {
  _instance = instance;
}
