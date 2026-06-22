/**
 * Row-Level Security Context Middleware (NIST 800-53 AC-4)
 *
 * Sets the PostgreSQL session variable `app.current_user_id` for each authenticated
 * request so that RLS policies can enforce per-user data isolation at the database level.
 *
 * This is a defense-in-depth measure: even if application-level authorization is
 * bypassed, the database will only return rows belonging to the authenticated user.
 *
 * The variable is set with SET LOCAL, which is transaction-scoped and auto-clears
 * when the transaction (or statement) completes.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

/**
 * Fastify preHandler hook that sets the RLS user context on the current
 * database connection before any Prisma queries execute.
 *
 * Must be registered AFTER the auth middleware so that request.user is populated.
 * For admin users, sets the context to '__system__' to match the admin bypass policy.
 * For unauthenticated requests (health checks, etc.), this hook is a no-op.
 */
export async function rlsContextHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = (request as any).user;

  if (!user?.userId) {
    // No authenticated user (e.g., health check endpoints) - skip RLS context
    return;
  }

  try {
    // Admin users get the '__system__' context to bypass RLS for admin operations
    const rlsUserId = user.isAdmin ? '__system__' : user.userId;

    // SET LOCAL is transaction-scoped: it auto-clears when the implicit transaction ends.
    // Using parameterized query to prevent SQL injection.
    await prisma.$executeRawUnsafe(
      `SET LOCAL "app.current_user_id" = '${rlsUserId.replaceAll("'", "''")}'`
    );
  } catch (error) {
    // Log but don't block the request - RLS policies will deny access if the variable
    // isn't set, which is the safe default (fail-closed).
    loggers.auth.warn({
      userId: user.userId,
      error: (error as Error).message,
    }, '[RLS] Failed to set user context - database queries may be restricted');
  }
}
