/**
 * Chat API — AuthenticatedRequest type.
 *
 * The chat-local auth middleware was removed in the 2026-06-09 AAD/OBO/SSO
 * excision: the OSS edition is local-auth only, and the live auth hook is
 * `authMiddleware` / `authMiddlewarePlugin` in `middleware/unifiedAuth.ts`
 * (single trust root, HS256 algorithm-pinned). The old federated-token path
 * here decoded tokens without signature verification, which has no place in a
 * local-auth build.
 *
 * Only this `AuthenticatedRequest` shape is still consumed (by the sibling
 * logging/rate-limit chat middlewares), so this file is now just the type.
 */
import { FastifyRequest } from 'fastify';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    oid: string; // Required by UserPayload interface
    userId: string;  // Required by UserPayload
    email: string;
    name?: string;
    groups: string[];
    isAdmin: boolean;
    azureOid?: string;
    localAccount: boolean;  // Required by UserPayload
    accessToken?: string;  // Optional - only for Azure AD users
  };
  requestId?: string;
}
