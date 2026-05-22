import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8080',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
