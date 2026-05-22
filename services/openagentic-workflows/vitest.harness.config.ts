/**
 * Vitest config for the Flows test harness (Phase A).
 *
 * Scoped to the harness directory only. Does NOT pick up the regular
 * src test glob.
 * Keeps the harness suite independent of the rest of the workflows-svc
 * unit tests so CI can wire it up / shard it / surface coverage
 * separately.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/harness/setup.ts'],
    include: ['test/harness/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@config': path.resolve(__dirname, './src/config'),
    },
  },
});
