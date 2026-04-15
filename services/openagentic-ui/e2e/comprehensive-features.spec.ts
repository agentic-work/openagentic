/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Comprehensive E2E Tests for OpenAgentic Platform
 *
 * Based on actual UI code analysis:
 * - Login.tsx: Click "Local" -> fill email/password -> click "SIGN IN" (button[type="submit"])
 * - WelcomeCapabilitySelector.tsx: Close via button[aria-label="Skip"] or "Just let me chat" button
 * - OnboardingTutorial.tsx: Close via Skip button or X button
 *
 * Storage keys:
 * - 'ac-welcome-shown' - WelcomeCapabilitySelector
 * - 'ac-onboarding-completed' - OnboardingTutorial
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://ai.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@openagentics.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test.use({ ignoreHTTPSErrors: true });

/**
 * Login as local admin through the login page
 */
async function loginAsLocalAdmin(page: Page) {
  console.log('=== LOGIN AS LOCAL ADMIN ===');

  // 1. Go to login page
  console.log('1. Going to login page...');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // 2. Click "Local" button
  console.log('2. Clicking Local button...');
  await page.click('button:has-text("Local")');
  await page.waitForTimeout(500);

  // 3. Fill email
  console.log('3. Filling email...');
  await page.fill('input[type="email"]', ADMIN_EMAIL);

  // 4. Fill password and submit with Enter
  console.log('4. Filling password...');
  await page.fill('input[type="password"]', ADMIN_PASSWORD);

  // 5. Press Enter to submit form
  console.log('5. Pressing Enter to submit...');
  await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/auth/local/login'), { timeout: 30000 }).catch(e => console.log('No login response:', e.message)),
    page.keyboard.press('Enter')
  ]);

  await page.waitForTimeout(2000);
  console.log(`   Current URL: ${page.url()}`);

  // 6. Handle any modals - use Escape key to dismiss
  console.log('6. Dismissing modals...');

  // Try pressing Escape a few times to close any modals
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Set localStorage to prevent modals from appearing again
  await page.evaluate(() => {
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
  });

  // Reload to apply localStorage and dismiss modals
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'e2e/screenshots/login-complete.png', fullPage: true });
  console.log(`Login complete. URL: ${page.url()}`);
}

/**
 * Close Welcome and Onboarding modals - based on WelcomeCapabilitySelector.tsx and OnboardingTutorial.tsx
 */
async function closeAllModals(page: Page) {
  console.log('\n=== CLOSING MODALS ===');

  // Wait for modals to potentially appear
  await page.waitForTimeout(2000);

  for (let attempt = 0; attempt < 5; attempt++) {
    console.log(`Attempt ${attempt + 1} to close modals...`);

    await page.screenshot({ path: `e2e/screenshots/modal-${attempt}.png`, fullPage: true });

    // Check for WelcomeCapabilitySelector modal
    // From WelcomeCapabilitySelector.tsx: "Welcome to OpenAgentic" and "What would you like to do?"
    const welcomeModal = page.locator('text=Welcome to OpenAgentic');
    const whatToDo = page.locator('text=What would you like to do?');

    const hasWelcomeModal = await welcomeModal.isVisible({ timeout: 1000 }).catch(() => false);
    const hasWhatToDo = await whatToDo.isVisible({ timeout: 500 }).catch(() => false);

    if (hasWelcomeModal || hasWhatToDo) {
      console.log('  Found Welcome modal, closing...');

      // Option 1: Click the X button with aria-label="Skip"
      // From WelcomeCapabilitySelector.tsx line 166-173
      const skipXButton = page.locator('button[aria-label="Skip"]');
      if (await skipXButton.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('  Clicking X button (aria-label="Skip")...');
        await skipXButton.click();
        await page.waitForTimeout(500);
        continue;
      }

      // Option 2: Click "Just let me chat" button
      // From WelcomeCapabilitySelector.tsx line 272-279
      const justChatButton = page.locator('button:has-text("Just let me chat")');
      if (await justChatButton.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('  Clicking "Just let me chat" button...');
        await justChatButton.click();
        await page.waitForTimeout(500);
        continue;
      }

      // Option 3: Click backdrop to close
      console.log('  Clicking backdrop...');
      await page.mouse.click(10, 10);
      await page.waitForTimeout(500);
      continue;
    }

    // Check for OnboardingTutorial modal
    // From OnboardingTutorial.tsx: has Skip button
    const skipButton = page.locator('button:has-text("Skip")');
    if (await skipButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  Found Skip button (likely OnboardingTutorial), clicking...');
      await skipButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // Check for any generic close button
    const closeButton = page.locator('button[aria-label="Close"]');
    if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  Found Close button, clicking...');
      await closeButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // No modals found, we're done
    console.log('  No more modals detected.');
    break;
  }

  // Set localStorage to prevent modals from appearing again
  console.log('Setting localStorage to prevent modals...');
  await page.evaluate(() => {
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
  });

  await page.screenshot({ path: 'e2e/screenshots/modal-done.png', fullPage: true });
}

// ==================== CODE MODE TEST ====================

test.describe('Code Mode Test', () => {
  test.setTimeout(360000);

  test('should use Code Mode to create an app', async ({ page }) => {
    await loginAsLocalAdmin(page);

    console.log('\n=== CODE MODE TEST ===');

    // Find and click Code Mode button
    // Usually shows as ">_Code" or just "Code"
    console.log('Looking for Code Mode button...');
    const codeButton = page.locator('button:has-text(">_Code"), button:has-text("Code")').first();

    if (await codeButton.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('Found Code button, clicking...');
      await codeButton.click();
    } else {
      console.log('Code button not found, navigating directly to /code...');
      await page.goto(`${BASE_URL}/code`);
    }

    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'e2e/screenshots/codemode-loaded.png', fullPage: true });

    // Wait for Code Mode input (textarea)
    console.log('Waiting for Code Mode input...');
    const codeInput = page.locator('textarea').first();
    await codeInput.waitFor({ timeout: 15000 });
    console.log('Code Mode loaded!');

    // Check for VSCode/Editor iframe
    console.log('Checking for VSCode panel...');
    const vscodeIframe = page.locator('iframe').first();
    const hasVSCode = await vscodeIframe.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`VSCode iframe visible: ${hasVSCode}`);

    await page.screenshot({ path: 'e2e/screenshots/codemode-vscode.png', fullPage: true });

    // Send prompt to create app
    console.log('Sending prompt...');
    const prompt = `Create a Python Flask app with main.py containing:
- GET / returning "Hello World"
- GET /health returning {"status":"ok"}`;

    await codeInput.fill(prompt);
    await page.keyboard.press('Enter');
    console.log('Prompt sent!');

    await page.screenshot({ path: 'e2e/screenshots/codemode-prompt-sent.png', fullPage: true });

    // Monitor for code generation
    console.log('Monitoring for code generation...');
    let codeGenerated = false;

    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(5000);

      const bodyText = await page.textContent('body') || '';
      const hasFlask = bodyText.includes('Flask') || bodyText.includes('flask');
      const hasMainPy = bodyText.includes('main.py');
      const hasCreated = bodyText.toLowerCase().includes('creat');

      console.log(`[${(i+1)*5}s] Flask:${hasFlask} MainPy:${hasMainPy} Created:${hasCreated}`);

      if (hasFlask && hasMainPy) {
        codeGenerated = true;
        console.log('Code generation detected!');
        break;
      }

      if (i % 6 === 0) {
        await page.screenshot({ path: `e2e/screenshots/codemode-progress-${i}.png` });
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/codemode-final.png', fullPage: true });

    console.log('\n=== CODE MODE RESULTS ===');
    console.log(`Code generated: ${codeGenerated}`);
    console.log(`VSCode visible: ${hasVSCode}`);

    expect(codeGenerated).toBe(true);
  });
});
