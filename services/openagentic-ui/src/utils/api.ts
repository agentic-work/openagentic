/**
 * API Utilities
 * Handles API endpoint construction, MCP instance management, and request routing
 * Features: Environment-based URL resolution, user MCP initialization, API versioning
 * @see docs/api/client-integration.md
 */

import { getApiUrl as getRuntimeApiUrl, getWorkflowsApiUrl as getRuntimeWorkflowsApiUrl } from '@/config/runtime';

export function getApiUrl(): string {
  // Use runtime config (from window.__CONFIG__ in production, fallback to build-time in dev)
  const apiUrl = getRuntimeApiUrl();

  // If explicitly set to empty string, use relative URLs
  if (apiUrl === '') {
    return '';
  }

  // If set to a value, use it
  if (apiUrl) {
    return apiUrl;
  }

  // Default to relative URLs for proxy environments
  return '';
}

export function getWorkflowsApiUrl(): string {
  // Use runtime config for workflows service
  const workflowsUrl = getRuntimeWorkflowsApiUrl();

  // If set, use it
  if (workflowsUrl) {
    return workflowsUrl;
  }

  // Default to localhost in development
  return 'http://localhost:3002/api';
}

export function getDocsUrl(): string {
  // Check if we have an explicit docs URL from environment
  const docsUrl = import.meta.env.VITE_DOCS_URL;
  
  // If explicitly set, use it
  if (docsUrl) {
    return docsUrl;
  }
  
  // Use /docs path which routes through ingress to docs service
  return '/docs';
}

export function apiEndpoint(path: string): string {
  const baseUrl = getApiUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // If path already starts with /api, return it as-is (handles both proxy and direct cases)
  if (normalizedPath.startsWith('/api')) {
    // If baseUrl is empty or '/api', just return the path (proxy scenario)
    if (!baseUrl || baseUrl === '/api') {
      return normalizedPath;
    }
    // If baseUrl is a full URL (e.g., http://localhost:8000), append the path
    return `${baseUrl}${normalizedPath}`;
  }

  // If baseUrl is already /api, just append the path
  if (baseUrl === '/api') {
    return `/api${normalizedPath}`;
  }

  // Otherwise, add /api prefix
  if (!baseUrl) {
    return `/api${normalizedPath}`;
  }

  // For development with direct API access (e.g., baseUrl = 'http://localhost:8000')
  return `${baseUrl}/api${normalizedPath}`;
}

/**
 * Workflow endpoint builder - routes through API proxy to openagenticflows service
 * API proxies /api/workflows/* to the workflows microservice
 */
export function workflowEndpoint(path: string): string {
  const baseUrl = getApiUrl(); // Use main API, not direct workflows service
  // Normalize path to start with /workflows
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // If path already starts with /workflows, keep it; otherwise prepend it
  const workflowPath = normalizedPath.startsWith('/workflows')
    ? normalizedPath
    : `/workflows${normalizedPath}`;

  // If baseUrl already ends with /api or is /api, don't add it again
  if (baseUrl === '/api' || baseUrl.endsWith('/api')) {
    return `${baseUrl}${workflowPath}`;
  }

  // Otherwise add /api prefix
  return baseUrl ? `${baseUrl}/api${workflowPath}` : `/api${workflowPath}`;
}

// Helper to get API key from session storage
export function getApiKey(): string | null {
  return sessionStorage.getItem('apiKey');
}

// Helper to set API key in session storage
export function setApiKey(apiKey: string): void {
  sessionStorage.setItem('apiKey', apiKey);
}

// Helper to clear API key from session storage
export function clearApiKey(): void {
  sessionStorage.removeItem('apiKey');
}

// Note: MCP initialization is now handled server-side during login

// Helper to check if API key is set
export function hasApiKey(): boolean {
  return !!getApiKey();
}

// Note: Removed duplicate axios instance - use apiClient from '@/api/client' instead
// This instance was unused and lacked proper authentication handling

/**
 * Centralized API request function with automatic session validation and 401 handling
 * Use this for all API calls to ensure consistent auth handling
 */
export async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem('auth_token');

  // Prepare headers with auth token
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(apiEndpoint(endpoint), {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized globally - session expired or invalid
    if (response.status === 401) {
      console.warn('[API Request] 401 Unauthorized - session invalid, logging out');
      localStorage.removeItem('auth_token');
      sessionStorage.clear();
      window.location.href = '/login';
      throw new Error('Session expired - please login again');
    }

    return response;
  } catch (error) {
    // Re-throw network errors
    throw error;
  }
}

/**
 * Convenience wrapper for JSON API requests
 */
export async function apiRequestJson<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiRequest(endpoint, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  // Handle 204 No Content responses (e.g., from DELETE operations)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}
