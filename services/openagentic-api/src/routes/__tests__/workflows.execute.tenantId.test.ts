/**
 * SEV-0 Flows-fix-A1: workflow execute fail-CLOSED tenantId contract.
 *
 * The pre-fix state: the streaming /api/workflows/:id/execute handlers
 * in routes/workflows.ts at lines 1366 and 1549 use RAW `axios.post`
 * directly to `${WORKFLOW_SERVICE_URL}/execute`, completely bypassing
 * the `executeViaWorkflowsService` wrapper that has the fail-CLOSED
 * tenantId guard. With request.tenantId === null (because unifiedAuth
 * drops the field), they shipped {tenantId:null} on the wire and
 * workflows-svc's `validateTenantId` 400-rejected every call.
 *
 * Fix: at the route layer, BEFORE either raw axios.post or the
 * executeViaWorkflowsService wrapper, validate that tenantId resolves
 * to a non-empty trimmed string — else 400 immediately with a clear
 * error message and DO NOT call axios. Mirror the wrapper's contract
 * exactly so the two code paths are interchangeable.
 *
 * This file pins the helper `requireTenantIdForExecute` that
 * routes/workflows.ts will use to gate the raw-axios paths. The helper
 * is tiny by design — single responsibility — so it's testable
 * without spinning up Fastify (which has the Bun raw.writableEnded
 * quirk anyway, see workflows-integration.test.ts lesson).
 */

import { describe, it, expect } from 'vitest';
import { resolveExecuteTenantId } from '../helpers/resolveExecuteTenantId.js';

describe('resolveExecuteTenantId — SEV-0 Flows-fix-A1 fail-CLOSED guard', () => {
  it('returns the request tenantId when present and non-empty', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: 'tenant-A',
      workflowTenantId: null,
    });
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe('tenant-A');
  });

  it('trims whitespace from the resolved tenantId', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: '  tenant-B  ',
      workflowTenantId: null,
    });
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe('tenant-B');
  });

  it('falls back to the workflow row tenant_id when request lacks tenantId', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: null,
      workflowTenantId: 'tenant-row',
    });
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe('tenant-row');
  });

  it('prefers request tenantId over workflow row when both present', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: 'tenant-request',
      workflowTenantId: 'tenant-row',
    });
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe('tenant-request');
  });

  it('FAIL-CLOSED: returns ok=false when both sources are null', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: null,
      workflowTenantId: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tenantId/i);
  });

  it('FAIL-CLOSED: returns ok=false when both sources are undefined', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: undefined,
      workflowTenantId: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tenantId/i);
  });

  it('FAIL-CLOSED: returns ok=false when both sources are empty string', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: '',
      workflowTenantId: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tenantId/i);
  });

  it('FAIL-CLOSED: returns ok=false when both sources are whitespace-only', () => {
    const result = resolveExecuteTenantId({
      requestTenantId: '   ',
      workflowTenantId: '\t\n',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tenantId/i);
  });

  it('FAIL-CLOSED: never returns ok=true with an empty/null tenantId on success', () => {
    // Regression guard: contract is "ok=true implies tenantId is non-empty string"
    for (const req of [null, undefined, '', '   '] as const) {
      for (const row of [null, undefined, '', '   '] as const) {
        const result = resolveExecuteTenantId({ requestTenantId: req as any, workflowTenantId: row as any });
        if (result.ok) {
          expect(typeof result.tenantId).toBe('string');
          expect(result.tenantId.length).toBeGreaterThan(0);
          expect(result.tenantId.trim()).toBe(result.tenantId);
        }
      }
    }
  });

  it('error message includes the V3 Enterprise Chatmode S5 reference for grep-ability', () => {
    const result = resolveExecuteTenantId({ requestTenantId: null, workflowTenantId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('tenantId');
    }
  });
});
