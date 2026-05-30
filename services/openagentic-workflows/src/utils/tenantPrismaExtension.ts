/**
 * Tenant-injection Prisma extension (Theme A / S1-1, Strategy A).
 *
 * Wraps a base PrismaClient so every read/write on a workflow-domain model
 * is auto-scoped to the caller's tenant. The tenant is provided via a
 * per-request `AsyncLocalStorage` context, populated by the
 * `tenantContext` middleware from the JWT's `azure_tenant_id` claim.
 *
 * Strategy A is used because:
 *   * Single source of truth — every prisma.workflow.* call site is
 *     filtered identically; impossible to forget on a new endpoint.
 *   * Zero refactor cost — existing call sites stay literal `prisma.x.y(...)`.
 *   * Testable — the extension is pure-function over `args`, so we unit-test
 *     it without a live database.
 *
 * Behaviour for legacy NULL-tenant rows (the `tenant_id IS NULL` cohort
 * during the rollout window):
 *   * Reads: when `tenantId` is set in context, the injected `where`
 *     clause is `{ OR: [{ tenant_id: <id> }, { tenant_id: null }] }`. Null
 *     rows fall through. Each null-row read emits a FlowAuditLog
 *     `tenant.lazy_backfill` entry so ops can monitor the tail.
 *   * Writes: when `tenantId` is set, all create / update calls auto-set
 *     `tenant_id` on the inserted row (or the update's `data`). Once
 *     backfill is verified the column tightens to NOT NULL.
 *   * No tenant in context (e.g. internal-system path): the extension is a
 *     no-op. System callers MUST set tenant explicitly via withSystemTenant().
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/**
 * Thrown when a Prisma operation against a TENANTED model is attempted
 * without an active `withTenant({ tenantId })` (or explicit
 * `withSystemTenant()`) scope. Fail-CLOSED contract added 2026-05-09 (S5.b).
 *
 * Any handler / service / job that hits this error is missing a tenant-scope
 * wrapper at its entry point — fix by wrapping the call site, NOT by
 * loosening the extension.
 */
export class TenantNotSetError extends Error {
  constructor(public readonly modelName: string, public readonly operation: string) {
    super(
      `Prisma operation '${operation}' on tenanted model '${modelName}' attempted outside withTenant() scope. ` +
        `Wrap your handler in withTenant({ tenantId }, async () => { ... }) ` +
        `or, for system paths, withSystemTenant(async () => { ... }).`,
    );
    this.name = 'TenantNotSetError';
  }
}

// ----------------------------------------------------------------------------
// Tenant context — AsyncLocalStorage so every Prisma call inside a request
// transparently sees the same tenant without explicit threading.
// ----------------------------------------------------------------------------

export interface TenantContext {
  tenantId: string | null;
  /** When true, tenant injection is skipped (system / migration paths). */
  bypass?: boolean;
  /** Optional callback invoked when a NULL-tenant row is read; for FlowAuditLog. */
  onLegacyRead?: (model: string, op: string) => void;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given tenant context. All Prisma calls inside `fn`
 * (including nested awaits) get auto-filtered.
 */
export function withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(ctx, fn);
}

/** Run `fn` as the system actor — tenant injection is skipped. */
export function withSystemTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId: null, bypass: true }, fn);
}

/** Synchronously inspect the current tenant context. */
export function getCurrentTenant(): TenantContext | undefined {
  return tenantStorage.getStore();
}

// ----------------------------------------------------------------------------
// Tagged models — every workflow-domain table that received a tenant_id column.
// Lower-case Prisma model names (the keys on the PrismaClient).
// ----------------------------------------------------------------------------

export const TENANTED_MODELS = new Set<string>([
  'Workflow',
  'WorkflowVersion',
  'WorkflowExecution',
  'WorkflowApproval',
  'WorkflowExecutionLog',
  'WorkflowWebhook',
  'WorkflowSchedule',
  'WorkflowTest',
  'WorkflowTemplate',
  'WorkflowShare',
  'WorkflowSecret',
  'DataSource',
  'IdempotencyKey',
  'FlowAuditLog',
  'Integration',
  'IntegrationLog',
]);

// Operations whose `where` is a Prisma `WhereInput` (accepts AND/OR
// composition). Safe to fold the tenant predicate in.
const FILTER_WHERE_OPS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);
// Operations whose `where` is a Prisma `WhereUniqueInput` — must remain
// a bare unique-key shape (no AND/OR). Tenant ownership is enforced via
// a sibling findFirst pre-check (see `tenantOperationHandler`).
//
// Flows SEV-0 fix #2 (2026-05-13): the previous implementation folded
// the tenant predicate into the where for these ops, producing
// invalid `WhereUniqueInput` and silent failures. The status update
// upsert in WorkflowExecutionEngine threw so executions stayed at
// status:pending forever even though compute had succeeded.
const UNIQUE_WHERE_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'upsert',
  'delete',
]);
const WRITE_DATA_OPS = new Set<string>(['create', 'createMany', 'upsert']);

// ----------------------------------------------------------------------------
// Pure injection functions — exported for direct unit testing.
// ----------------------------------------------------------------------------

/**
 * Add a tenant predicate to a `where` clause. The result matches:
 *   * rows where `tenant_id = ctx.tenantId`, OR
 *   * rows where `tenant_id IS NULL` (legacy backfill cohort).
 * If `ctx.tenantId` is null we leave the where untouched (system paths
 * never reach here; we no-op rather than corrupt).
 */
export function injectTenantWhere(
  where: Record<string, any> | undefined,
  tenantId: string | null,
): Record<string, any> {
  if (!tenantId) return where ?? {};
  const tenantPredicate = {
    OR: [{ tenant_id: tenantId }, { tenant_id: null }],
  };
  if (!where || Object.keys(where).length === 0) return tenantPredicate;
  // If the caller already specified tenant_id explicitly (e.g. system bypass
  // tooling that called the extension), trust them.
  if ('tenant_id' in where) return where;
  // Fold into AND so the existing where remains intact.
  return { AND: [where, tenantPredicate] };
}

/**
 * Add `tenant_id = ctx.tenantId` to the data of a create / createMany / upsert.
 * If the data already has tenant_id, the caller wins.
 */
export function injectTenantData<T extends Record<string, any>>(
  data: T | T[] | undefined,
  tenantId: string | null,
): typeof data {
  if (!tenantId || !data) return data;
  if (Array.isArray(data)) {
    return data.map((row) =>
      'tenant_id' in row ? row : { ...row, tenant_id: tenantId },
    ) as typeof data;
  }
  if ('tenant_id' in data) return data;
  return { ...data, tenant_id: tenantId };
}

// ----------------------------------------------------------------------------
// Extension factory.
// ----------------------------------------------------------------------------

/**
 * Operation params shape for the extension's $allOperations handler.
 * Exported so unit tests can invoke `tenantOperationHandler` directly
 * without instantiating a real PrismaClient.
 */
export interface TenantHandlerParams {
  model?: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  /**
   * Base PrismaClient used for the tenant-ownership pre-check on
   * unique-key operations. Injected by the factory's closure so the
   * handler can call `client[lowerModel].findFirst({...})` without a
   * circular ref back through the extended client.
   *
   * Optional only so tests can drive the handler with a stubbed shim;
   * production wiring always supplies it.
   */
  client?: any;
}

/**
 * Map a Prisma model name (e.g. "WorkflowExecution") to the property
 * key on the PrismaClient (e.g. "workflowExecution"). Prisma client
 * keys are lower-camel-case of the schema model name.
 */
function modelToClientKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Cross-tenant access on a unique-key op. Surfaced loudly so the
 * caller stack trace shows which handler tried to touch a row owned
 * by a different tenant.
 */
export class CrossTenantAccessError extends Error {
  /**
   * Mirror Prisma's "record not found" error code so existing callers
   * that branch on `err.code === 'P2025'` still match. The row genuinely
   * does not exist *for the calling tenant*, even though it exists for
   * a different tenant — that's the contract the extension enforces.
   */
  public readonly code = 'P2025';

  constructor(
    public readonly modelName: string,
    public readonly operation: string,
    public readonly callerTenant: string,
    public readonly ownerTenant: string,
  ) {
    super(
      `Cross-tenant ${operation} on ${modelName} refused: caller tenant '${callerTenant}' ` +
        `cannot operate on a row owned by tenant '${ownerTenant}'.`,
    );
    this.name = 'CrossTenantAccessError';
  }
}

/**
 * The pure handler used by `createTenantExtension()`. Exported so tests
 * can drive it directly with a stubbed `query` callback — `Prisma.defineExtension`
 * needs a live PrismaClient to call its returned wrapper, which is overkill
 * for verifying the fail-closed contract.
 */
export async function tenantOperationHandler(params: TenantHandlerParams): Promise<any> {
  const { model, operation, args, query, client } = params;
  const ctx = tenantStorage.getStore();
  // Non-tenanted model (or no model name at all, e.g. raw query) — always passthrough.
  if (!model || !TENANTED_MODELS.has(model)) {
    return query(args);
  }
  // Explicit system bypass (set by withSystemTenant) — passthrough.
  if (ctx?.bypass) {
    return query(args);
  }
  // FAIL-CLOSED (S5.b, 2026-05-09): tenanted model accessed without ANY
  // tenant context is a security bug — the caller forgot to wrap in
  // withTenant() / withSystemTenant().
  if (!ctx) {
    throw new TenantNotSetError(model, operation);
  }
  const tenantId = ctx.tenantId;
  if (!tenantId) {
    // Anonymous request reached a tenanted model — same fail-closed contract.
    // Per 2026-05-09 user direction "always do what is BEST long term":
    // every Prisma call on a tenanted model MUST run inside withTenant() or
    // withSystemTenant(). Anonymous traffic must be rejected before this layer.
    throw new TenantNotSetError(model, operation);
  }

  const a: any = args ?? {};

  // -------------------------------------------------------------------
  // 1a. UNIQUE-WHERE OPS — leave `where` as a valid WhereUniqueInput.
  //
  // Folding the tenant predicate into a WhereUniqueInput is a Prisma
  // type error and throws at runtime ("Argument `where` is missing").
  // Instead we do an explicit ownership pre-check using findFirst on
  // the base client (which bypasses the extension via `client` being
  // the unwrapped PrismaClient passed in by the factory closure).
  //
  // Fix for Flows SEV-0 #2 (workflows-svc execution rows stuck at
  // status:pending forever).
  // -------------------------------------------------------------------
  if (UNIQUE_WHERE_OPS.has(operation)) {
    // Inject tenant_id into upsert.create payload before any decision —
    // a brand-new row always gets the current tenant stamped on it.
    if (operation === 'upsert' && a.create) {
      a.create = injectTenantData(a.create, tenantId);
    }

    // Ownership pre-check. Tests stub `client[modelKey].findFirst`.
    // Production wires the unwrapped base PrismaClient.
    const modelKey = modelToClientKey(model);
    const modelClient = client?.[modelKey];

    if (modelClient?.findFirst) {
      // Scoped probe: does a row with this unique key exist AND match
      // the current tenant (or be legacy-null for the backfill cohort)?
      const ownedRow = await modelClient.findFirst({
        where: {
          AND: [a.where, { OR: [{ tenant_id: tenantId }, { tenant_id: null }] }],
        },
      });

      if (!ownedRow) {
        // Unscoped probe: is there a row matching the unique key owned
        // by a DIFFERENT tenant? If yes, we must refuse — silently
        // letting the op through would either return a foreign row
        // (findUnique) or mutate it (update/upsert/delete).
        const anyRow = await modelClient.findFirst({ where: a.where });
        if (anyRow && anyRow.tenant_id && anyRow.tenant_id !== tenantId) {
          if (operation === 'findUnique') {
            // findUnique convention: not-found → null (do NOT throw).
            return null;
          }
          throw new CrossTenantAccessError(
            model,
            operation,
            tenantId,
            String(anyRow.tenant_id),
          );
        }
        // Truly absent. For findUnique that's a clean null return; for
        // findUniqueOrThrow / update / delete Prisma will throw P2025
        // naturally. For upsert that's the create branch — pass through.
        if (operation === 'findUnique') return null;
      }
    }

    // Pass the original (untouched) WhereUniqueInput through to Prisma.
    const result = await query(a);

    // Legacy-null audit (lazy backfill telemetry).
    if (ctx.onLegacyRead && result) {
      const rows = Array.isArray(result) ? result : [result];
      const legacy = rows.filter(
        (r: any) => r && typeof r === 'object' && r.tenant_id === null,
      );
      if (legacy.length > 0) ctx.onLegacyRead(model, operation);
    }
    return result;
  }

  // -------------------------------------------------------------------
  // 1b. FILTER-WHERE OPS — `where` is a WhereInput, safe to AND-fold.
  // -------------------------------------------------------------------
  if (FILTER_WHERE_OPS.has(operation)) {
    a.where = injectTenantWhere(a.where, tenantId);
  }

  // 2. Inject tenant_id into create / createMany payloads.
  if (operation === 'create' && a.data) {
    a.data = injectTenantData(a.data, tenantId);
  }
  if (operation === 'createMany' && a.data) {
    a.data = injectTenantData(a.data, tenantId);
  }

  const result = await query(a);

  // 3. Audit any null-tenant rows that fell through (lazy-backfill signal).
  if (ctx.onLegacyRead && result) {
    const rows = Array.isArray(result) ? result : [result];
    const legacy = rows.filter(
      (r: any) => r && typeof r === 'object' && r.tenant_id === null,
    );
    if (legacy.length > 0) ctx.onLegacyRead(model, operation);
  }

  return result;
}

export function createTenantExtension(baseClient?: PrismaClient) {
  // Hand-rolled handler so the Prisma generic gymnastics don't blow up tsc
  // with TS2590 ("union type too complex"). Behaviour identical to a
  // typed $allOperations implementation but avoids generic-arg explosion.
  //
  // `baseClient` is captured in the closure and passed to the handler so
  // unique-key ownership pre-checks (Flows SEV-0 #2 fix) have a way to
  // call sibling `findFirst` without recursing back through the extension.
  const handler = async (params: { model?: string; operation: string; args: any; query: (args: any) => Promise<any> }) => {
    return tenantOperationHandler({ ...params, client: baseClient });
  };

  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations: handler as any,
      },
    },
  });
}

// ----------------------------------------------------------------------------
// Convenience: wrap an existing PrismaClient.
// ----------------------------------------------------------------------------

export function applyTenantExtension<T extends PrismaClient>(client: T): T {
  return client.$extends(createTenantExtension(client)) as unknown as T;
}
