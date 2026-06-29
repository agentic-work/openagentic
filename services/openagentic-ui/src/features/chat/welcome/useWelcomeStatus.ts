/**
 * useWelcomeStatus
 *
 * Fetches a one-shot, post-login system-status summary used to pre-seed the
 * Welcome chat turn. Reads:
 *   - GET /api/health/comprehensive  (model / database / vector / mcp checks)
 *   - GET /api/admin/mcp-tools/status (admin only — server + tool counts)
 *
 * Produces a single terminal-style status line, e.g.:
 *   "✓ model gpt-oss:20b ready · ✓ 9 MCPs serving 270 tools · ✓ database & redis healthy"
 *
 * Best-effort: every probe is independently guarded so a single failing
 * dependency degrades the line ("model warming up") instead of throwing.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

export interface WelcomeStatus {
  /** Pre-formatted, emoji-prefixed terminal status line. */
  line: string;
  /** Resolved chat model name, when the health probe reports one. */
  modelName: string | null;
  modelReady: boolean;
  databaseHealthy: boolean;
  vectorHealthy: boolean;
  /** Number of MCP servers serving tools (from comprehensive health or admin status). */
  mcpServers: number | null;
  /** Total MCP tools available. */
  mcpTools: number | null;
  /** Whether the overall comprehensive probe reported healthy. */
  overallHealthy: boolean;
}

const ok = (b: boolean) => (b ? '✓' : '⚠');

function buildLine(s: Omit<WelcomeStatus, 'line'>): string {
  const parts: string[] = [];

  // Model
  if (s.modelName) {
    parts.push(`${ok(s.modelReady)} model ${s.modelName} ${s.modelReady ? 'ready' : 'warming up'}`);
  } else {
    parts.push(`${ok(s.modelReady)} model ${s.modelReady ? 'ready' : 'warming up'}`);
  }

  // MCPs + tools
  if (s.mcpServers != null && s.mcpTools != null) {
    parts.push(`✓ ${s.mcpServers} MCP${s.mcpServers === 1 ? '' : 's'} serving ${s.mcpTools} tools`);
  } else if (s.mcpTools != null) {
    parts.push(`✓ ${s.mcpTools} tools available`);
  }

  // Data plane
  const dataParts: string[] = [];
  if (s.databaseHealthy) dataParts.push('database');
  if (s.vectorHealthy) dataParts.push('vector store');
  if (dataParts.length > 0) {
    parts.push(`${ok(s.databaseHealthy)} ${dataParts.join(' & ')} healthy`);
  } else {
    parts.push(`${ok(false)} database connecting`);
  }

  return parts.join(' · ');
}

export function useWelcomeStatus(opts: { isAdmin: boolean; enabled: boolean }) {
  const { isAdmin, enabled } = opts;
  const { getAuthHeaders } = useAuth();
  const [status, setStatus] = useState<WelcomeStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    // Defaults assume "unknown/unhealthy" until a probe proves otherwise.
    const acc: Omit<WelcomeStatus, 'line'> = {
      modelName: null,
      modelReady: false,
      databaseHealthy: false,
      vectorHealthy: false,
      mcpServers: null,
      mcpTools: null,
      overallHealthy: false,
    };

    // 1) Comprehensive health — available to any authenticated user.
    try {
      const res = await fetch(apiEndpoint('/health/comprehensive'), {
        headers: getAuthHeaders(),
      });
      // 200 OR 503 both return the structured body; only a network error throws.
      const data = await res.json().catch(() => null);
      if (data && data.checks) {
        const c = data.checks;
        acc.overallHealthy = !!data.overall_healthy;
        acc.modelReady = !!c.chat_model?.healthy;
        acc.modelName = c.chat_model?.details?.model ?? null;
        acc.databaseHealthy = !!c.database?.healthy;
        acc.vectorHealthy = !!c.vector_storage?.healthy;
        // mcp_orchestrator carries server + tool counts in the comprehensive probe.
        const mcp = c.mcp_orchestrator?.details;
        if (mcp) {
          if (typeof mcp.servers === 'number') acc.mcpServers = mcp.servers;
          else if (Array.isArray(mcp.servers)) acc.mcpServers = mcp.servers.length;
          if (typeof mcp.tools === 'number') acc.mcpTools = mcp.tools;
          else if (Array.isArray(mcp.tools)) acc.mcpTools = mcp.tools.length;
        }
      }
    } catch {
      // network failure — leave defaults; line will read "model warming up".
    }

    // 2) Admin MCP tools status — richer server/tool counts, admin-only route.
    if (isAdmin) {
      try {
        // /admin/dashboard/counts is the canonical structural MCP source the admin
        // console uses. /admin/mcp-tools/status can return success:false on a fresh
        // box, which left the welcome at "0 MCPs serving 0 tools" with 378 indexed.
        const res = await fetch(apiEndpoint('/admin/dashboard/counts'), {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data) {
            if (typeof data.mcpServers === 'number') acc.mcpServers = data.mcpServers;
            if (typeof data.mcpTools === 'number') acc.mcpTools = data.mcpTools;
          }
        }
      } catch {
        // fall back to comprehensive-health counts already in acc.
      }
    }

    setStatus({ ...acc, line: buildLine(acc) });
    setLoading(false);
  }, [getAuthHeaders, isAdmin]);

  useEffect(() => {
    if (!enabled) return;
    void fetchStatus();
  }, [enabled, fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}

export default useWelcomeStatus;
