/**
 * useE2eHarness — consumes POST /api/admin/test-harness/run-e2e NDJSON.
 *
 * Companion to useTestHarness. The E2E endpoint streams a different
 * frame shape (test_start / test_progress / test_done + final summary)
 * because it tests across more dimensions (per-provider, per-model,
 * per-tool) and surfaces TTFT / tokens / embedding dim per row.
 *
 * This hook owns the row-state-machine: a `test_start` creates a
 * `running` row, the matching `test_done` flips it to `pass`/`fail`
 * with timings + evidence + error. Final `summary` frame caches the
 * aggregate stats so the UI can render the p50/p95 + model table.
 */
import { useCallback, useRef, useState } from 'react';
import { apiEndpoint } from '@/utils/api';
import { parseNDJSONStream } from '@/utils/ndjsonStream';

export type E2eTestKind =
  | 'provider'
  | 'chat_model'
  | 'embedding_model'
  | 't1_tool'
  | 't2_mcp'
  | 't3_artifact'
  | 'flow_e2e'
  | 'cache_verify';

export interface E2eTestRow {
  testId: string;
  kind: E2eTestKind;
  target: string;
  status: 'running' | 'pass' | 'fail';
  durationMs?: number;
  ttftMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  embeddingDim?: number;
  evidence?: Record<string, unknown>;
  error?: string;
  startedAt: string;
}

export interface E2eSummary {
  total: number;
  passed: number;
  failed: number;
  durations?: { p50?: number; p95?: number; totalMs?: number };
  models?: Array<{
    id: string;
    provider?: string;
    role?: string;
    ttftMs?: number;
    embeddingDim?: number;
    ok: boolean;
    error?: string;
  }>;
  mode?: string;
}

export type E2eMode = 'full' | 'smoke';

interface RunOpts {
  mode?: E2eMode;
  includeFlows?: boolean;
  includeMcpTools?: boolean;
  includeT3?: boolean;
  models?: string[];
}

export function useE2eHarness() {
  const [rows, setRows] = useState<E2eTestRow[]>([]);
  const [summary, setSummary] = useState<E2eSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (opts: RunOpts = {}) => {
    setRows([]);
    setSummary(null);
    setError(null);
    setRunning(true);

    abortRef.current = new AbortController();
    try {
      const token =
        localStorage.getItem('auth_token') ||
        document.cookie.match(/auth_token=([^;]+)/)?.[1] ||
        '';

      const response = await fetch(apiEndpoint('/admin/test-harness/run-e2e'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/x-ndjson',
        },
        body: JSON.stringify({
          mode: opts.mode ?? 'full',
          includeFlows: opts.includeFlows ?? true,
          includeMcpTools: opts.includeMcpTools ?? true,
          includeT3: opts.includeT3 ?? true,
          models: opts.models,
        }),
        signal: abortRef.current.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        setError(`HTTP ${response.status}: ${response.statusText}`);
        setRunning(false);
        return;
      }

      for await (const payload of parseNDJSONStream<{ type: string; [k: string]: unknown }>(response)) {
        if (payload.type === 'test_start') {
          const row: E2eTestRow = {
            testId: String(payload.testId ?? ''),
            kind: payload.kind as E2eTestKind,
            target: String(payload.target ?? ''),
            status: 'running',
            startedAt: String(payload.ts ?? new Date().toISOString()),
          };
          setRows(prev => [...prev, row]);
        } else if (payload.type === 'test_done') {
          const id = String(payload.testId ?? '');
          setRows(prev =>
            prev.map(r =>
              r.testId === id
                ? {
                    ...r,
                    status: payload.ok ? 'pass' : 'fail',
                    durationMs: (payload as any).durationMs,
                    ttftMs: (payload as any).ttftMs,
                    tokensIn: (payload as any).tokensIn,
                    tokensOut: (payload as any).tokensOut,
                    embeddingDim: (payload as any).embeddingDim,
                    evidence: (payload as any).evidence,
                    error: (payload as any).error,
                  }
                : r,
            ),
          );
        } else if (payload.type === 'summary') {
          setSummary(payload as unknown as E2eSummary);
        } else if (payload.type === 'error') {
          setError(String((payload as any).message ?? 'unknown error'));
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(String(err?.message ?? err));
      }
    } finally {
      setRunning(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const downloadJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ rows, summary }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e2e-harness-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, summary]);

  return { rows, summary, running, error, start, stop, downloadJson };
}
