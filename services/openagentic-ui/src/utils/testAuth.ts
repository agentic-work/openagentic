/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Test auth utilities for e2e testing
 *
 * SECURITY: These functions are ONLY available in development mode.
 * In production builds, they return null/no-op to prevent security risks.
 */

const IS_DEVELOPMENT = import.meta.env.DEV || import.meta.env.MODE === 'development';

export function checkTestAuthHeaders(): string | null {
  // SECURITY: Only allow test auth in development mode
  if (!IS_DEVELOPMENT) {
    return null;
  }

  // Check if we're in test mode (URL param only - no auth mode restrictions)
  const urlParams = new URLSearchParams(window.location.search);
  const isTestMode = urlParams.get('test') === 'true';

  if (!isTestMode) {
    return null;
  }

  // SECURITY: Never accept tokens from URL parameters - they get logged in browser history,
  // server logs, and referer headers. Only allow localStorage and meta tag injection.
  // For e2e tests, use injectTestAuthToken() or meta tag injection instead.

  // 1. LocalStorage (set by injectTestAuthToken or test framework)
  const tokenFromStorage = localStorage.getItem('test-auth-token');
  if (tokenFromStorage) {
    return tokenFromStorage;
  }

  // 2. Meta tag (for e2e tests that inject it via page manipulation)
  const metaToken = document.querySelector('meta[name="test-auth-token"]');
  if (metaToken) {
    const token = metaToken.getAttribute('content');
    if (token) {
      localStorage.setItem('test-auth-token', token);
      return token;
    }
  }

  return null;
}

export function injectTestAuthToken(token: string): void {
  // SECURITY: Only allow in development mode
  if (!IS_DEVELOPMENT) {
    console.warn('[Security] injectTestAuthToken is disabled in production');
    return;
  }

  // Inject token for e2e tests
  localStorage.setItem('test-auth-token', token);

  // Also add as meta tag
  let meta = document.querySelector('meta[name="test-auth-token"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'test-auth-token');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', token);
}