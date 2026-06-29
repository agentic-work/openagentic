/**
 * Phase A — workflows pod is up, configured, and idle. Add observability
 * so any silent fallback to the api-side WorkflowExecutionEngine is
 * loud, counted, and impossible to miss in prod logs.
 *
 * The guard does NOT throw — Phase B rips the engine; Phase A makes
 * fallback traffic surface so we can confirm it's zero before the rip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reportLocalEngineFallback,
  isWorkflowServiceConfigured,
  __resetLocalEngineFallbackCount,
} from '../workflowServiceUrlGuard.js';

describe('workflowServiceUrlGuard', () => {
  beforeEach(() => {
    __resetLocalEngineFallbackCount();
  });

  describe('isWorkflowServiceConfigured', () => {
    it('returns true when WORKFLOW_SERVICE_URL is set to a non-empty string', () => {
      expect(isWorkflowServiceConfigured('http://workflows:3400')).toBe(true);
    });

    it('returns false when undefined', () => {
      expect(isWorkflowServiceConfigured(undefined)).toBe(false);
    });

    it('returns false when empty string', () => {
      expect(isWorkflowServiceConfigured('')).toBe(false);
    });

    it('returns false when whitespace-only', () => {
      expect(isWorkflowServiceConfigured('   ')).toBe(false);
    });
  });

  describe('reportLocalEngineFallback', () => {
    it('logs at WARN level with the workflowId and a clear message', () => {
      const warn = vi.fn();
      const logger = { warn, info: vi.fn(), error: vi.fn() } as any;
      reportLocalEngineFallback({ workflowId: 'wf-123', executionId: 'exec-abc', logger });
      expect(warn).toHaveBeenCalledOnce();
      const [meta, msg] = warn.mock.calls[0];
      expect(meta).toMatchObject({ workflowId: 'wf-123', executionId: 'exec-abc' });
      expect(msg).toMatch(/local.*engine|fallback|deprecated/i);
    });

    it('increments the fallback counter so prod metrics can prove zero', () => {
      const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as any;
      reportLocalEngineFallback({ workflowId: 'a', executionId: 'a-1', logger });
      reportLocalEngineFallback({ workflowId: 'b', executionId: 'b-1', logger });
      reportLocalEngineFallback({ workflowId: 'c', executionId: 'c-1', logger });
      // Metric is exposed via counter; reading the registry value proves it.
      const reg = (globalThis as any).__workflowFallbackCounter;
      expect(reg).toBeDefined();
      expect(reg.value()).toBe(3);
    });
  });
});
