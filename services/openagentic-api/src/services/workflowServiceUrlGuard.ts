/**
 * workflowServiceUrlGuard — observability shim for the dedicated
 * workflows-service routing.
 *
 * Phase A of the api↔workflow-engine decoupling. The dedicated
 * workflows-service pod has been deployed and reachable for weeks
 * (kubectl confirmed `WORKFLOW_SERVICE_URL=http://openagentic-workflows:3400`),
 * but live logs (2026-05-03) show ZERO execution traffic in the last
 * 24h. The api has been silently using its in-process
 * WorkflowExecutionEngine fallback every time.
 *
 * Phase A doesn't rip the engine yet — that's Phase B. Phase A makes
 * fallback traffic loud and counted so Phase B can ship with confidence
 * that no real production path is using the in-process engine.
 *
 * Usage at every fallback site:
 *
 *   if (isWorkflowServiceConfigured(WORKFLOW_SERVICE_URL)) {
 *     // proxy to workflows-service
 *   } else {
 *     reportLocalEngineFallback({ workflowId, executionId, logger });
 *     // legacy in-process executeWorkflow(...)
 *   }
 */

import { Counter, register } from 'prom-client';

// ---------------------------------------------------------------------------
// Pure helpers (testable without prom-client global state)
// ---------------------------------------------------------------------------

export function isWorkflowServiceConfigured(url: string | undefined): boolean {
  return typeof url === 'string' && url.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Counter — exposed via /metrics so we can assert "0 fallbacks/day" on
// the live dashboard before ripping the engine in Phase B.
// ---------------------------------------------------------------------------

const COUNTER_NAME = 'workflow_local_engine_fallback_total';

function makeCounter(): Counter<string> {
  // Re-use any existing registration so test resets / hot reloads don't double-register.
  const existing = register.getSingleMetric(COUNTER_NAME) as Counter<string> | undefined;
  if (existing) return existing;
  return new Counter({
    name: COUNTER_NAME,
    help: 'Count of workflow executions that ran in the api in-process engine instead of the dedicated workflows-service. Should be ZERO in any healthy deploy.',
    registers: [register],
  });
}

const localEngineFallbackCounter = makeCounter();

// Test seam — also lets the test read the counter via globalThis without
// having to import prom-client just to inspect a value.
let testCount = 0;
(globalThis as any).__workflowFallbackCounter = {
  value: () => testCount,
};

export function __resetLocalEngineFallbackCount(): void {
  testCount = 0;
}

// ---------------------------------------------------------------------------
// reportLocalEngineFallback — call this AT every site that falls back
// to the local engine. Logs a clear WARN + bumps the counter.
// ---------------------------------------------------------------------------

export interface FallbackReport {
  workflowId: string;
  executionId: string;
  logger: { warn: (meta: unknown, msg: string) => void; info: Function; error: Function };
}

export function reportLocalEngineFallback(report: FallbackReport): void {
  const { workflowId, executionId, logger } = report;
  localEngineFallbackCounter.inc(1);
  testCount += 1;
  logger.warn(
    { workflowId, executionId },
    '[Workflows] Falling back to in-process engine — WORKFLOW_SERVICE_URL is unset. The dedicated workflows-service pod is the supported path; this fallback will be removed in Phase B of the decoupling.',
  );
}
