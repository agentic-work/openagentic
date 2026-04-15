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
 * Application Constants
 */

import { getApiUrl } from './runtime';

// API Configuration - Uses runtime config for production, build-time for dev
export function getApiBaseUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl || '/api';
}

// For backward compatibility
export const API_BASE_URL = getApiBaseUrl();

// WebSocket URL - function to get dynamic URL based on current location
export function getWsUrl(): string {
  // Check environment variable first
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  
  // Use current location for dynamic URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

// For backward compatibility, export WS_BASE_URL as a getter
export const WS_BASE_URL = getWsUrl();

// Docs URL - function to get dynamic URL based on current location
export function getDocsBaseUrl(): string {
  // Check environment variable first
  if (import.meta.env.VITE_DOCS_URL) {
    return import.meta.env.VITE_DOCS_URL;
  }
  
  // Use the nginx proxy path instead of direct port access
  // This avoids X-Frame-Options issues and works in all environments
  return '/docs';
}

// For backward compatibility, export DOCS_BASE_URL as a getter
export const DOCS_BASE_URL = getDocsBaseUrl();

export const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT || '30000'); // 30 seconds

// Authentication
export const AUTH_MODES = {
  LOCAL: 'local',
  AAD: 'aad',
  TEST: 'test'
} as const;

// Chat Configuration - Environment configurable
export const MAX_MESSAGE_LENGTH = parseInt(import.meta.env.VITE_MAX_MESSAGE_LENGTH || '10000');
export const MAX_FILE_SIZE = parseInt(import.meta.env.VITE_MAX_FILE_SIZE || (50 * 1024 * 1024).toString()); // 50MB
export const MAX_FILES_PER_MESSAGE = parseInt(import.meta.env.VITE_MAX_FILES_PER_MESSAGE || '10');
export const AUTOSAVE_INTERVAL = parseInt(import.meta.env.VITE_AUTOSAVE_INTERVAL || '30000'); // 30 seconds

// UI Configuration - Environment configurable
export const SIDEBAR_WIDTH = parseInt(import.meta.env.VITE_SIDEBAR_WIDTH || '260');
export const MOBILE_BREAKPOINT = parseInt(import.meta.env.VITE_MOBILE_BREAKPOINT || '768');
export const THEME_STORAGE_KEY = 'openagentic-theme';
export const SETTINGS_STORAGE_KEY = 'openagentic-settings';

// Feature Flags
export const FEATURES = {
  ADMIN_PANEL: import.meta.env.VITE_FEATURE_ADMIN_PANEL === 'true',
  FILE_UPLOAD: import.meta.env.VITE_FEATURE_FILE_UPLOAD !== 'false',
  VOICE_INPUT: import.meta.env.VITE_FEATURE_VOICE_INPUT === 'true',
  ANALYTICS: import.meta.env.VITE_FEATURE_ANALYTICS !== 'false'
} as const;

// Rate Limiting - Environment configurable
export const RATE_LIMITS = {
  MESSAGES_PER_MINUTE: parseInt(import.meta.env.VITE_RATE_LIMIT_MESSAGES_PER_MINUTE || '20'),
  FILES_PER_HOUR: parseInt(import.meta.env.VITE_RATE_LIMIT_FILES_PER_HOUR || '100'),
  API_CALLS_PER_MINUTE: parseInt(import.meta.env.VITE_RATE_LIMIT_API_CALLS_PER_MINUTE || '60')
} as const;