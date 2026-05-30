import { test, expect, Page } from '@playwright/test';

/**
 * Flowise SSO Authentication E2E Test
 *
 * This test uses Azure AD SSO to login and then accesses Flowise
 */

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';

test.describe('Flowise SSO Authentication', () => {

  test('SSO Login and Flowise Access', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes

    console.log('\n🌐 Step 1: Navigate to app and trigger SSO...');
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Take screenshot of login page
    await page.screenshot({ path: 'test-results/screenshots/sso-01-initial.png', fullPage: true });
    console.log('📸 Initial page screenshot taken');

    // Log current URL
    console.log(`Current URL: ${page.url()}`);

    // Look for SSO/Azure AD login button
    const ssoButton = page.locator([
      'button:has-text("Microsoft")',
      'button:has-text("Azure")',
      'button:has-text("SSO")',
      'button:has-text("Sign in with Microsoft")',
      'a:has-text("Microsoft")',
      'a:has-text("Azure")'
    ].join(', ')).first();

    if (await ssoButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  📌 Found SSO button, clicking...');
      await ssoButton.click();

      // Wait for redirect to Azure AD
      await page.waitForTimeout(5000);
      console.log(`Redirected to: ${page.url()}`);
      await page.screenshot({ path: 'test-results/screenshots/sso-02-azure-redirect.png', fullPage: true });

      // If on Azure AD page, we need to handle authentication
      if (page.url().includes('microsoftonline.com') || page.url().includes('login.microsoft')) {
        console.log('  🔐 On Azure AD login page');

        // This requires manual intervention or pre-configured session
        // For automated tests, you would need:
        // 1. A service principal with client credentials
        // 2. Or, use browser context with stored auth state

        // For now, we'll pause to allow manual login
        console.log('  ⏸️ PAUSED: Complete Azure AD login manually...');

        // Wait for redirect back to app after login
        await page.waitForURL((url) => url.origin.includes('openagentic'), { timeout: 120000 });
        console.log('  ✅ Redirected back to app');
      }
    } else {
      console.log('  ⚠️ SSO button not found, checking if already logged in...');
    }

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/screenshots/sso-03-after-login.png', fullPage: true });
    console.log(`Current URL after auth: ${page.url()}`);

    // Step 2: Look for Flowise button
    console.log('\n🔧 Step 2: Looking for Flowise access...');

    // Check page content
    const pageContent = await page.content();
    console.log('Page title:', await page.title());

    // Log all buttons for debugging
    const buttons = await page.locator('button').all();
    console.log(`Found ${buttons.length} buttons`);
    for (let i = 0; i < Math.min(buttons.length, 10); i++) {
      const text = await buttons[i].textContent().catch(() => '');
      console.log(`  Button ${i}: "${text?.trim().substring(0, 50)}"`);
    }

    // Look for Flowise in various locations
    const flowiseButton = page.locator('button:has-text("Flowise"), a:has-text("Flowise"), [data-testid*="flowise"]').first();

    if (await flowiseButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  📌 Found Flowise button, clicking...');
      await flowiseButton.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'test-results/screenshots/sso-04-flowise.png', fullPage: true });
    } else {
      // Try direct navigation
      console.log('  ⚠️ Flowise button not found, trying direct URL...');
      await page.goto(`${BASE_URL}/flowise`);
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'test-results/screenshots/sso-04-flowise-direct.png', fullPage: true });
    }

    // Check for 403 error
    const has403 = await page.locator('text=403 Forbidden').isVisible({ timeout: 2000 }).catch(() => false);
    const hasNoPermission = await page.locator('text=do not have permission').isVisible({ timeout: 2000 }).catch(() => false);

    if (has403 || hasNoPermission) {
      console.log('  ❌ ERROR: 403 Forbidden detected!');
      await page.screenshot({ path: 'test-results/screenshots/sso-ERROR-403.png', fullPage: true });

      // Debug: capture network requests
      console.log('\n📡 Network state:');
      console.log('URL:', page.url());
      console.log('Cookies:', await page.context().cookies());

      throw new Error('403 Forbidden error when accessing Flowise');
    }

    console.log('  ✅ No 403 error detected');
    await page.screenshot({ path: 'test-results/screenshots/sso-05-success.png', fullPage: true });

    // Verify Flowise UI elements
    const hasFlowiseUI = await page.locator('[class*="flowise"], text=Chatflows, text=Canvas').isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`Flowise UI visible: ${hasFlowiseUI}`);

    expect(has403).toBe(false);
    expect(hasNoPermission).toBe(false);
  });

  test('Check Flowise API auth endpoint', async ({ request }) => {
    // Test the Flowise auth API directly
    console.log('\n📡 Testing Flowise auth API...');

    const response = await request.get(`${BASE_URL}/api/flowise/auth`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    console.log(`Response status: ${response.status()}`);
    const body = await response.text();
    console.log(`Response body (first 500 chars): ${body.substring(0, 500)}`);

    // 401 is expected without auth, 403 indicates permission issue
    if (response.status() === 403) {
      console.log('  ⚠️ 403 Forbidden from auth endpoint');
    }
  });

  test('Debug: Capture full page state', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Get all interactive elements
    console.log('\n🔍 Page Analysis:');
    console.log('URL:', page.url());
    console.log('Title:', await page.title());

    // Log navigation elements
    const navLinks = await page.locator('nav a, nav button').all();
    console.log(`\nNavigation elements (${navLinks.length}):`);
    for (const el of navLinks.slice(0, 15)) {
      console.log(`  - ${await el.textContent()}`);
    }

    // Log sidebar elements
    const sidebarLinks = await page.locator('[class*="sidebar"] a, [class*="sidebar"] button').all();
    console.log(`\nSidebar elements (${sidebarLinks.length}):`);
    for (const el of sidebarLinks.slice(0, 15)) {
      console.log(`  - ${await el.textContent()}`);
    }

    await page.screenshot({ path: 'test-results/screenshots/debug-page-state.png', fullPage: true });
  });
});
