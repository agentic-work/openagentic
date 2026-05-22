/**
 * ONE-TIME MFA Authentication Setup for Playwright
 *
 * USAGE:
 *   npx playwright test --project=auth-setup
 *
 * This will:
 * 1. Open a VISIBLE browser window
 * 2. Navigate to the login page
 * 3. WAIT FOR YOU to complete MFA login manually
 * 4. Save the authenticated state to .auth/user.json
 *
 * After running this ONCE, all other tests can reuse the saved auth state.
 *
 * The saved auth is valid until the token expires (usually 24h-7d depending on Azure AD config)
 * When it expires, just run this setup again.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

setup('authenticate via Azure AD MFA', async ({ page }) => {
  // Navigate to login page
  const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
  await page.goto(baseUrl);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          MANUAL MFA AUTHENTICATION REQUIRED                  ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  1. Complete the Azure AD login in the browser window        ║');
  console.log('║  2. Complete MFA verification (phone/authenticator)          ║');
  console.log('║  3. Wait for the chat interface to load                      ║');
  console.log('║  4. The test will automatically save your session            ║');
  console.log('║                                                              ║');
  console.log('║  TIMEOUT: 5 minutes - take your time!                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Click the Azure AD login button
  const loginButton = page.locator('[data-testid="azure-login"], button:has-text("Sign in with Microsoft"), button:has-text("Microsoft")');
  if (await loginButton.isVisible({ timeout: 5000 })) {
    await loginButton.click();
  }

  // Wait for user to complete MFA and reach the authenticated page
  // Looking for chat container or any authenticated-only element
  await page.waitForURL('**/chat**', { timeout: 300000 }); // 5 minute timeout for MFA

  // Additional wait to ensure all auth cookies are set
  await page.waitForTimeout(3000);

  // Verify we're actually logged in
  const chatContainer = page.locator('[data-testid="chat-container"], .chat-container, [class*="ChatContainer"]');
  await expect(chatContainer).toBeVisible({ timeout: 10000 });

  console.log('');
  console.log('✅ Authentication successful! Saving session state...');
  console.log('');

  // Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE });

  console.log(`✅ Auth state saved to: ${AUTH_FILE}`);
  console.log('');
  console.log('You can now run tests without MFA:');
  console.log('  npx playwright test --project=chromium');
  console.log('');
});
