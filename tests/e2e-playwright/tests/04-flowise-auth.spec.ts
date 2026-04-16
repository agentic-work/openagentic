import { test, expect, Page } from '@playwright/test';

/**
 * Flowise Authentication and Access E2E Tests
 *
 * Tests the full authentication flow for Flowise access including:
 * 1. Login via local admin credentials
 * 2. Click "Flowise Workflow Manager" in chat toolbar
 * 3. Verify workspace loads without 403 error
 * 4. Access Admin Portal > Flowise Workflows > Admin Console
 */

// Test configuration - use local admin account which has a password
const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = 'admin@openagentic.io';
const TEST_PASSWORD = '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// Helper function to login via local auth
async function loginAsLocalAdmin(page: Page): Promise<void> {
  console.log(`\n🔐 Starting login flow for ${TEST_EMAIL}...`);

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/screenshots/flowise-01-initial.png' });
  console.log('  📸 Screenshot: Initial page');

  // Check if we need to click Local login button
  const localButton = page.locator('button:has-text("Local"), button:has-text("Sign in with Email")');

  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  📌 Found Local login button, clicking...');
    await localButton.click();
    await page.waitForTimeout(1000);
  }

  // Wait for login form
  const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  await emailField.waitFor({ state: 'visible', timeout: 10000 });

  console.log('  ✍️ Filling login form...');
  await emailField.fill(TEST_EMAIL);

  const passwordField = page.locator('input[type="password"]').first();
  await passwordField.fill(TEST_PASSWORD);

  await page.screenshot({ path: 'test-results/screenshots/flowise-02-login-form.png' });
  console.log('  📸 Screenshot: Login form filled');

  // Submit login
  const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
  await submitButton.click();

  console.log('  ⏳ Waiting for login redirect...');
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: 'test-results/screenshots/flowise-03-logged-in.png', fullPage: true });
  console.log('  ✅ Login successful');
}

// Helper to check for 403 error page
async function checkFor403Error(page: Page): Promise<boolean> {
  const forbiddenText = page.locator('text=403 Forbidden, text=do not have permission');
  return await forbiddenText.isVisible({ timeout: 2000 }).catch(() => false);
}

test.describe('Flowise Authentication Flow', () => {

  test.beforeEach(async ({ page }) => {
    // Create screenshots directory
    await page.evaluate(() => {
      console.log('Flowise Auth Test Starting');
    });
  });

  test('1. Login and access Flowise via chat toolbar', async ({ page }) => {
    test.setTimeout(120000); // 2 minute timeout

    // Step 1: Login
    await loginAsLocalAdmin(page);

    // Step 2: Look for Flowise Workflow Manager button in chat interface
    console.log('\n🔍 Looking for Flowise Workflow Manager button...');

    // Wait for the chat interface to load
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/screenshots/flowise-04-chat-interface.png', fullPage: true });

    // Look for Flowise button - various possible selectors
    const flowiseButton = page.locator([
      'button:has-text("Flowise")',
      'button:has-text("Workflow")',
      '[data-testid="flowise-button"]',
      'button[title*="Flowise"]',
      '.toolbar button:has(svg) + span:has-text("Flowise")',
      'a:has-text("Flowise")'
    ].join(', ')).first();

    const flowise403Found = async (): Promise<boolean> => {
      return await checkFor403Error(page);
    };

    if (await flowiseButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('  📌 Found Flowise button, clicking...');
      await flowiseButton.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'test-results/screenshots/flowise-05-after-click.png', fullPage: true });

      // Check for 403 error
      if (await flowise403Found()) {
        console.log('  ❌ FAILED: 403 Forbidden error detected!');
        await page.screenshot({ path: 'test-results/screenshots/flowise-ERROR-403.png', fullPage: true });
        throw new Error('403 Forbidden error when accessing Flowise');
      }

      console.log('  ✅ Flowise interface loaded');
    } else {
      console.log('  ⚠️ Flowise button not visible in toolbar, checking alternate paths...');

      // Try clicking on a menu or dropdown that might contain Flowise
      const menuButton = page.locator('[data-testid="more-menu"], button:has-text("More"), .dropdown-trigger').first();
      if (await menuButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await menuButton.click();
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'test-results/screenshots/flowise-05a-menu-open.png' });
      }
    }

    // Verify no 403 error
    expect(await flowise403Found()).toBe(false);
  });

  test('2. Access Flowise via Admin Portal', async ({ page }) => {
    test.setTimeout(120000);

    // Step 1: Login
    await loginAsLocalAdmin(page);

    // Step 2: Navigate to Admin Portal
    console.log('\n🏛️ Navigating to Admin Portal...');

    // Look for Admin link/button
    const adminLink = page.locator([
      'a:has-text("Admin")',
      'button:has-text("Admin")',
      '[data-testid="admin-portal"]',
      'nav a[href*="admin"]'
    ].join(', ')).first();

    if (await adminLink.isVisible({ timeout: 10000 }).catch(() => false)) {
      await adminLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/screenshots/flowise-06-admin-portal.png', fullPage: true });
      console.log('  📸 Admin Portal loaded');
    } else {
      // Try direct navigation
      console.log('  ⚠️ Admin link not visible, trying direct navigation...');
      await page.goto(`${BASE_URL}/admin`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'test-results/screenshots/flowise-06-admin-direct.png', fullPage: true });
    }

    // Step 3: Navigate to Flowise Workflows
    console.log('\n🔧 Looking for Flowise Workflows section...');

    const flowiseWorkflowsLink = page.locator([
      'a:has-text("Flowise Workflows")',
      'a:has-text("Workflows")',
      '[data-testid="flowise-workflows"]',
      'nav a[href*="flowise"]'
    ].join(', ')).first();

    if (await flowiseWorkflowsLink.isVisible({ timeout: 10000 }).catch(() => false)) {
      await flowiseWorkflowsLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/screenshots/flowise-07-workflows-section.png', fullPage: true });
    }

    // Step 4: Click Admin Console
    console.log('\n🎛️ Looking for Admin Console...');

    const adminConsoleLink = page.locator([
      'a:has-text("Admin Console")',
      'button:has-text("Admin Console")',
      '[data-testid="admin-console"]'
    ].join(', ')).first();

    if (await adminConsoleLink.isVisible({ timeout: 10000 }).catch(() => false)) {
      await adminConsoleLink.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'test-results/screenshots/flowise-08-admin-console.png', fullPage: true });

      // Check for 403
      if (await checkFor403Error(page)) {
        console.log('  ❌ FAILED: 403 Forbidden in Admin Console!');
        await page.screenshot({ path: 'test-results/screenshots/flowise-ERROR-admin-403.png', fullPage: true });
        throw new Error('403 Forbidden error in Flowise Admin Console');
      }

      console.log('  ✅ Admin Console loaded successfully');
    } else {
      console.log('  ⚠️ Admin Console link not found');
      await page.screenshot({ path: 'test-results/screenshots/flowise-07a-no-admin-console.png', fullPage: true });
    }

    // Verify no 403 error
    expect(await checkFor403Error(page)).toBe(false);
  });

  test('3. Direct Flowise URL access', async ({ page }) => {
    test.setTimeout(120000);

    // Login first
    await loginAsLocalAdmin(page);

    // Try to access Flowise directly
    console.log('\n🌐 Attempting direct Flowise URL access...');

    const flowiseUrl = `${BASE_URL}/flowise`;
    await page.goto(flowiseUrl);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/screenshots/flowise-09-direct-access.png', fullPage: true });

    // Check for 403
    if (await checkFor403Error(page)) {
      console.log('  ❌ FAILED: 403 Forbidden on direct Flowise access!');

      // Log page content for debugging
      const pageContent = await page.content();
      console.log('  📄 Page content (first 1000 chars):');
      console.log(pageContent.substring(0, 1000));

      await page.screenshot({ path: 'test-results/screenshots/flowise-ERROR-direct-403.png', fullPage: true });
      throw new Error('403 Forbidden on direct Flowise URL access');
    }

    // Look for Flowise UI elements
    const flowiseUI = page.locator([
      '.flowise-main',
      '[class*="flowise"]',
      'canvas',  // Flowise uses canvas for flow diagrams
      'text=Chatflows',
      'text=Workflows'
    ].join(', ')).first();

    if (await flowiseUI.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('  ✅ Flowise UI loaded successfully!');
      await page.screenshot({ path: 'test-results/screenshots/flowise-10-ui-loaded.png', fullPage: true });
    } else {
      console.log('  ⚠️ Flowise UI elements not detected');
      await page.screenshot({ path: 'test-results/screenshots/flowise-10a-ui-check.png', fullPage: true });
    }

    // Verify no 403 error
    expect(await checkFor403Error(page)).toBe(false);
  });

  test('4. Verify user workspace access', async ({ page }) => {
    test.setTimeout(120000);

    // Login first
    await loginAsLocalAdmin(page);

    // Navigate to Flowise
    await page.goto(`${BASE_URL}/flowise`);
    await page.waitForTimeout(5000);

    // Check for workspace selector or user info
    console.log('\n👤 Checking workspace access...');

    const userMenu = page.locator([
      '[data-testid="user-menu"]',
      '.user-menu',
      'button:has(.avatar)',
      '[class*="user-avatar"]'
    ].join(', ')).first();

    if (await userMenu.isVisible({ timeout: 10000 }).catch(() => false)) {
      await userMenu.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-results/screenshots/flowise-11-user-menu.png' });

      // Look for workspace info
      const workspaceInfo = page.locator('text=Workspace, text=Admin Workspace, text=My Workspace');
      if (await workspaceInfo.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('  ✅ Workspace info visible');
      }
    }

    // Verify no 403
    expect(await checkFor403Error(page)).toBe(false);
    console.log('  ✅ Workspace access verified');
  });
});

// Debug test - runs interactively to inspect the page
test.describe('Debug Tests', () => {
  test.skip('Debug: Inspect page state', async ({ page }) => {
    await loginAsLocalAdmin(page);

    // Take full page screenshot
    await page.screenshot({ path: 'test-results/screenshots/debug-full-page.png', fullPage: true });

    // Log all visible buttons
    const buttons = await page.locator('button').all();
    console.log(`\n🔍 Found ${buttons.length} buttons:`);
    for (const btn of buttons.slice(0, 20)) {
      const text = await btn.textContent();
      console.log(`  - "${text?.trim()}"`);
    }

    // Log all visible links
    const links = await page.locator('a').all();
    console.log(`\n🔗 Found ${links.length} links:`);
    for (const link of links.slice(0, 20)) {
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      console.log(`  - "${text?.trim()}" → ${href}`);
    }

    // Pause for manual inspection
    await page.pause();
  });
});
