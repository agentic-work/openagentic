/**
 * Vitest Configuration for OpenAgentic Test Harness
 *
 * Comprehensive testing configuration for:
 * - Unit tests
 * - Integration tests
 * - API contract tests
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/load/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './reports/coverage',
      include: [
        '../services/openagentic-api/src/**/*.ts',
        '../services/openagentic-ui/src/**/*.{ts,tsx}',
        '../services/openagentic-mcp-proxy/src/**/*.py'
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/node_modules/**'
      ]
    },
    reporters: ['verbose', 'json', 'html'],
    outputFile: {
      json: './reports/test-results.json',
      html: './reports/test-results.html'
    },
    setupFiles: ['./fixtures/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1
      }
    }
  },
  resolve: {
    alias: {
      '@api': resolve(__dirname, '../services/openagentic-api/src'),
      '@ui': resolve(__dirname, '../services/openagentic-ui/src'),
      '@tests': resolve(__dirname, './')
    }
  }
});
