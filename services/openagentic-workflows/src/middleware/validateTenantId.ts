/**
 * validateTenantId — Task 1.3 of the V3 Enterprise Chatmode plan.
 *
 * Substrate fix S5: every workflow-execution route receives a `tenantId`
 * on the wire from the api caller (which derives it from the JWT
 * `azure_tenant_id`/`tid` claim). This validator is the receive-side
 * defense-in-depth — if the caller skipped the contract or sent
 * empty/whitespace, we 400 immediately rather than letting the request
 * fall through to a route handler that might run un-tenanted Prisma.
 *
 * Task 1.4 will then wrap each route in `withTenant({ tenantId }, ...)`
 * so the AsyncLocalStorage-backed Prisma extension auto-filters every
 * query. This task is the prerequisite — Task 1.4 needs a validated
 * non-empty tenantId on the body before it can do anything useful.
 *
 * Wire format / error shape (frozen so the api caller can structurally
 * check for the contract violation in tests + ops):
 *
 *   400 { error: 'missing_tenant_id' }
 *
 * The api caller (executeViaWorkflowsService / resumeViaWorkflowsService)
 * already fail-CLOSES upstream of this — but a 4xx here surfaces any
 * gap in the contract chain (e.g. a future direct-axios caller that
 * forgot to include tenantId).
 */
import type { FastifyReply } from 'fastify';

export interface BodyWithTenantId {
  tenantId?: unknown;
}

/**
 * Validate that a workflow-execution request body carries a non-empty
 * string `tenantId`. Returns `true` if valid (caller proceeds);
 * returns `false` after sending a 400 reply (caller MUST early-return).
 */
export function validateTenantId(body: BodyWithTenantId | undefined | null, reply: FastifyReply): boolean {
  const v = (body && typeof body === 'object') ? body.tenantId : undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    reply.code(400).send({ error: 'missing_tenant_id' });
    return false;
  }
  return true;
}
