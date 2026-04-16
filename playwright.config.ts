import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * OpenAgentic Playwright Configuration
 *
 * AUTHENTICATION STRATEGY:
 * =======================
 * 1. Run auth-setup ONCE manually to capture MFA session:
 *    npx playwright test --project=auth-setup
 *
 * 2. All subsequent test runs automatically use saved auth state
 *
 * 3. When auth expires (usually 24h-7d), run auth-setup again
 */

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially for Azure operations
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1, // Single worker to avoid Azure rate limits
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  // Global test settings
  use: {
    baseURL: process.env.BASE_URL || 'https://chat-dev.openagentic.io',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results',

  projects: [
    // ============================================================
    // AUTH SETUP - Run this ONCE manually to capture MFA session
    // ============================================================
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        // IMPORTANT: headless: false so you can complete MFA
        headless: false,
        // Don't reuse existing auth for setup
        storageState: undefined,
      },
    },

    // ============================================================
    // MAIN TEST PROJECTS - Use saved auth state
    // ============================================================
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      testIgnore: /auth\.setup\.ts/,
      // Depend on auth-setup only if not running in CI with pre-saved auth
      dependencies: process.env.CI ? [] : [],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        // Use saved auth state from MFA login
        storageState: AUTH_FILE,
      },
    },

    // ============================================================
    // API TESTS - Use API key, no browser auth needed
    // ============================================================
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: {
        // No storage state needed - API tests use API keys
        storageState: undefined,
      },
    },

    // ============================================================
    // MOBILE TESTS - For responsive testing
    // ============================================================
    {
      name: 'mobile-chrome',
      testMatch: /.*\.mobile\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        storageState: AUTH_FILE,
      },
    },
  ],

  // Web server configuration (skip in CI/when testing remote)
  webServer: process.env.SKIP_WEB_SERVER ? undefined : {
    command: 'docker-compose up -d && sleep 5',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  // Global setup to check auth state validity
  globalSetup: undefined, // Can add a script to check if auth state is still valid
});
