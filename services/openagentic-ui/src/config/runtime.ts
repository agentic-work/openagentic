/**
 * Runtime Configuration
 * Reads configuration from window.__CONFIG__ (set by docker entrypoint)
 * Falls back to build-time environment variables for development
 */

// Declare global window config
declare global {
  interface Window {
    __CONFIG__?: Record<string, string>;
  }
}

// Runtime config getter
function getRuntimeConfig(key: string, fallback: string = ''): string {
  // Try runtime config first (production)
  if (typeof window !== 'undefined' && window.__CONFIG__) {
    const value = window.__CONFIG__[key];
    if (value !== undefined && value !== `${key}_PLACEHOLDER`) {
      return value;
    }
  }
  
  // Fall back to build-time env vars (development)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const value = import.meta.env[key];
    if (value !== undefined) {
      return value;
    }
  }
  
  return fallback;
}

// Runtime configuration values
export function getApiUrl(): string {
  return getRuntimeConfig('VITE_API_URL', '');
}

/**
 * @deprecated SECURITY WARNING: API keys and secrets should NEVER be exposed in client-side code.
 * These values are visible to anyone who inspects the JavaScript bundle or window.__CONFIG__.
 * For API authentication, use server-side token exchange or httpOnly cookies instead.
 *
 * These functions are kept for backwards compatibility but will log warnings in development.
 */
export function getApiKey(): string {
  if (import.meta.env.DEV) {
    console.warn('[Security] getApiKey() exposes secrets in client-side code. Use server-side auth instead.');
  }
  return getRuntimeConfig('VITE_API_KEY', '');
}

/**
 * @deprecated SECURITY WARNING: Secrets should NEVER be in client-side code.
 */
export function getFrontendSecret(): string {
  if (import.meta.env.DEV) {
    console.warn('[Security] getFrontendSecret() exposes secrets in client-side code. This is a security risk.');
  }
  return getRuntimeConfig('VITE_FRONTEND_SECRET', '');
}

/**
 * @deprecated SECURITY WARNING: Signing secrets should NEVER be in client-side code.
 * JWT signing must be done server-side only.
 */
export function getSigningSecret(): string {
  if (import.meta.env.DEV) {
    console.warn('[Security] getSigningSecret() exposes secrets in client-side code. JWT signing must be server-side.');
  }
  return getRuntimeConfig('VITE_SIGNING_SECRET', '');
}

// Auth mode removed - unified authentication supports both local and Microsoft login

export function getMaintenanceMode(): boolean {
  const value = getRuntimeConfig('VITE_MAINTENANCE_MODE', 'false');
  return value === 'true';
}

export function getDevLoginPage(): boolean {
  const value = getRuntimeConfig('VITE_DEV_LOGIN_PAGE', 'false');
  return value === 'true';
}

// OpenAgenticflows Service URL
export function getWorkflowsApiUrl(): string {
  return getRuntimeConfig('VITE_WORKFLOWS_API_URL', 'http://localhost:3002/api');
}

// ===== AUTH PROVIDER CONFIGURATION =====
// Local username/password is the only supported auth provider.

/**
 * Check if local admin login is enabled.
 * Local auth is the sole provider, so this is always true.
 */
export function isLocalLoginEnabled(): boolean {
  return true;
}

/**
 * Export runtime config object for debugging
 * SECURITY: Only available in development mode to prevent config leakage
 */
export function getRuntimeConfigObject(): Record<string, string> {
  if (!import.meta.env.DEV) {
    console.warn('[Security] getRuntimeConfigObject() is disabled in production');
    return {};
  }
  return typeof window !== 'undefined' ? (window.__CONFIG__ || {}) : {};
}