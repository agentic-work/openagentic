// Copyright (c) 2025 Openagentic LLC
// For all inquiries, please contact:
// Openagentic LLC
// hello@openagentic.io

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      // lcov is the format SonarQube consumes via sonar.javascript.lcov.reportPaths.
      // Keep text/json/html for local dev.
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        'src/test/**'
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@auth': path.resolve(__dirname, './src/auth'),
      '@services': path.resolve(__dirname, './src/services'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@mcp': path.resolve(__dirname, './src/mcp'),
      '@openagentic/shared-logging': path.resolve(__dirname, '../../shared/logging')
    }
  }
});
