/**
 * Azure Token Service - Pure Frontend MSAL (NO Backend Secrets)
 *
 * This service uses MSAL Browser to acquire tokens directly from Azure AD
 * for multiple Azure API resources. All token acquisition happens in the
 * browser - NO service principal or client secret involved.
 *
 * The user's identity is used for ALL Azure API calls.
 */

import {
  PublicClientApplication,
  Configuration,
  AccountInfo,
  AuthenticationResult,
  InteractionRequiredAuthError,
  SilentRequest
} from '@azure/msal-browser';

// Azure API scopes - each requires a separate token with different audience
export const AZURE_SCOPES = {
  // Azure Resource Manager (ARM) - subscriptions, resource groups, VMs, etc.
  ARM: ['https://management.azure.com/.default'],

  // Microsoft Graph - user profile, groups, directory info
  GRAPH: ['https://graph.microsoft.com/.default'],

  // Azure Storage - blob, file, queue, table storage
  STORAGE: ['https://storage.azure.com/.default'],

  // Azure Key Vault - secrets, keys, certificates
  KEYVAULT: ['https://vault.azure.net/.default'],

  // Azure Log Analytics - query logs via Kusto
  LOGANALYTICS: ['https://api.loganalytics.io/.default'],

  // OpenID scopes for user info
  OPENID: ['openid', 'profile', 'email', 'offline_access']
};

// All Azure tokens packaged together
export interface AzureTokens {
  armToken: string | null;
  graphToken: string | null;
  storageToken: string | null;
  keyvaultToken: string | null;
  loganalyticsToken: string | null;
  idToken: string | null;
  refreshToken: string | null;  // The universal refresh token (works like az login)
  account: AccountInfo | null;
  expiresOn: Date | null;
  clientId: string | null;      // Needed for refresh token exchange
  tenantId: string | null;      // Needed for refresh token exchange
}

// MSAL Configuration - uses PUBLIC client (no secret)
const msalConfig: Configuration = {
  auth: {
    // App registration client ID - this is public, not a secret
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || '',

    // Azure AD tenant
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID || 'common'}`,

    // Redirect URI after authentication
    redirectUri: window.location.origin + '/auth/callback',

    // Post-logout redirect
    postLogoutRedirectUri: window.location.origin + '/login',

    // Navigate to the original page after login
    navigateToLoginRequestUrl: true
  },
  cache: {
    // Store tokens in localStorage for persistence across page refreshes
    cacheLocation: 'localStorage',

    // Enable token storage in cookies for SSR (if needed)
    storeAuthStateInCookie: false
  },
  system: {
    // Log level for debugging
    loggerOptions: {
      logLevel: import.meta.env.DEV ? 3 : 0, // Verbose in dev, silent in prod
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        console.log(`[MSAL] ${message}`);
      }
    }
  }
};

// Singleton MSAL instance
let msalInstance: PublicClientApplication | null = null;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize MSAL Public Client Application
 * Must be called before any other methods
 */
export async function initializeMsal(): Promise<PublicClientApplication> {
  if (msalInstance) {
    return msalInstance;
  }

  if (initializationPromise) {
    await initializationPromise;
    return msalInstance!;
  }

  initializationPromise = (async () => {
    console.log('[AzureTokenService] Initializing MSAL Public Client (NO backend secrets)');

    if (!msalConfig.auth.clientId) {
      console.warn('[AzureTokenService] VITE_AZURE_CLIENT_ID not set - Azure auth disabled');
      return;
    }

    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // Handle redirect promise (for redirect-based auth)
    try {
      const response = await msalInstance.handleRedirectPromise();
      if (response) {
        console.log('[AzureTokenService] Redirect response received', {
          account: response.account?.username,
          scopes: response.scopes
        });
      }
    } catch (error) {
      console.error('[AzureTokenService] Error handling redirect:', error);
    }

    console.log('[AzureTokenService] MSAL initialized successfully');
  })();

  await initializationPromise;
  return msalInstance!;
}

/**
 * Get the current logged-in account
 */
export function getActiveAccount(): AccountInfo | null {
  if (!msalInstance) return null;

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;

  // Return the active account or the first one
  return msalInstance.getActiveAccount() || accounts[0];
}

/**
 * Set the active account
 */
export function setActiveAccount(account: AccountInfo): void {
  if (!msalInstance) return;
  msalInstance.setActiveAccount(account);
}

/**
 * Login with Azure AD using popup (preferred for SPA)
 * Returns all Azure tokens for multiple resources
 */
export async function loginWithPopup(): Promise<AzureTokens> {
  const msal = await initializeMsal();
  if (!msal) {
    throw new Error('MSAL not initialized - Azure auth not configured');
  }

  console.log('[AzureTokenService] Starting login with popup...');

  try {
    // First, login with basic OpenID scopes
    const loginResponse = await msal.loginPopup({
      scopes: AZURE_SCOPES.OPENID
    });

    console.log('[AzureTokenService] Login successful', {
      account: loginResponse.account?.username,
      idToken: !!loginResponse.idToken
    });

    // Set the active account
    if (loginResponse.account) {
      msal.setActiveAccount(loginResponse.account);
    }

    // Now acquire tokens for all Azure APIs
    return await acquireAllTokens();

  } catch (error) {
    console.error('[AzureTokenService] Login failed:', error);
    throw error;
  }
}

/**
 * Login with Azure AD using redirect (for mobile/fallback)
 */
export async function loginWithRedirect(): Promise<void> {
  const msal = await initializeMsal();
  if (!msal) {
    throw new Error('MSAL not initialized - Azure auth not configured');
  }

  console.log('[AzureTokenService] Starting login with redirect...');

  await msal.loginRedirect({
    scopes: AZURE_SCOPES.OPENID
  });
}

/**
 * Acquire a token for a specific Azure resource
 * Uses silent acquisition first, falls back to popup if needed
 */
async function acquireTokenForResource(
  scopes: string[],
  resourceName: string
): Promise<string | null> {
  const msal = await initializeMsal();
  if (!msal) return null;

  const account = getActiveAccount();
  if (!account) {
    console.warn(`[AzureTokenService] No account for ${resourceName} token`);
    return null;
  }

  const silentRequest: SilentRequest = {
    scopes,
    account,
    forceRefresh: false
  };

  try {
    // Try silent token acquisition first
    console.log(`[AzureTokenService] Acquiring ${resourceName} token silently...`);
    const response = await msal.acquireTokenSilent(silentRequest);
    console.log(`[AzureTokenService] ${resourceName} token acquired silently`);
    return response.accessToken;

  } catch (error: any) {
    // Silent acquisition failed - try popup for ANY error (not just InteractionRequired)
    // This handles cases where MSAL throws different error types
    console.warn(`[AzureTokenService] Silent ${resourceName} failed: ${error?.message || error}, trying popup...`);

    try {
      const response = await msal.acquireTokenPopup({
        scopes,
        account
      });
      console.log(`[AzureTokenService] ${resourceName} token acquired via popup`);
      return response.accessToken;

    } catch (popupError: any) {
      // If popup also fails, log but don't crash - token will be null
      console.error(`[AzureTokenService] Failed to acquire ${resourceName} token via popup:`, popupError?.message || popupError);
      return null;
    }
  }
}

/**
 * Acquire tokens for ALL Azure resources
 * This is the main method to call after login
 */
export async function acquireAllTokens(): Promise<AzureTokens> {
  const msal = await initializeMsal();
  const account = getActiveAccount();

  if (!msal || !account) {
    console.warn('[AzureTokenService] Cannot acquire tokens - not logged in');
    return {
      armToken: null,
      graphToken: null,
      storageToken: null,
      keyvaultToken: null,
      loganalyticsToken: null,
      idToken: null,
      refreshToken: null,
      account: null,
      expiresOn: null,
      clientId: null,
      tenantId: null
    };
  }

  console.log('[AzureTokenService] Acquiring tokens for all Azure APIs...');

  // Acquire all tokens in parallel for performance
  const [armToken, graphToken, storageToken, keyvaultToken, loganalyticsToken] = await Promise.all([
    acquireTokenForResource(AZURE_SCOPES.ARM, 'ARM'),
    acquireTokenForResource(AZURE_SCOPES.GRAPH, 'Graph'),
    acquireTokenForResource(AZURE_SCOPES.STORAGE, 'Storage'),
    acquireTokenForResource(AZURE_SCOPES.KEYVAULT, 'KeyVault'),
    acquireTokenForResource(AZURE_SCOPES.LOGANALYTICS, 'LogAnalytics')
  ]);

  // Get the ID token from cache (was acquired during login)
  let idToken: string | null = null;
  try {
    const idTokenResponse = await msal.acquireTokenSilent({
      scopes: AZURE_SCOPES.OPENID,
      account
    });
    idToken = idTokenResponse.idToken;
  } catch (e) {
    console.warn('[AzureTokenService] Could not get ID token');
  }

  // Extract refresh token from MSAL cache - this is the key for "az login" style auth
  const refreshToken = extractRefreshToken();

  const tokens: AzureTokens = {
    armToken,
    graphToken,
    storageToken,
    keyvaultToken,
    loganalyticsToken,
    idToken,
    refreshToken,
    account,
    expiresOn: new Date(Date.now() + 3600000), // Tokens typically expire in 1 hour
    clientId: msalConfig.auth.clientId || null,
    tenantId: import.meta.env.VITE_AZURE_TENANT_ID || null
  };

  console.log('[AzureTokenService] Token acquisition complete', {
    hasARM: !!armToken,
    hasGraph: !!graphToken,
    hasStorage: !!storageToken,
    hasKeyVault: !!keyvaultToken,
    hasLogAnalytics: !!loganalyticsToken,
    hasIdToken: !!idToken,
    hasRefreshToken: !!refreshToken,
    account: account.username
  });

  return tokens;
}

/**
 * Refresh all tokens (call this periodically or before they expire)
 */
export async function refreshAllTokens(): Promise<AzureTokens> {
  const msal = await initializeMsal();
  if (!msal) {
    throw new Error('MSAL not initialized');
  }

  const account = getActiveAccount();
  if (!account) {
    throw new Error('No active account - login required');
  }

  console.log('[AzureTokenService] Refreshing all tokens...');

  // Force refresh all tokens
  const [armToken, graphToken, storageToken, keyvaultToken, loganalyticsToken] = await Promise.all([
    acquireTokenForResource(AZURE_SCOPES.ARM, 'ARM'),
    acquireTokenForResource(AZURE_SCOPES.GRAPH, 'Graph'),
    acquireTokenForResource(AZURE_SCOPES.STORAGE, 'Storage'),
    acquireTokenForResource(AZURE_SCOPES.KEYVAULT, 'KeyVault'),
    acquireTokenForResource(AZURE_SCOPES.LOGANALYTICS, 'LogAnalytics')
  ]);

  let idToken: string | null = null;
  try {
    const idTokenResponse = await msal.acquireTokenSilent({
      scopes: AZURE_SCOPES.OPENID,
      account,
      forceRefresh: true
    });
    idToken = idTokenResponse.idToken;
  } catch (e) {
    console.warn('[AzureTokenService] Could not refresh ID token');
  }

  // Extract refresh token from MSAL cache
  const refreshToken = extractRefreshToken();

  return {
    armToken,
    graphToken,
    storageToken,
    keyvaultToken,
    loganalyticsToken,
    idToken,
    refreshToken,
    account,
    expiresOn: new Date(Date.now() + 3600000),
    clientId: msalConfig.auth.clientId || null,
    tenantId: import.meta.env.VITE_AZURE_TENANT_ID || null
  };
}

/**
 * Logout from Azure AD
 */
export async function logout(): Promise<void> {
  const msal = await initializeMsal();
  if (!msal) return;

  const account = getActiveAccount();
  if (!account) return;

  console.log('[AzureTokenService] Logging out...');

  await msal.logoutPopup({
    account
  });

  console.log('[AzureTokenService] Logout complete');
}

/**
 * Extract refresh token from MSAL's localStorage cache
 * MSAL stores refresh tokens but doesn't expose them via API
 * This works like `az login` - one refresh token works for ALL Azure APIs
 */
export function extractRefreshToken(): string | null {
  try {
    const clientId = msalConfig.auth.clientId;
    if (!clientId) return null;

    // MSAL stores tokens in localStorage with specific key patterns
    // Refresh tokens are stored as: msal.{clientId}.{homeAccountId}-{environment}-refreshtoken-{clientId}--
    // We need to search for any refresh token key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('refreshtoken') && key.includes(clientId)) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            const parsed = JSON.parse(value);
            // MSAL stores the actual token in the 'secret' field
            if (parsed.secret) {
              console.log('[AzureTokenService] Found refresh token in cache');
              return parsed.secret;
            }
          } catch {
            // Value might be the token directly
            if (value.length > 100) {
              return value;
            }
          }
        }
      }
    }

    console.warn('[AzureTokenService] No refresh token found in cache');
    return null;
  } catch (error) {
    console.error('[AzureTokenService] Error extracting refresh token:', error);
    return null;
  }
}

/**
 * Check if user is currently logged in
 */
export function isLoggedIn(): boolean {
  return getActiveAccount() !== null;
}

/**
 * Get user info from the active account
 */
export function getUserInfo(): { email: string; name: string; id: string } | null {
  const account = getActiveAccount();
  if (!account) return null;

  return {
    email: account.username,
    name: account.name || account.username,
    id: account.localAccountId
  };
}
