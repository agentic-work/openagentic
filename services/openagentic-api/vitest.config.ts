
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Anchor vitest to this package — without an explicit root it walks
    // upward and picks up files from sibling git worktrees
    // (.worktrees/<branch>/services/openagentic-api/...) which causes
    // phantom syntax/version skew in the main run.
    root: __dirname,
    dir: __dirname,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'test/**/*.{test,spec}.{js,ts,jsx,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
    ],
    coverage: {
      provider: 'v8',
      // Write coverage even when some tests fail (vitest skips the report by
      // default) — required so coverage emits lcov on a suite that has
      // env-dependent integration-test failures (no live DB/Milvus/Ollama).
      reportOnFailure: true,
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
    hookTimeout: 30000,
    // #305 — cap concurrency so DB-backed tests don't fork-bomb the
    // prisma port-forward / postgres connection pool. With unbounded
    // parallelism, ~30 concurrent test files each opening Prisma
    // clients exhausted the port-forward keepalive and dropped tests
    // mid-run (Agent A repro 2026-04-22). `pool: 'forks'` is also safer
    // than the default threads pool for our native bindings (milvus
    // + isolated-vm don't tolerate worker-thread initialization races).
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
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
