/**
 * Shared WS auth helper for code-ws handlers.
 *
 * Used by: events.ts, progress.ts, terminal.ts
 *
 * Validates the bearer token from the WS query string, checks the AWCode
 * permission, and closes the socket with the appropriate close code on
 * failure.  Returns null when access should be denied (socket already
 * closed); returns the resolved user + access flag on success.
 *
 * Extracted as part of Wave D Fix D2 — refactor(code-ws): extract shared
 * auth helper from 4 WS handlers.
 */
import { loggers } from '../../utils/logger.js';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { UserPermissionsService } from '../../services/UserPermissionsService.js';
import { prisma } from '../../utils/prisma.js';
import type { UserContext } from '../../auth/azureADAuth.js';

export interface WsAuthResult {
  user: UserContext;
  canAccessAwcode: boolean;
}

/**
 * Validate a WS request and check AWCode permission.
 *
 * @param token  - Bearer token from request.query.token (may be undefined).
 * @param ws     - The live WebSocket connection; closed on auth failure.
 * @returns      - Resolved auth result or null (socket already closed).
 */
export async function validateWsRequest(
  token: string | undefined,
  ws: { close(code: number, reason: string): void },
): Promise<WsAuthResult | null> {
  // 1. Token presence check
  if (!token) {
    loggers.routes.warn('AWCode WS denied - no auth token provided');
    ws.close(4001, 'Authentication required');
    return null;
  }

  // 2. Token validity
  const tokenResult = await validateAnyToken(token, { logger: loggers.routes });
  if (!tokenResult.isValid || !tokenResult.user) {
    loggers.routes.warn({ error: tokenResult.error }, 'AWCode WS denied - invalid token');
    ws.close(4001, 'Invalid authentication token');
    return null;
  }

  const user = tokenResult.user;

  // 3. AWCode permission
  const permissionsService = new UserPermissionsService(prisma, loggers.routes);
  const canAccessAwcode = await permissionsService.canAccessAwcode(
    user.userId,
    user.isAdmin,
    user.groups || [],
  );

  if (!canAccessAwcode) {
    loggers.routes.warn({ userId: user.userId }, 'AWCode WS denied - user lacks permission');
    ws.close(4003, 'AWCode access denied - permission required');
    return null;
  }

  return { user, canAccessAwcode };
}
