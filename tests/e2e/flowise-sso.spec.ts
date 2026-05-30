/**
 * E2E Test: Flowise SSO Authentication Flow
 *
 * Tests that Flowise loads properly after logging in via local admin
 * through https://chat-dev.openagentic.io/
 *
 * Run with: npx playwright test flowise-sso.spec.ts --headed
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'https://chat-dev.openagentic.io';
const LOCAL_ADMIN_EMAIL = 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = 'REPLACE_WITH_REAL_TEST_PASSWORD';

test.describe('Flowise SSO Integration', () => {

  test.setTimeout(120000); // 2 minute timeout for slow operations

  test('Login as local admin and open Flowise without black screen', async ({ page }) => {
    // Step 1: Navigate to login page
    console.log('Step 1: Navigating to login page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Step 2: Click local auth button if on login page
    console.log('Step 2: Looking for local auth login...');

    // Check if we're on a login page or need to find local auth
    const localAuthButton = page.locator('text=Local Login').or(page.locator('text=local')).or(page.locator('[data-testid="local-auth"]'));

    // If there's a local auth button, click it
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  Found local auth button, clicking...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    // Step 3: Fill in local admin credentials
    console.log('Step 3: Filling in credentials...');

    // Look for email/username input
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]')).or(page.locator('input[placeholder*="email" i]'));
    const passwordInput = page.locator('input[type="password"]').or(page.locator('input[name="password"]'));

    await emailInput.fill(LOCAL_ADMIN_EMAIL);
    await passwordInput.fill(LOCAL_ADMIN_PASSWORD);

    // Step 4: Submit login form
    console.log('Step 4: Submitting login...');
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    // Wait for login to complete - should redirect to main app
    console.log('Step 5: Waiting for login completion...');
    await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), { timeout: 30000 });

    // Take screenshot after login
    await page.screenshot({ path: 'tests/e2e/screenshots/after-login.png', fullPage: true });
    console.log('  Screenshot saved: after-login.png');

    // Step 6: Find and click Flowise button/link
    console.log('Step 6: Looking for Flowise button...');

    // Look for various ways Flowise might be accessed
    const flowiseButton = page.locator('[data-testid="flowise"]')
      .or(page.locator('text=Flowise'))
      .or(page.locator('[aria-label*="Flowise" i]'))
      .or(page.locator('button:has-text("Flowise")'))
      .or(page.locator('a:has-text("Flowise")'))
      .or(page.locator('[title*="Flowise" i]'));

    // Wait for button to be visible
    await expect(flowiseButton.first()).toBeVisible({ timeout: 10000 });
    console.log('  Found Flowise button, clicking...');

    // Take screenshot before clicking
    await page.screenshot({ path: 'tests/e2e/screenshots/before-flowise-click.png', fullPage: true });

    await flowiseButton.first().click();

    // Step 7: Wait for Flowise to load
    console.log('Step 7: Waiting for Flowise to load...');
    await page.waitForTimeout(5000); // Give it time to start loading

    // Take screenshot after clicking
    await page.screenshot({ path: 'tests/e2e/screenshots/after-flowise-click.png', fullPage: true });
    console.log('  Screenshot saved: after-flowise-click.png');

    // Step 8: Check for black screen indicators
    console.log('Step 8: Checking for black/white screen...');

    // Check iframe URL
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();
    if (iframeCount > 0) {
      const iframeSrc = await iframes.first().getAttribute('src');
      console.log(`  Iframe URL: ${iframeSrc}`);
    }

    // Wait a bit more for content to render
    await page.waitForTimeout(10000);

    // Take final screenshot
    await page.screenshot({ path: 'tests/e2e/screenshots/flowise-loaded.png', fullPage: true });
    console.log('  Screenshot saved: flowise-loaded.png');

    // Check for error messages
    const errorText = await page.locator('text=Failed to Load').or(page.locator('text=Error')).count();
    expect(errorText).toBe(0);

    // Check for loading spinner that's stuck
    const loadingSpinner = page.locator('.animate-spin').or(page.locator('[class*="loading"]'));

    // After 10 seconds, loading should be done
    const stillLoading = await loadingSpinner.isVisible().catch(() => false);
    if (stillLoading) {
      console.log('  WARNING: Still showing loading spinner after 10s');
      await page.screenshot({ path: 'tests/e2e/screenshots/flowise-still-loading.png', fullPage: true });
    }

    // Step 9: Verify Flowise content is visible
    console.log('Step 9: Verifying Flowise content...');

    // Recount iframes (in case more were added)
    const totalIframes = await page.locator('iframe').count();
    console.log(`  Found ${totalIframes} iframe(s)`);

    if (totalIframes > 0) {
      // Try to access iframe content - use first iframe found
      const frame = page.frameLocator('iframe').first();

      // Look for Flowise-specific elements inside iframe
      // Flowise UI has MUI components, sidebar, and specific text
      const flowiseElements = frame.locator('text=Chatflows')
        .or(frame.locator('text=Dashboard'))
        .or(frame.locator('text=Agentflows'))
        .or(frame.locator('[class*="MuiDrawer"]'))
        .or(frame.locator('[class*="sidebar"]'))
        .or(frame.locator('[class*="MuiBox"]'));

      // Wait for Flowise UI elements
      const hasFlowiseUI = await flowiseElements.first().isVisible({ timeout: 20000 }).catch(() => false);

      if (hasFlowiseUI) {
        console.log('  ✅ Flowise UI elements found!');
      } else {
        console.log('  ❌ No Flowise UI elements found in iframe');

        // Check what's actually in the iframe
        try {
          const iframeHtml = await frame.locator('body').innerHTML();
          console.log('  Iframe body preview:', iframeHtml.substring(0, 500));
        } catch (e) {
          console.log('  Could not get iframe content:', e);
        }

        // Take screenshot of iframe content
        await page.screenshot({ path: 'tests/e2e/screenshots/flowise-iframe-content.png', fullPage: true });
      }

      expect(hasFlowiseUI).toBe(true);
    } else {
      // No iframe - Flowise might be rendered directly
      console.log('  No iframe found, checking for direct Flowise content...');

      // Check for Flowise UI elements directly on page
      const directFlowiseUI = page.locator('text=Chatflows')
        .or(page.locator('text=Dashboard'))
        .or(page.locator('[class*="MuiDrawer"]'));

      const hasDirectUI = await directFlowiseUI.first().isVisible({ timeout: 5000 }).catch(() => false);
      expect(hasDirectUI).toBe(true);
    }

    console.log('✅ Test completed successfully!');
  });

  test('SSO token flow works correctly', async ({ page, request }) => {
    // Test the SSO token-auth endpoint directly
    console.log('Testing SSO token-auth endpoint...');

    // First login via the UI to get auth token
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Click local auth button if visible
    const localAuthButton = page.locator('text=Local Login').or(page.locator('text=local')).or(page.locator('[data-testid="local-auth"]'));
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    // Look for email/username input with better selectors
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]')).or(page.locator('input[placeholder*="email" i]'));
    const passwordInput = page.locator('input[type="password"]').or(page.locator('input[name="password"]'));

    // Wait for form elements with explicit timeout
    await emailInput.waitFor({ timeout: 10000 });

    // Fill credentials
    await emailInput.fill(LOCAL_ADMIN_EMAIL);
    await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for login
    await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), { timeout: 30000 });

    // Get cookies
    const cookies = await page.context().cookies();
    console.log('Cookies after login:', cookies.map(c => c.name));

    // Test the Flowise SSO endpoint
    const response = await request.post(`${BASE_URL}/flowise/api/v1/openagentic/token-auth`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Flowise-Response': 'json',
        'Cookie': cookies.map(c => `${c.name}=${c.value}`).join('; ')
      },
      data: {}
    });

    console.log('SSO token-auth response status:', response.status());

    const responseBody = await response.json().catch(() => response.text());
    console.log('SSO token-auth response:', JSON.stringify(responseBody, null, 2));

    expect(response.status()).toBe(200);
    expect(responseBody.success).toBe(true);
    expect(responseBody.ssoUrl).toBeDefined();

    console.log('SSO URL:', responseBody.ssoUrl);

    // Now test the sso-success endpoint
    if (responseBody.ssoUrl) {
      const ssoToken = new URL(responseBody.ssoUrl, BASE_URL).searchParams.get('token');
      console.log('SSO Token:', ssoToken);

      const ssoSuccessResponse = await request.get(`${BASE_URL}/api/v1/auth/sso-success?token=${ssoToken}`, {
        headers: {
          'Cookie': cookies.map(c => `${c.name}=${c.value}`).join('; ')
        }
      });

      console.log('SSO success response status:', ssoSuccessResponse.status());
      expect(ssoSuccessResponse.status()).toBe(200);

      const ssoSuccessBody = await ssoSuccessResponse.json().catch(() => ssoSuccessResponse.text());
      console.log('SSO success response:', JSON.stringify(ssoSuccessBody, null, 2));

      // Verify user data is returned
      expect(ssoSuccessBody.email).toBe(LOCAL_ADMIN_EMAIL);
      expect(ssoSuccessBody.permissions).toBeDefined();
    }

    console.log('✅ SSO token flow test completed successfully!');
  });
});
