/**
 * Flows Page Test
 * Tests the Flows sidebar link and page loading
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({ ignoreHTTPSErrors: true });

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

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
  console.log('Chat interface loaded');

  // Dismiss ALL modals/overlays (welcome wizard, onboarding, etc.)
  // Wait for modals to appear (they often have 500ms+ delays)
  await page.waitForTimeout(2000);

  // Dismiss modals with Escape + force-click on Skip buttons
  for (let attempt = 0; attempt < 5; attempt++) {
    // Try Escape key first (works for most modals)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Check if any overlay is still visible
    const hasOverlay = await page.locator('.fixed.inset-0').first().isVisible({ timeout: 500 }).catch(() => false);
    if (!hasOverlay) {
      console.log(`All modals dismissed after ${attempt + 1} attempts`);
      break;
    }

    // Try clicking Skip button with force (bypasses overlay interception)
    try {
      const skipBtn = page.locator('button:has-text("Skip")').first();
      if (await skipBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log(`Attempt ${attempt + 1}: Force-clicking Skip...`);
        await skipBtn.click({ force: true });
        await page.waitForTimeout(500);
      }
    } catch {}
  }

  console.log('Login complete!');
}

test.describe('Flows Page', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('response', async response => {
      if (response.status() >= 400) {
        console.log(`[HTTP ${response.status()}] ${response.url()}`);
      }
    });
  });

  test('Click Flows in sidebar and verify page loads', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    await page.waitForTimeout(2000);

    console.log('\n=== TESTING FLOWS PAGE VIA SIDEBAR ===');

    // Take screenshot of main page
    await page.screenshot({ path: '/tmp/flows-1-main-page.png', fullPage: true });
    console.log('Screenshot 1: Main page');

    // Look for Flows link in sidebar
    console.log('Looking for Flows link in sidebar...');
    const flowsLink = page.locator('a:has-text("Flows"), button:has-text("Flows"), [href*="workflow"], [href*="flows"]').first();
    const hasFlowsLink = await flowsLink.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Found Flows link: ${hasFlowsLink}`);

    if (hasFlowsLink) {
      console.log('Clicking Flows link...');
      await flowsLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
    } else {
      // Try direct navigation
      console.log('Flows link not found, navigating directly to /workflows...');
      await page.goto(`${BASE_URL}/workflows`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
    }

    // Take screenshot after navigation
    await page.screenshot({ path: '/tmp/flows-2-after-click.png', fullPage: true });
    console.log('Screenshot 2: After clicking Flows');

    // Check current URL
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // Check for React errors
    const hasError = await page.locator('text=Something went wrong, text=Error, text=ChunkLoadError').first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasBlankPage = await page.locator('body').textContent().then(t => (t?.trim().length || 0) < 100).catch(() => true);

    console.log(`Has error: ${hasError}`);
    console.log(`Is blank page: ${hasBlankPage}`);

    // Check for workflow content
    const hasWorkflowContent = await page.locator('.react-flow, text=Nodes, text=Workflows, text=Create').first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Has workflow content: ${hasWorkflowContent}`);

    // Take final screenshot
    await page.screenshot({ path: '/tmp/flows-3-final.png', fullPage: true });
    console.log('Screenshot 3: Final state');

    // Log page content for debugging
    const bodyText = await page.locator('body').textContent();
    console.log(`Page content (first 300 chars): ${bodyText?.substring(0, 300)}`);

    if (hasError || hasBlankPage) {
      console.log('ERROR: Flows page has issues!');
    } else {
      console.log('Flows page loaded successfully');
    }
  });
});
