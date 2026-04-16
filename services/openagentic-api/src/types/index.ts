/**
 * Unified type definitions for the application
 */

import { FastifyRequest, FastifyReply } from 'fastify';

// Settings interface
export interface Settings {
  theme?: 'light' | 'dark' | 'system';
  apiKeys?: Record<string, string>;
  [key: string]: any;
}

// Unified user payload that works for both Azure AD and local auth
export interface UserPayload {
  // Core fields (always present after auth)
  id: string;  // User ID (from database or Azure oid)
  email: string;  // Always set by auth middleware
  groups: string[];
  isAdmin: boolean;

  // Azure AD specific fields
  oid?: string;  // Made optional for local auth
  azureOid?: string;
  azureTenantId?: string;
  preferred_username?: string;
  name?: string;

  // Local auth specific fields - always set by auth middleware
  userId: string;  // Always set by auth middleware
  localAccount: boolean;  // Always set by auth middleware

  // Token fields
  accessToken?: string;  // Set by auth middleware (optional for local accounts)
  refreshToken?: string;
}

// Extend FastifyRequest with our user type
declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

// Authenticated request interface for routes that require auth
export interface AuthenticatedRequest extends FastifyRequest {
  user: UserPayload;  // Not optional in authenticated context
  requestId?: string; // Added for logging middleware
}

// Admin request interface for admin-only routes
export interface AdminRequest extends AuthenticatedRequest {
  user: UserPayload & { isAdmin: true };
}

// Remove duplicate export since interfaces are already exported above

// Type guards
export function isAuthenticated(request: FastifyRequest): request is AuthenticatedRequest {
  return !!request.user && !!request.user.id;
}

export function isAdmin(request: FastifyRequest): request is AdminRequest {
  return isAuthenticated(request) && request.user.isAdmin === true;
}

// Common route parameter types
export interface IdParam {
  id: string;
}

export interface PaginationQuery {
  limit?: string;
  offset?: string;
  search?: string;
}

export interface TimeframeQuery {
  startDate?: string;
  endDate?: string;
  timeframe?: 'today' | 'week' | 'month' | 'year';
}

// Note: fastify-augmentation.js doesn't exist yet, commenting out for now
// export * from './fastify-augmentation.js';

// Make sure all types are available
export default {};