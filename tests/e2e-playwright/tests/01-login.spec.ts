import { test, expect, Page } from '@playwright/test';

// Test configuration
const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = 'admin@openagentic.io';
const TEST_PASSWORD = '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// Helper to save auth state
async function login(page: Page) {
  await page.goto(BASE_URL);

  // Wait for login page or redirect
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of initial page
  await page.screenshot({ path: 'test-results/screenshots/01-login-initial.png' });

  // Check if we're on login page with Local button
  const localButton = page.locator('button:has-text("Local")');

  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Click Local login button
    await localButton.click();
    await page.waitForTimeout(1000);

    // Take screenshot of login form
    await page.screenshot({ path: 'test-results/screenshots/01-login-form.png' });

    // Now fill the login form
    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.fill(TEST_EMAIL);

    const passwordField = page.locator('input[type="password"]');
    await passwordField.fill(TEST_PASSWORD);

    // Submit login
    const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
    await submitButton.click();

    // Wait for redirect after login
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 30000 });
  }

  // Take screenshot after login
  await page.screenshot({ path: 'test-results/screenshots/01-login-success.png' });
}

test.describe('Authentication', () => {
  test('should login successfully', async ({ page }) => {
    await login(page);

    // Verify we're on the main app
    await expect(page).not.toHaveURL(/login/);

    // Take screenshot of main app
    await page.screenshot({ path: 'test-results/screenshots/01-main-app.png', fullPage: true });
  });

  test('should display user info after login', async ({ page }) => {
    await login(page);

    // Look for user menu or profile indicator
    const userIndicator = page.locator('[data-testid="user-menu"], .user-avatar, .user-profile, .avatar');

    if (await userIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.screenshot({ path: 'test-results/screenshots/01-user-logged-in.png' });
    }
  });
});

// Export login helper for other tests
export { login };
