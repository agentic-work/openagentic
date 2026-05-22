/**
 * Playwright config for the services/openagentic-ui/tests/e2e suite.
 *
 * Points at chat-dev. Override with BASE_URL env var when targeting a
 * different environment. Designed to be invoked as:
 *
 *   npx playwright test --config=services/openagentic-ui/tests/e2e/playwright.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-tests-e2e' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://chat-dev.openagentic.io',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
