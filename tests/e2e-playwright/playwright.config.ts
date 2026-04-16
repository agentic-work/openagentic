import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially for this E2E suite
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results.json' }],
    ['list']
  ],

  use: {
    baseURL: process.env.BASE_URL || 'https://chat-dev.openagentic.io',

    // Ignore HTTPS errors for self-signed certs
    ignoreHTTPSErrors: true,

    // Capture screenshots on failure and always for key steps
    screenshot: 'on',

    // Record video for all tests
    video: 'on',

    // Trace on first retry
    trace: 'on-first-retry',

    // Timeout settings
    actionTimeout: 30000,
    navigationTimeout: 60000,
  },

  timeout: 180000, // 3 minute test timeout for long chat responses

  expect: {
    timeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  outputDir: 'test-results/',
});
