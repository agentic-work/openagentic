/**
 * Tenant context middleware (Theme A / S1-1).
 *
 * Extracts the caller's tenant from the JWT (`azure_tenant_id` claim or the
 * authenticated User row's `azure_tenant_id`), stamps it on
 * `request.tenantId`, and runs the rest of the route handler inside an
 * AsyncLocalStorage scope so the Prisma tenant-injection extension auto-
 * filters every subsequent query.
 *
 * Order: this middleware MUST run AFTER `unifiedAuth` (which populates
 * `request.user`) and BEFORE any route handler that touches Prisma.
 *
 * Failure mode: if a request reaches a tenanted route with no tenant
 * resolvable, the request still proceeds — but the Prisma extension's
 * fail-open path (no tenant => no filter) means we must NOT rely on this
 * middleware as the sole gate. Routes that handle tenanted models also
 * call `requireTenant(request)` which 401s if missing.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { withTenant, type TenantContext } from '../utils/tenantPrismaExtension.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Caller's tenant id, derived from JWT or user row. Null for legacy / anon. */
    tenantId?: string | null;
  }
}

export interface TenantExtractor {
  (request: FastifyRequest): string | null | undefined;
}

/** Default extractor: prefer the JWT claim, fall back to the user-row column. */
export const defaultTenantExtractor: TenantExtractor = (request) => {
  const u: any = (request as any).user;
  if (!u) return null;
  // The Azure AD JWT claim that Microsoft Identity Platform uses.
  if (u.tenantId) return u.tenantId;
  if (u.azure_tenant_id) return u.azure_tenant_id;
  if (u.tid) return u.tid;
  return null;
};

/**
 * Resolve the tenant for the current request and stamp it on `request.tenantId`.
 * Does NOT enter the AsyncLocalStorage scope itself — that's the caller's job
 * via `runWithTenantContext`.
 */
export function resolveTenant(
  request: FastifyRequest,
  extract: TenantExtractor = defaultTenantExtractor,
): string | null {
  const tenantId = extract(request) ?? null;
  (request as any).tenantId = tenantId;
  return tenantId;
}

/**
 * Wrap a Fastify route handler so every Prisma call inside runs with the
 * caller's tenant in AsyncLocalStorage.
 */
export function runWithTenantContext<T>(
  request: FastifyRequest,
  fn: () => Promise<T>,
  ctxOverrides: Partial<TenantContext> = {},
): Promise<T> {
  const tenantId = (request as any).tenantId ?? null;
  return withTenant({ tenantId, ...ctxOverrides }, fn);
}

/**
 * Throw a tagged 401-equivalent if the request has no resolvable tenant.
 * Routes that touch tenanted models call this to defense-in-depth the
 * Prisma extension (which fail-opens for null tenants).
 */
export class TenantRequiredError extends Error {
  readonly statusCode = 401;
  readonly code = 'TENANT_REQUIRED';
  constructor() {
    super('Request has no resolvable tenant_id');
    this.name = 'TenantRequiredError';
  }
}

export function requireTenant(request: FastifyRequest): string {
  const tenantId = (request as any).tenantId;
  if (!tenantId) throw new TenantRequiredError();
  return tenantId;
}

/**
 * Fastify plugin: install an `onRequest` hook that resolves + stamps the
 * tenant for every request. The actual AsyncLocalStorage scope is entered
 * per-route via `preHandler` (so we don't pay for non-tenanted routes).
 */
export async function tenantContextPlugin(server: FastifyInstance) {
  server.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    resolveTenant(request);
  });
}
