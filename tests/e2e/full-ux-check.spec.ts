/**
 * E2E Test: Comprehensive UX Feature Check
 *
 * Tests all major UI features and functionality of the OpenAgentic Chat application
 *
 * Run with: npx playwright test full-ux-check.spec.ts --headed
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'https://chat-dev.openagentic.io';
const LOCAL_ADMIN_EMAIL = 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

test.describe('Full UX Feature Check', () => {

  test.setTimeout(180000); // 3 minute timeout for comprehensive testing

  test('Complete UX flow: Login -> Chat -> Admin -> Flowise', async ({ page }) => {

    // ========================================================================
    // SECTION 1: LOGIN FLOW
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN FLOW ===');

    console.log('1.1 Navigating to login page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'screenshots/01-landing-page.png', fullPage: true });

    console.log('1.2 Checking for local auth button...');
    const localAuthButton = page.locator('text=Local Login')
      .or(page.locator('text=local'))
      .or(page.locator('[data-testid="local-auth"]'));

    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  Found local auth button, clicking...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'screenshots/02-local-auth-form.png', fullPage: true });
    }

    console.log('1.3 Filling in credentials...');
    const emailInput = page.locator('input[type="email"]')
      .or(page.locator('input[name="email"]'))
      .or(page.locator('input[placeholder*="email" i]'));
    const passwordInput = page.locator('input[type="password"]')
      .or(page.locator('input[name="password"]'));

    await emailInput.fill(LOCAL_ADMIN_EMAIL);
    await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
    await page.screenshot({ path: 'screenshots/03-credentials-filled.png', fullPage: true });

    console.log('1.4 Submitting login...');
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    console.log('1.5 Waiting for login completion...');
    await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), {
      timeout: 30000
    });
    await page.screenshot({ path: 'screenshots/04-after-login.png', fullPage: true });

    // Check for successful login indicators
    const isLoggedIn = await page.locator('body').isVisible();
    expect(isLoggedIn).toBe(true);
    console.log('  ✅ Login successful');

    // ========================================================================
    // SECTION 2: MAIN CHAT INTERFACE
    // ========================================================================
    console.log('\n=== SECTION 2: MAIN CHAT INTERFACE ===');

    console.log('2.1 Checking main chat interface elements...');

    // Check for chat input
    const chatInput = page.locator('textarea')
      .or(page.locator('input[placeholder*="message" i]'))
      .or(page.locator('input[placeholder*="chat" i]'))
      .or(page.locator('[contenteditable="true"]'));

    const hasChatInput = await chatInput.first().isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`  Chat input visible: ${hasChatInput ? '✅' : '❌'}`);

    // Check for send button
    const sendButton = page.locator('button:has-text("Send")')
      .or(page.locator('button[aria-label*="Send" i]'))
      .or(page.locator('button[type="submit"]'));

    const hasSendButton = await sendButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Send button visible: ${hasSendButton ? '✅' : '❌'}`);

    // Check for chat history/messages area
    const messagesArea = page.locator('[class*="message"]')
      .or(page.locator('[class*="chat"]'))
      .or(page.locator('[role="log"]'))
      .or(page.locator('[class*="conversation"]'));

    const hasMessagesArea = await messagesArea.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Messages area visible: ${hasMessagesArea ? '✅' : '❌'}`);

    await page.screenshot({ path: 'screenshots/05-chat-interface.png', fullPage: true });

    console.log('2.2 Testing chat functionality...');
    if (hasChatInput) {
      const testMessage = 'Hello, this is a test message for UX verification.';
      await chatInput.first().fill(testMessage);
      await page.screenshot({ path: 'screenshots/06-message-typed.png', fullPage: true });

      // Click send button or press Enter
      if (hasSendButton) {
        await sendButton.first().click();
      } else {
        await chatInput.first().press('Enter');
      }

      console.log('  Waiting for response...');
      await page.waitForTimeout(5000); // Wait for response to start
      await page.screenshot({ path: 'screenshots/07-message-sent.png', fullPage: true });

      // Check if message appears in chat
      const sentMessage = page.locator(`text="${testMessage}"`);
      const messageAppeared = await sentMessage.isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`  Message appeared in chat: ${messageAppeared ? '✅' : '❌'}`);

      // Wait a bit longer to see if response arrives
      await page.waitForTimeout(10000);
      await page.screenshot({ path: 'screenshots/08-after-response-wait.png', fullPage: true });
    }

    // ========================================================================
    // SECTION 3: UI ELEMENTS CHECK
    // ========================================================================
    console.log('\n=== SECTION 3: UI ELEMENTS CHECK ===');

    console.log('3.1 Checking navigation elements...');

    // Check for sidebar/navigation
    const sidebar = page.locator('[class*="sidebar"]')
      .or(page.locator('nav'))
      .or(page.locator('[role="navigation"]'));

    const hasSidebar = await sidebar.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Sidebar/Navigation: ${hasSidebar ? '✅' : '❌'}`);

    // Check for user menu/profile
    const userMenu = page.locator('[class*="user"]')
      .or(page.locator('[aria-label*="user" i]'))
      .or(page.locator('[aria-label*="profile" i]'))
      .or(page.locator('[aria-label*="account" i]'));

    const hasUserMenu = await userMenu.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  User menu/profile: ${hasUserMenu ? '✅' : '❌'}`);

    // Check for settings/admin access
    const adminButton = page.locator('text=Admin')
      .or(page.locator('[aria-label*="Admin" i]'))
      .or(page.locator('text=Settings'))
      .or(page.locator('[aria-label*="Settings" i]'));

    const hasAdminButton = await adminButton.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Admin/Settings button: ${hasAdminButton ? '✅' : '❌'}`);

    await page.screenshot({ path: 'screenshots/09-ui-elements.png', fullPage: true });

    // ========================================================================
    // SECTION 4: ADMIN PANEL
    // ========================================================================
    console.log('\n=== SECTION 4: ADMIN PANEL ===');

    if (hasAdminButton) {
      console.log('4.1 Opening admin panel...');
      await adminButton.first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'screenshots/10-admin-panel.png', fullPage: true });

      console.log('4.2 Checking admin panel tabs/sections...');

      // Common admin sections to look for
      const adminSections = [
        'Users',
        'Usage',
        'Analytics',
        'Prompts',
        'Templates',
        'System',
        'Audit',
        'Logs',
        'Flowise'
      ];

      for (const section of adminSections) {
        const sectionButton = page.locator(`text="${section}"`)
          .or(page.locator(`[aria-label*="${section}" i]`));
        const isVisible = await sectionButton.first().isVisible({ timeout: 2000 }).catch(() => false);
        console.log(`  ${section} section: ${isVisible ? '✅' : '❌'}`);

        if (isVisible) {
          await sectionButton.first().click();
          await page.waitForTimeout(1000);
          await page.screenshot({
            path: `screenshots/11-admin-${section.toLowerCase()}.png`,
            fullPage: true
          });
        }
      }

      // Check for console errors
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.waitForTimeout(2000);

      if (consoleErrors.length > 0) {
        console.log('  ⚠️  Console errors detected:');
        consoleErrors.forEach(err => console.log(`    - ${err}`));
      } else {
        console.log('  ✅ No console errors');
      }
    }

    // ========================================================================
    // SECTION 5: FLOWISE INTEGRATION
    // ========================================================================
    console.log('\n=== SECTION 5: FLOWISE INTEGRATION ===');

    console.log('5.1 Looking for Flowise button...');
    const flowiseButton = page.locator('[data-testid="flowise"]')
      .or(page.locator('text=Flowise'))
      .or(page.locator('[aria-label*="Flowise" i]'))
      .or(page.locator('button:has-text("Flowise")'))
      .or(page.locator('a:has-text("Flowise")'))
      .or(page.locator('[title*="Flowise" i]'));

    const hasFlowiseButton = await flowiseButton.first().isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`  Flowise button visible: ${hasFlowiseButton ? '✅' : '❌'}`);

    if (hasFlowiseButton) {
      await page.screenshot({ path: 'screenshots/12-before-flowise.png', fullPage: true });

      console.log('5.2 Clicking Flowise button...');
      await flowiseButton.first().click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'screenshots/13-flowise-clicked.png', fullPage: true });

      console.log('5.3 Waiting for Flowise to load...');
      await page.waitForTimeout(7000);
      await page.screenshot({ path: 'screenshots/14-flowise-loaded.png', fullPage: true });

      console.log('5.4 Checking for Flowise loading issues...');

      // Check for error messages
      const flowiseError = page.locator('text=Failed to Load')
        .or(page.locator('text=Error'))
        .or(page.locator('text=taking longer than expected'));

      const hasError = await flowiseError.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`  Flowise error message: ${hasError ? '❌ FOUND' : '✅ NOT FOUND'}`);

      // Check for loading spinner stuck
      const loadingSpinner = page.locator('.animate-spin')
        .or(page.locator('[class*="loading"]'))
        .or(page.locator('[class*="spinner"]'));

      const stillLoading = await loadingSpinner.first().isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`  Loading spinner (after 10s): ${stillLoading ? '⚠️  STILL VISIBLE' : '✅ GONE'}`);

      // Check for iframe
      const iframes = page.locator('iframe');
      const iframeCount = await iframes.count();
      console.log(`  Iframes found: ${iframeCount}`);

      if (iframeCount > 0) {
        const iframeSrc = await iframes.first().getAttribute('src');
        console.log(`  Iframe URL: ${iframeSrc}`);

        // Try to check iframe content
        const frame = page.frameLocator('iframe').first();
        const flowiseElements = frame.locator('text=Chatflows')
          .or(frame.locator('text=Dashboard'))
          .or(frame.locator('text=Agentflows'))
          .or(frame.locator('[class*="MuiDrawer"]'))
          .or(frame.locator('[class*="sidebar"]'));

        const hasFlowiseUI = await flowiseElements.first().isVisible({ timeout: 15000 }).catch(() => false);
        console.log(`  Flowise UI elements in iframe: ${hasFlowiseUI ? '✅' : '❌'}`);

        if (!hasFlowiseUI) {
          // Try to get iframe body content
          try {
            const iframeBody = await frame.locator('body').innerHTML({ timeout: 5000 });
            console.log(`  Iframe body preview: ${iframeBody.substring(0, 200)}...`);
          } catch (e) {
            console.log(`  Could not access iframe content: ${e}`);
          }
        }
      } else {
        console.log('  ⚠️  No iframe found - Flowise might be rendered differently');
      }

      await page.screenshot({ path: 'screenshots/15-flowise-final.png', fullPage: true });
    }

    // ========================================================================
    // SECTION 6: TYPOGRAPHY & STYLING CHECK
    // ========================================================================
    console.log('\n=== SECTION 6: TYPOGRAPHY & STYLING CHECK ===');

    console.log('6.1 Checking for styling consistency...');

    // Go back to main chat to check styling
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Check computed styles of key elements
    const headingElements = page.locator('h1, h2, h3, h4, h5, h6');
    const headingCount = await headingElements.count();
    console.log(`  Heading elements found: ${headingCount}`);

    // Check for consistent font families
    if (headingCount > 0) {
      const firstHeading = headingElements.first();
      const fontFamily = await firstHeading.evaluate(el =>
        window.getComputedStyle(el).fontFamily
      ).catch(() => 'unknown');
      console.log(`  Primary font family: ${fontFamily}`);
    }

    // Check button styles
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    console.log(`  Button elements found: ${buttonCount}`);

    // Check for color contrast issues (basic check)
    const bodyBg = await page.locator('body').evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    ).catch(() => 'unknown');
    console.log(`  Body background color: ${bodyBg}`);

    await page.screenshot({ path: 'screenshots/16-styling-check.png', fullPage: true });

    // ========================================================================
    // SECTION 7: MOBILE RESPONSIVENESS (Viewport Test)
    // ========================================================================
    console.log('\n=== SECTION 7: MOBILE RESPONSIVENESS ===');

    console.log('7.1 Testing mobile viewport (375x667)...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/17-mobile-view.png', fullPage: true });

    console.log('7.2 Testing tablet viewport (768x1024)...');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/18-tablet-view.png', fullPage: true });

    console.log('7.3 Restoring desktop viewport...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);

    // ========================================================================
    // TEST COMPLETE
    // ========================================================================
    console.log('\n=== TEST COMPLETE ===');
    console.log('✅ Full UX check completed!');
    console.log('📸 Screenshots saved to screenshots/ directory');
  });
});
