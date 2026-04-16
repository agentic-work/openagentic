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

export function getAADClientId(): string {
  return getRuntimeConfig('VITE_AAD_CLIENT_ID', '');
}

export function getAzureTenantId(): string {
  return getRuntimeConfig('VITE_AZURE_TENANT_ID', '');
}

export function getAADAuthority(): string {
  return getRuntimeConfig('VITE_AAD_AUTHORITY', '');
}

export function getAADRedirectUri(): string {
  return getRuntimeConfig('VITE_AAD_REDIRECT_URI', '/auth/callback');
}

export function getAzureADAuthorizedGroups(): string {
  return getRuntimeConfig('VITE_AZURE_AD_AUTHORIZED_GROUPS', '');
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
// Controls which login buttons are shown on the login page

/**
 * Get the primary auth provider (google, azure-ad, all)
 * When set to a specific provider, only that login button is shown
 * When set to 'all', all enabled login buttons are shown
 */
export function getAuthProvider(): string {
  return getRuntimeConfig('VITE_AUTH_PROVIDER', 'all');
}

/**
 * Check if Microsoft/Azure AD login is enabled
 */
export function isMicrosoftLoginEnabled(): boolean {
  const provider = getAuthProvider();
  if (provider === 'google') return false;  // Google-only mode
  const value = getRuntimeConfig('VITE_MICROSOFT_LOGIN_ENABLED', 'true');
  return value !== 'false';
}

/**
 * Check if Google login is enabled
 */
export function isGoogleLoginEnabled(): boolean {
  const provider = getAuthProvider();
  // Azure-only mode - accept both 'azure' and 'azure-ad' values
  if (provider === 'azure-ad' || provider === 'azure') return false;
  const value = getRuntimeConfig('VITE_GOOGLE_LOGIN_ENABLED', 'true');
  return value !== 'false';
}

/**
 * Check if local admin login is enabled
 * This can be enabled alongside SSO for admin testing purposes
 * Set VITE_LOCAL_LOGIN_ENABLED=true to enable even with SSO providers
 */
export function isLocalLoginEnabled(): boolean {
  // Explicit override - if VITE_LOCAL_LOGIN_ENABLED is set, respect it
  const value = getRuntimeConfig('VITE_LOCAL_LOGIN_ENABLED', '');
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Default: disable local login for SSO-only providers
  const provider = getAuthProvider();
  if (provider === 'google' || provider === 'azure-ad' || provider === 'azure') return false;

  return true; // Default to enabled for local/development
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