import { defineConfig, devices } from '@playwright/test';

const authFile = 'e2e/.auth/azure-user.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 120000, // 2 minutes per test
  outputDir: `${process.env.HOME}/playwright/openagentic/test-results`,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: {
      mode: 'on',
      dir: `${process.env.HOME}/playwright/openagentic/videos`,
    },
    // Headed mode for visual debugging - can watch tests run (default to headed)
    headless: process.env.HEADLESS === 'true',
    // Ignore HTTPS errors for self-signed certs
    ignoreHTTPSErrors: true,
    // Slower actions for visibility
    launchOptions: {
      slowMo: process.env.SLOW_MO ? Number.parseInt(process.env.SLOW_MO) : 50,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [
          `${process.env.HOME}/playwright-deps/extracted/usr/lib/x86_64-linux-gnu`,
          process.env.LD_LIBRARY_PATH || '',
        ].filter(Boolean).join(':'),
      },
    },
  },
  projects: [
    // Setup project - authenticates once and saves state
    {
      name: 'azure-auth-setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Main browser project
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Azure AD authenticated tests - depend on setup project
    {
      name: 'azure-mcp-tests',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['azure-auth-setup'],
      testMatch: /azure-mcp.*\.spec\.ts|aws-mcp.*\.spec\.ts/,
    },
    // Azure AD authenticated tests - use existing auth (no setup dependency)
    {
      name: 'azure-mcp-existing-auth',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      testMatch: /azure-mcp.*\.spec\.ts|aws-mcp.*\.spec\.ts/,
    },
  ],
});
