/**
 * Playwright E2E Test Configuration for OpenAgentic
 *
 * Comprehensive E2E testing covering:
 * - UI flows (chat, admin portal, settings)
 * - API endpoints
 * - MCP tool execution
 * - Flowise workflows
 * - Cross-browser compatibility
 */

import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

// Test environment configuration
const isDocker = process.env.TEST_ENV === 'docker';
const isHelm = process.env.TEST_ENV === 'helm';

const getBaseURL = () => {
  if (isHelm) return process.env.HELM_BASE_URL || 'https://openagentic.local';
  if (isDocker) return 'http://localhost:80';
  return 'http://localhost:5173'; // Vite dev server
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: './reports/playwright-report' }],
    ['json', { outputFile: './reports/playwright-results.json' }],
    ['allure-playwright', { outputFolder: './reports/allure-results' }],
    ['list']
  ],
  use: {
    baseURL: getBaseURL(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000
  },

  // Configure projects for different test types
  projects: [
    // === AUTHENTICATION SETUP ===
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/
    },

    // === UI TESTS ===
    {
      name: 'ui-chrome',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /ui\/.*\.spec\.ts/
    },
    {
      name: 'ui-firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
      testMatch: /ui\/.*\.spec\.ts/
    },
    {
      name: 'ui-safari',
      use: { ...devices['Desktop Safari'] },
      dependencies: ['setup'],
      testMatch: /ui\/.*\.spec\.ts/
    },
    {
      name: 'ui-mobile',
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
      testMatch: /ui\/.*\.spec\.ts/
    },

    // === API TESTS ===
    {
      name: 'api',
      testMatch: /api\/.*\.spec\.ts/,
      use: {
        extraHTTPHeaders: {
          'Content-Type': 'application/json'
        }
      }
    },

    // === MCP TESTS ===
    {
      name: 'mcp',
      testMatch: /mcp\/.*\.spec\.ts/,
      dependencies: ['setup']
    },

    // === FLOWISE TESTS ===
    {
      name: 'flowise',
      testMatch: /flowise\/.*\.spec\.ts/,
      dependencies: ['setup']
    }
  ],

  // Web server configuration for local development
  webServer: isDocker || isHelm ? undefined : {
    command: 'cd ../services/openagentic-ui && npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },

  // Global timeout
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000
  }
});
