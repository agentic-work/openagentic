/**
 * Fastify Plugins Index
 *
 * Exports all modularized plugins for use in server.ts
 * Part of HIGH-001 refactoring to reduce server.ts from 3000+ lines
 *
 * Usage in server.ts:
 *   import { authPlugin, adminPlugin } from './plugins/index.js';
 *
 *   // In registerAllRoutes():
 *   await server.register(authPlugin, { authProvider: 'google' });
 *   await server.register(adminPlugin, { ollamaEnabled: true });
 */

export { default as authPlugin } from './auth.plugin.js';
export { default as adminPlugin } from './admin.plugin.js';
