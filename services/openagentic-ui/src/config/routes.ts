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
 * Application Routes Configuration
 */

export const ROUTES = {
  // Public routes
  LOGIN: '/login',
  
  // Authenticated routes
  CHAT: '/',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  
  // Admin routes
  ADMIN: '/admin',
  ADMIN_USERS: '/admin/users',
  ADMIN_PROMPTS: '/admin/prompts',
  ADMIN_ANALYTICS: '/admin/analytics',

  // Feature routes
  FILES: '/files',
  SESSIONS: '/sessions',
  WORKFLOWS: '/workflows',

  // Utility routes
  NOT_FOUND: '/404',
  ERROR: '/error'
} as const;

export type AppRoute = typeof ROUTES[keyof typeof ROUTES];

// Route guards
export const PUBLIC_ROUTES = [ROUTES.LOGIN] as const;
export const ADMIN_ROUTES = [
  ROUTES.ADMIN,
  ROUTES.ADMIN_USERS,
  ROUTES.ADMIN_PROMPTS,
  ROUTES.ADMIN_ANALYTICS
] as const;

// Route titles for navigation
export const ROUTE_TITLES: Record<AppRoute, string> = {
  [ROUTES.LOGIN]: 'Login',
  [ROUTES.CHAT]: 'Chat',
  [ROUTES.SETTINGS]: 'Settings',
  [ROUTES.PROFILE]: 'Profile',
  [ROUTES.ADMIN]: 'Admin Dashboard',
  [ROUTES.ADMIN_USERS]: 'User Management',
  [ROUTES.ADMIN_PROMPTS]: 'Prompt Templates',
  [ROUTES.ADMIN_ANALYTICS]: 'Analytics',
  [ROUTES.FILES]: 'Files',
  [ROUTES.SESSIONS]: 'Chat Sessions',
  [ROUTES.WORKFLOWS]: 'Workflows',
  [ROUTES.NOT_FOUND]: 'Page Not Found',
  [ROUTES.ERROR]: 'Error'
};