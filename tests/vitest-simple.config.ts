import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**', '**/load/**'],
    setupFiles: ['./fixtures/setup.ts'],
    testTimeout: 30000,
  }
});
