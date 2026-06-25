/**
 * retry_with_backoff — engine wire-up guard.
 *
 * Pins the WorkflowExecutionEngine retry hook so a refactor can't silently
 * drop the per-node retry contract. The engine reads `node.data.retryPolicy`
 * (legacy `errorRecovery.retry` still supported as a fallback) and re-runs
 * the executor up to maxRetries times on a thrown error, emitting one
 * `node_retry` frame per attempt.
 *
 * Surface guarded by this test:
 *   1. The retry-policy lookup site reads `node.data.retryPolicy`
 *   2. The retry for-loop with `attempt <= maxRetries`
 *   3. The `node_retry` ExecutionEvent type and the emit() site
 *   4. calculateRetryDelay() exists on the engine class
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ENGINE = join(
  REPO_ROOT,
  'services/openagentic-workflows/src/services/WorkflowExecutionEngine.ts',
);

describe('retry_with_backoff — engine wire-up', () => {
  const text = readFileSync(ENGINE, 'utf8');

  it('reads node.data.retryPolicy from each node', () => {
    expect(text).toMatch(/node\.data\.retryPolicy/);
  });

  it('declares node_retry as an ExecutionEvent type', () => {
    expect(text).toMatch(/'node_retry'/);
  });

  it('runs the executor inside a retry for-loop driven by maxRetries', () => {
    expect(text).toMatch(/for\s*\(\s*let\s+attempt\s*=\s*0\s*;\s*attempt\s*<=\s*maxRetries\s*;/);
  });

  it('emits node_retry frames for each retry attempt', () => {
    expect(text).toMatch(/emitEvent\(\s*['"]node_retry['"]/);
  });

  it('computes per-attempt delay via calculateRetryDelay()', () => {
    expect(text).toMatch(/calculateRetryDelay\s*\(/);
  });
});
