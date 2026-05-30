/**
 * resolveExecuteTenantId — fail-CLOSED tenant resolver for the
 * /api/workflows/:id/execute hot path.
 *
 * SEV-0 Flows-fix-A1 (audit 2026-05-13): the streaming execute handler
 * in routes/workflows.ts uses RAW axios.post directly to workflows-svc
 * /execute, bypassing the executeViaWorkflowsService wrapper that has
 * the fail-CLOSED tenantId guard. This helper centralizes the same
 * contract so the raw-axios paths can gate cleanly BEFORE shipping
 * tenantId:null on the wire (which workflows-svc validateTenantId
 * 400-rejects → 41h of zero executions).
 *
 * Resolution order:
 *   1. request.tenantId (set by tenantContextPlugin from JWT tid claim)
 *   2. workflow row's tenant_id (defense-in-depth fallback)
 *   3. fail-CLOSED with ok=false
 *
 * Whitespace-only strings count as empty.
 */

export interface ResolveExecuteTenantIdInput {
  requestTenantId?: string | null;
  workflowTenantId?: string | null;
}

export type ResolveExecuteTenantIdResult =
  | { ok: true; tenantId: string }
  | { ok: false; error: string };

export function resolveExecuteTenantId(
  input: ResolveExecuteTenantIdInput,
): ResolveExecuteTenantIdResult {
  const req = typeof input.requestTenantId === 'string' ? input.requestTenantId.trim() : '';
  if (req) {
    return { ok: true, tenantId: req };
  }
  const row = typeof input.workflowTenantId === 'string' ? input.workflowTenantId.trim() : '';
  if (row) {
    return { ok: true, tenantId: row };
  }
  return {
    ok: false,
    error:
      'Workflow execute requires a tenantId — neither request.tenantId (from JWT tid claim) ' +
      "nor the workflow row's tenant_id was resolvable. Fail-CLOSED to prevent shipping " +
      'tenantId:null on the wire (V3 Enterprise Chatmode S5 / SEV-0 Flows-fix-A1).',
  };
}
