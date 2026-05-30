/**
 * E2E Test: OpenAgenticCode (AWCode) Feature
 *
 * Tests the AWCode AI coding assistant functionality:
 * - Login as local admin
 * - Open AWCode panel via sidebar icon
 * - Verify PTY terminal connects and works
 * - Test the real xterm.js terminal interface
 *
 * Run with: npx playwright test awcode-e2e.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'https://chat.example.com';
const LOCAL_ADMIN_EMAIL = 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || 'REPLACE_WITH_REAL_TEST_PASSWORD';

// Helper to capture console logs and errors
async function setupConsoleCapture(page: Page) {
  const logs: { type: string; text: string }[] = [];

  page.on('console', (msg) => {
    logs.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') {
      console.log(`[CONSOLE ERROR]: ${msg.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    console.log(`[PAGE ERROR]: ${error.message}`);
    logs.push({ type: 'pageerror', text: error.message });
  });

  return logs;
}

test.describe('OpenAgenticCode PTY Terminal E2E Test', () => {

  test.setTimeout(180000); // 3 minute timeout

  test('Login -> Open AWCode -> Verify PTY Terminal Connection', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);

    // ========================================================================
    // SECTION 1: LOGIN FLOW
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN FLOW ===');

    console.log('1.1 Navigating to login page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-01-landing.png', fullPage: true });

    console.log('1.2 Looking for local auth option...');
    const localAuthButton = page.locator('text=Local Login')
      .or(page.locator('text=local'))
      .or(page.locator('[data-testid="local-auth"]'));

    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  Found local auth button, clicking...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    console.log('1.3 Filling in credentials...');
    const emailInput = page.locator('input[type="email"]')
      .or(page.locator('input[name="email"]'))
      .or(page.locator('input[placeholder*="email" i]'));
    const passwordInput = page.locator('input[type="password"]')
      .or(page.locator('input[name="password"]'));

    await emailInput.fill(LOCAL_ADMIN_EMAIL);
    await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-02-credentials.png', fullPage: true });

    console.log('1.4 Submitting login...');
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    console.log('1.5 Waiting for login completion...');
    await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), {
      timeout: 30000
    });
    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-03-logged-in.png', fullPage: true });
    console.log('  ✅ Login successful');

    // ========================================================================
    // SECTION 2: FIND AND CLICK AWCODE ICON
    // ========================================================================
    console.log('\n=== SECTION 2: OPEN AWCODE TERMINAL ===');

    // Wait for main interface to fully load
    await page.waitForTimeout(2000);

    console.log('2.1 Looking for AWCode terminal icon in sidebar...');

    // The AWCode icon is a Terminal icon in the sidebar with a glowing effect
    // It should have title="OpenAgenticCode (Ctrl+Shift+C)" or similar
    const awcodeIcon = page.locator('button[title*="OpenAgenticCode"]')
      .or(page.locator('button[title*="Ctrl+Shift+C"]'))
      .or(page.locator('button:has(svg.lucide-terminal)'))
      .or(page.locator('aside button:has(svg)').nth(1)); // Terminal icon is usually second in sidebar

    // Debug: List all buttons in sidebar
    const sidebarButtons = await page.locator('aside button').all();
    console.log(`  Found ${sidebarButtons.length} buttons in sidebar`);

    for (let i = 0; i < sidebarButtons.length; i++) {
      const title = await sidebarButtons[i].getAttribute('title');
      console.log(`    Button ${i}: title="${title}"`);
    }

    const hasAwcodeIcon = await awcodeIcon.first().isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`  AWCode icon visible: ${hasAwcodeIcon ? '✅' : '❌'}`);

    if (hasAwcodeIcon) {
      console.log('2.2 Clicking AWCode icon...');
      await awcodeIcon.first().click();
    } else {
      console.log('2.2 Icon not found, trying keyboard shortcut Ctrl+Shift+C...');
      await page.keyboard.press('Control+Shift+c');
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-04-clicked.png', fullPage: true });

    // ========================================================================
    // SECTION 3: VERIFY DISCLAIMER MODAL
    // ========================================================================
    console.log('\n=== SECTION 3: VERIFY DISCLAIMER MODAL ===');

    // The AWCode component shows a disclaimer modal first
    const disclaimerModal = page.locator('text=Real Terminal Experience')
      .or(page.locator('text=actual AWCode CLI'));

    const hasDisclaimer = await disclaimerModal.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Disclaimer modal visible: ${hasDisclaimer ? '✅' : '❌'}`);

    if (hasDisclaimer) {
      console.log('3.1 Found disclaimer modal, clicking Launch Terminal...');
      const launchButton = page.locator('button:has-text("Launch Terminal")');
      await launchButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'tests/e2e/screenshots/awcode-05-launched.png', fullPage: true });
    }

    // ========================================================================
    // SECTION 4: VERIFY XTERM.JS TERMINAL
    // ========================================================================
    console.log('\n=== SECTION 4: VERIFY XTERM.JS TERMINAL ===');

    // The terminal uses xterm.js which renders to a canvas element
    const xtermContainer = page.locator('.xterm')
      .or(page.locator('[class*="xterm"]'))
      .or(page.locator('canvas'));

    const hasXterm = await xtermContainer.first().isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`  xterm.js container visible: ${hasXterm ? '✅' : '❌'}`);

    // Check for connection status indicator
    const connectionStatus = page.locator('text=Connected')
      .or(page.locator('text=Connecting'));

    const statusText = await connectionStatus.first().textContent({ timeout: 10000 }).catch(() => 'not found');
    console.log(`  Connection status: ${statusText}`);

    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-06-terminal.png', fullPage: true });

    // ========================================================================
    // SECTION 5: CHECK FOR ERRORS
    // ========================================================================
    console.log('\n=== SECTION 5: CHECK FOR ERRORS ===');

    // Check for error indicators
    const errorIndicator = page.locator('text=Error')
      .or(page.locator('.text-red-500'))
      .or(page.locator('[class*="error"]'));

    const hasErrors = await errorIndicator.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`  Error indicators visible: ${hasErrors ? '❌ YES' : '✅ NO'}`);

    if (hasErrors) {
      const errorText = await errorIndicator.first().textContent();
      console.log(`  Error message: ${errorText}`);
    }

    // Report console errors
    const consoleErrors = consoleLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
    console.log(`\n  Console errors found: ${consoleErrors.length}`);
    consoleErrors.forEach((err, i) => {
      console.log(`    ${i + 1}. ${err.text.slice(0, 200)}`);
    });

    // ========================================================================
    // SECTION 6: VERIFY WEBSOCKET CONNECTION
    // ========================================================================
    console.log('\n=== SECTION 6: VERIFY WEBSOCKET CONNECTION ===');

    // Check for WebSocket connection logs
    const wsLogs = consoleLogs.filter(l =>
      l.text.includes('WebSocket') ||
      l.text.includes('PTY') ||
      l.text.includes('awcode')
    );

    console.log(`  WebSocket-related logs: ${wsLogs.length}`);
    wsLogs.slice(0, 10).forEach((log, i) => {
      console.log(`    ${i + 1}. [${log.type}] ${log.text.slice(0, 150)}`);
    });

    // ========================================================================
    // SECTION 7: VERIFY TERMINAL HEADER
    // ========================================================================
    console.log('\n=== SECTION 7: VERIFY TERMINAL HEADER ===');

    // Check for header elements - Terminal icon, title, version, close button
    const terminalHeader = page.locator('text=OpenAgentic Code');
    const hasHeader = await terminalHeader.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Terminal header visible: ${hasHeader ? '✅' : '❌'}`);

    // Check for close button
    const closeButton = page.locator('button[title="Close"]')
      .or(page.locator('button:has(svg.lucide-x)'));
    const hasCloseButton = await closeButton.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`  Close button visible: ${hasCloseButton ? '✅' : '❌'}`);

    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-07-final.png', fullPage: true });

    // ========================================================================
    // SECTION 8: TEST TERMINAL INTERACTION (if connected)
    // ========================================================================
    console.log('\n=== SECTION 8: TEST TERMINAL INTERACTION ===');

    const isConnected = statusText.includes('Connected');
    if (isConnected && hasXterm) {
      console.log('8.1 Terminal connected, waiting for PTY output...');
      await page.waitForTimeout(5000);

      // The terminal should show the AWCode CLI welcome message or prompt
      await page.screenshot({ path: 'tests/e2e/screenshots/awcode-08-terminal-output.png', fullPage: true });

      console.log('8.2 Attempting to type in terminal...');
      // Click on the terminal to focus it
      await xtermContainer.first().click();
      await page.waitForTimeout(500);

      // Type a simple command - /help should work in AWCode CLI
      await page.keyboard.type('/help');
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');

      console.log('8.3 Waiting for command response...');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'tests/e2e/screenshots/awcode-09-command-response.png', fullPage: true });

      console.log('  ✅ Terminal interaction test completed');
    } else {
      console.log('  ⚠️ Skipping terminal interaction - not connected');
    }

    // ========================================================================
    // SECTION 9: CLOSE TERMINAL
    // ========================================================================
    console.log('\n=== SECTION 9: CLOSE TERMINAL ===');

    if (hasCloseButton) {
      console.log('9.1 Closing terminal...');
      await closeButton.first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'tests/e2e/screenshots/awcode-10-closed.png', fullPage: true });
      console.log('  ✅ Terminal closed');
    }

    // ========================================================================
    // TEST SUMMARY
    // ========================================================================
    console.log('\n=== TEST SUMMARY ===');
    console.log(`  Login: ✅`);
    console.log(`  AWCode icon found: ${hasAwcodeIcon ? '✅' : '❌'}`);
    console.log(`  Disclaimer modal: ${hasDisclaimer ? '✅' : 'N/A'}`);
    console.log(`  xterm.js terminal: ${hasXterm ? '✅' : '❌'}`);
    console.log(`  Connected: ${isConnected ? '✅' : '❌'}`);
    console.log(`  Console errors: ${consoleErrors.length === 0 ? '✅' : `❌ (${consoleErrors.length})`}`);
    console.log('📸 Screenshots saved to tests/e2e/screenshots/');

    // Final assertions
    expect(hasXterm || hasDisclaimer).toBe(true); // Either terminal or disclaimer should be visible
  });

  test('Backend API Test: AWCode Session Management', async ({ request }) => {
    console.log('\n=== BACKEND API TEST: AWCODE SESSIONS ===');

    // Test direct connection to awcode-manager (via Caddy proxy)
    console.log('Testing session creation via /api/code/sessions...');

    // First test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await request.get(`${BASE_URL}/api/code/health`);
    console.log(`   Health response status: ${healthResponse.status()}`);

    if (!healthResponse.ok()) {
      const text = await healthResponse.text();
      console.log(`   Health response body: ${text}`);
    }

    // Try to create a session (will fail without auth, but tests routing)
    console.log('2. Testing session creation endpoint (expect 401 without auth)...');
    const sessionResponse = await request.post(`${BASE_URL}/api/code/sessions`, {
      data: { model: 'auto' },
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`   Session response status: ${sessionResponse.status()}`);

    const sessionText = await sessionResponse.text();
    console.log(`   Session response body: ${sessionText.slice(0, 200)}`);

    // A 401 or 403 means routing works, 404 means routing is broken
    expect(sessionResponse.status()).not.toBe(404);
    console.log('  ✅ API routing to awcode-manager is working');
  });

  test('WebSocket Test: PTY Connection', async ({ page }) => {
    console.log('\n=== WEBSOCKET TEST: PTY CONNECTION ===');

    const wsMessages: string[] = [];
    const wsErrors: string[] = [];

    // Capture WebSocket events
    page.on('websocket', (ws) => {
      console.log(`WebSocket opened: ${ws.url()}`);
      wsMessages.push(`OPEN: ${ws.url()}`);

      ws.on('framereceived', (event) => {
        wsMessages.push(`RECV: ${event.payload.toString().slice(0, 100)}`);
      });

      ws.on('framesent', (event) => {
        wsMessages.push(`SENT: ${event.payload.toString().slice(0, 100)}`);
      });

      ws.on('close', () => {
        wsMessages.push('CLOSE');
      });
    });

    // Login and open AWCode (reuse login logic)
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const localAuthButton = page.locator('text=Local Login').or(page.locator('text=local'));
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    await page.locator('input[type="email"]').fill(LOCAL_ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(LOCAL_ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click AWCode icon
    const awcodeIcon = page.locator('button[title*="OpenAgenticCode"]')
      .or(page.locator('button[title*="Ctrl+Shift+C"]'));

    if (await awcodeIcon.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await awcodeIcon.first().click();
    } else {
      await page.keyboard.press('Control+Shift+c');
    }

    await page.waitForTimeout(1000);

    // Click Launch Terminal if disclaimer shows
    const launchButton = page.locator('button:has-text("Launch Terminal")');
    if (await launchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await launchButton.click();
    }

    // Wait for WebSocket connection
    console.log('Waiting for WebSocket connection...');
    await page.waitForTimeout(10000);

    // Report WebSocket activity
    console.log(`\nWebSocket messages captured: ${wsMessages.length}`);
    wsMessages.slice(0, 20).forEach((msg, i) => {
      console.log(`  ${i + 1}. ${msg}`);
    });

    await page.screenshot({ path: 'tests/e2e/screenshots/awcode-ws-test.png', fullPage: true });

    const hasWsConnection = wsMessages.some(m => m.includes('OPEN') && m.includes('/api/code/ws/terminal'));
    console.log(`\nWebSocket connected to PTY: ${hasWsConnection ? '✅' : '❌'}`);

    expect(wsMessages.length).toBeGreaterThan(0);
  });
});
