/**
 * Microsoft SSO login helper for Playwright e2e specs.
 *
 * Drives the AAD interactive sign-in for `admin@example.onmicrosoft.com`
 * against the live chat-dev surface, then reads `localStorage.auth_token`
 * for subsequent direct `fetch()` calls against the workflows API.
 *
 * Env overrides:
 *   BASE_URL          (default: https://chat-dev.openagentic.io)
 *   ADMIN_EMAIL       (default: admin@example.onmicrosoft.com)
 *   ADMIN_PASSWORD    (default: TestMcp@2026)
 *
 * Returns the bearer token. Throws if it cannot be obtained.
 */

import type { Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@example.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

export async function loginAndGetToken(page: Page): Promise<string> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const msButton = page.locator(
    'button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")',
  );
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);

    const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await msEmailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msEmailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await msPasswordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msPasswordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
    if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await staySignedIn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('textarea', { timeout: 60000 });
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  if (!token) throw new Error('No auth_token in localStorage after login');
  return token as string;
}
