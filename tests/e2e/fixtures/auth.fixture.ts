/**
 * Playwright Auth Fixtures
 *
 * Provides authenticated page contexts that automatically use:
 * 1. Saved browser auth state (from MFA login) - for UI tests
 * 2. API key authentication - for API tests
 */

import { test as base, expect, Page, BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(__dirname, '../../../.auth/user.json');

// Check if auth state file exists
function hasAuthState(): boolean {
  try {
    return fs.existsSync(AUTH_FILE);
  } catch {
    return false;
  }
}

// Extend the base test with authenticated fixtures
export const test = base.extend<{
  authenticatedPage: Page;
  authenticatedContext: BrowserContext;
  apiKey: string;
}>({
  // Authenticated browser context using saved MFA state
  authenticatedContext: async ({ browser }, use) => {
    if (!hasAuthState()) {
      throw new Error(
        `\n\n❌ No auth state found at ${AUTH_FILE}\n\n` +
        `Run the auth setup first:\n` +
        `  npx playwright test --project=auth-setup\n\n`
      );
    }

    const context = await browser.newContext({
      storageState: AUTH_FILE,
    });

    await use(context);
    await context.close();
  },

  // Authenticated page ready to use
  authenticatedPage: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();

    // Navigate to base URL and wait for auth to be recognized
    const baseUrl = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
    await page.goto(baseUrl);

    // Wait for authenticated state (chat container visible means logged in)
    await page.waitForSelector('[data-testid="chat-container"], .chat-container', {
      timeout: 30000,
    });

    await use(page);
    await page.close();
  },

  // API key for direct API testing (bypasses MFA entirely)
  apiKey: async ({}, use) => {
    const key = process.env.TEST_API_KEY ||
                process.env.UAT_API_KEY ||
                'awc_PLACEHOLDER_REPLACE_WITH_REAL_KEY';
    await use(key);
  },
});

export { expect };

// Re-export for convenience
export type { Page, BrowserContext };
