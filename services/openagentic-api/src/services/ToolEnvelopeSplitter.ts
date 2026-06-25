/**
 * Tool Envelope Splitter — Phase 4 / Task 4.2.
 *
 * Splits raw tool output into the two-channel envelope per Spec §6.2:
 *   - structuredContent: model channel (≤2KB summary + optional shaped digest)
 *   - _meta: UI/observability channel (outputTemplate / artifactHandle / size / elapsed / cost)
 *
 * Overflow path: when serialized raw exceeds `thresholdBytes` (default 30KB)
 * AND a LargeResultStorage adapter is supplied, full raw is offloaded to the
 * storage (returning a handle) and `structuredContent` is reduced via the
 * tool-supplied `truncate_summary` fn (or a sane default fallback).
 *
 * Defensive note: if the result overflows but NO storage adapter is wired,
 * we keep the full content inline (artifactHandle stays undefined). Never
 * drop data — the model is better off seeing a verbose result than nothing.
 *
 * the design notes
 * the design notes
 *       Phase 4, Task 4.2.
 */

import type { ToolResult, StructuredContent } from '../types/ToolResult.js';
import { classifyArtifact } from './ArtifactRegistry.js';

/** Default inline-vs-overflow threshold per Spec §6.2 step 3. */
const DEFAULT_OVERFLOW_THRESHOLD_BYTES = 30 * 1024;

/** 24-hour TTL for stored overflow payloads (matches LargeResultStorage default). */
const STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal LargeResultStorage adapter shape — keeps splitEnvelope decoupled
 * from the concrete `LargeResultStorageService` (which has a heavier surface
 * + Redis client). Production wiring passes a thin lambda that delegates to
 * the singleton.
 *
 * 2026-05-11 — `opts.toolName` extended onto `put()` so the production
 * adapter (built by `buildChatV2Deps`) can forward it through to
 * `LargeResultStorageService.storeResult({ toolName, ... })`. Without it,
 * every stored row carried `toolName: 'unknown'`, which broke the per-tool
 * summary helper in `LargeResultStorageService.generateSummary()` (it keys
 * off the tool name to pick subscription / resource / generic templates).
 */
export interface SplitterLargeResultStorage {
  put: (
    raw: unknown,
    opts: {
      sessionId: string;
      toolUseId: string;
      expiresAt: number;
      /** Optional — forwarded by the chat-pipeline adapter; defaults to 'unknown'. */
      toolName?: string;
      /**
       * #974 RBAC (2026-05-20 PM) — caller identity threaded through from
       * the dispatchTool ctx. Production adapter forwards these onto
       * `LargeResultStorageService.storeResult({ userId, tenantId, ... })`
       * so the resulting Redis key embeds the namespace
       * (`large_result:${tenantId}:${userId}:${resultId}`). A leaked handle
       * then requires matching auth at read time — getResultAsync rejects
       * cross-user reads.
       *
       * Pre-#974 callsites passed `userId: 'system'` hardcoded. Defaults
       * preserved for legacy paths that don't propagate user context
       * (TraceStore + sub-agent trace store).
       */
      userId?: string;
      tenantId?: string;
      allowedMcpServers?: string[];
    },
  ) => Promise<string>;
}

export interface SplitEnvelopeOpts {
  /** Raw tool output as returned by the underlying capability. */
  raw: unknown;
  /** Tool metadata — drives outputTemplate routing + per-tool truncate fn. */
  tool: {
    slug: string;
    outputTemplate?: string;
    truncate_summary?: (raw: unknown) => StructuredContent;
  };
  sessionId: string;
  toolUseId: string;
  /** End-to-end dispatch latency in ms (for `_meta.elapsed`). */
  elapsed: number;
  /** Tool-execution cost in USD (when known). */
  cost?: number;
  /** Defaults to true; pass false for tool failures. */
  ok?: boolean;
  /** Optional storage adapter — when omitted, overflow keeps inline. */
  largeResultStorage?: SplitterLargeResultStorage;
  /** Inline-vs-overflow byte threshold; defaults to 30KB. */
  thresholdBytes?: number;
  /**
   * #974 RBAC (2026-05-20 PM) — caller identity to thread through to
   * `largeResultStorage.put({ userId, tenantId, allowedMcpServers })`.
   * Production dispatch reads these from `ctx.user.*` and forwards so
   * the stored Redis key embeds the namespace. Omitted for sub-agent
   * trace stores (system-owned).
   */
  userId?: string;
  tenantId?: string;
  allowedMcpServers?: string[];
}

export async function splitEnvelope(opts: SplitEnvelopeOpts): Promise<ToolResult> {
  const threshold = opts.thresholdBytes ?? DEFAULT_OVERFLOW_THRESHOLD_BYTES;
  const serialized =
    typeof opts.raw === 'string' ? opts.raw : JSON.stringify(opts.raw ?? '');
  const size = Buffer.byteLength(serialized, 'utf8');

  let structuredContent: StructuredContent;
  let artifactHandle: string | undefined;

  if (size > threshold && opts.largeResultStorage) {
    // Overflow path: offload full raw to storage, summarize for model.
    const expiresAt = Date.now() + STORAGE_TTL_MS;
    artifactHandle = await opts.largeResultStorage.put(opts.raw, {
      sessionId: opts.sessionId,
      toolUseId: opts.toolUseId,
      expiresAt,
      // Forward the tool slug so the storage layer keys per-tool summary
      // generation off the actual tool name (azure_list_subscriptions,
      // k8s_list_pods, …) rather than defaulting to 'unknown'.
      toolName: opts.tool.slug,
      // #974 — forward caller identity so the storage layer can RBAC-key the
      // Redis namespace. Adapter falls back to 'system' when these are absent.
      userId: opts.userId,
      tenantId: opts.tenantId,
      allowedMcpServers: opts.allowedMcpServers,
    });
    structuredContent = opts.tool.truncate_summary
      ? opts.tool.truncate_summary(opts.raw)
      : defaultTruncateSummary(opts.raw, size);
  } else {
    // Inline path: full content visible to model.
    structuredContent = {
      summary: defaultSummary(opts.raw),
      data: opts.raw,
    };
  }

  return {
    ok: opts.ok ?? true,
    structuredContent,
    _meta: {
      outputTemplate: opts.tool.outputTemplate,
      artifactKind: classifyArtifact(opts.tool.outputTemplate),
      artifactHandle,
      size,
      elapsed: opts.elapsed,
      cost: opts.cost,
    },
  };
}

/**
 * Default fallback when a tool registry entry has no `truncate_summary`.
 * Truncates the serialized form to ~2KB and flags `truncated: true`.
 */
function defaultTruncateSummary(raw: unknown, size: number): StructuredContent {
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return {
    summary: `Tool returned ${size} bytes (truncated to 2KB preview). Use read_large_result(handle) for full content.`,
    data: serialized.slice(0, 2000),
    truncated: true,
  };
}

/** Best-effort 1-3 line summary for the inline path. */
function defaultSummary(raw: unknown): string {
  if (raw == null) return '(empty result)';
  if (typeof raw === 'string') {
    const lines = raw.split('\n');
    return lines.length === 1 ? raw.slice(0, 200) : `${lines.length} lines, ${raw.length} chars`;
  }
  if (Array.isArray(raw)) return `Array of ${raw.length} items`;
  if (typeof raw === 'object') {
    const keys = Object.keys(raw as object);
    return `Object with ${keys.length} fields: ${keys.slice(0, 5).join(', ')}`;
  }
  return String(raw).slice(0, 200);
}
