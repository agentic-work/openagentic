import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration - Deployed App
 * For testing against already-running Docker services via Caddy
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Run tests in files in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],

  // Shared test timeout
  timeout: 120 * 1000, // 120 seconds per test (longer for MCP operations)

  use: {
    // Base URL for navigation - use Caddy running on localhost:80
    baseURL: 'http://localhost',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Viewport size
    viewport: { width: 1920, height: 1080 },
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // NO webServer - test against already-running Docker services
});
