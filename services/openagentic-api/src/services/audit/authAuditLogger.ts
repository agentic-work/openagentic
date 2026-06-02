/**
 * AuthAuditLogger — first-class persistence of authentication events.
 *
 * Authentication events (login / logout / failed login / token refresh / SSO)
 * were previously either not recorded at all (local login/logout) or buried
 * inside admin_audit_log.details JSON (Azure callback), where they could not
 * be queried as their own event/provider/success columns.
 *
 * This helper writes ONE normalized row per auth event into auth_audit_log,
 * which the unified admin audit feed (/api/admin/audit-logs) UNIONs alongside
 * the other activity sources.
 *
 * Contract: best-effort. logAuthEvent NEVER throws into the auth path — a DB
 * failure is swallowed and logged, so a degraded audit table can never block
 * a user from logging in or out.
 */

import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

export type AuthEvent =
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'token_refresh'
  | 'sso_login';

export interface AuthAuditEntry {
  /** The kind of auth event. */
  event: AuthEvent;
  /** Identity provider that handled the event ('local' | 'azure' | ...). */
  provider: string;
  /** Whether the event succeeded (false for failed logins, denied refresh, etc.). */
  success: boolean;
  /** DB user id — nullable: a failed login may not resolve to a known user. */
  userId?: string | null;
  /** Email/username the event was attempted for (recorded even when userId is null). */
  userEmail?: string | null;
  /** Originating IP, best-effort from request.ip. */
  ipAddress?: string | null;
  /** Raw user-agent string, best-effort from the request headers. */
  userAgent?: string | null;
  /** Structured extra context (e.g. failure reason, tenant, isNewUser). No secrets. */
  detail?: Record<string, unknown> | null;
}

/**
 * Persist a single auth event. Best-effort: swallows + logs any error so the
 * auth route is never broken by an audit write.
 */
export async function logAuthEvent(entry: AuthAuditEntry): Promise<void> {
  try {
    await prisma.authAuditLog.create({
      data: {
        user_id: entry.userId ?? null,
        user_email: entry.userEmail ?? null,
        event: entry.event,
        provider: entry.provider,
        success: entry.success,
        ip_address: entry.ipAddress ?? null,
        user_agent: entry.userAgent ?? null,
        detail: (entry.detail ?? undefined) as never,
      },
    });
  } catch (error) {
    // Never throw into the auth path — a failed audit write must not block login.
    loggers.auth.warn(
      { err: error, event: entry.event, provider: entry.provider, success: entry.success },
      '[AUTH-AUDIT] Failed to persist auth event (non-fatal)',
    );
  }
}
