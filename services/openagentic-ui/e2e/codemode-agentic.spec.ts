/**
 * Code Mode Agentic Loop Test
 *
 * Tests the full agentic loop in Code Mode - based on working interleaved test login flow
 */

import { test, expect, Page } from '@playwright/test';

const LOCAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const LOGIN_TIMEOUT = 30000;

test.describe('Code Mode Agentic Loop', () => {
  test.setTimeout(300000); // 5 minutes

  /**
   * Login helper - copied from working interleaved test
   */
  async function loginAsLocalAdmin(page: Page) {
    console.log('Navigating to login page...');
    await page.goto('/');

    const localButton = page.locator('button:has-text("Local")');
    const chatInput = page.locator('[data-testid="chat-input"], textarea[placeholder*="message" i], textarea, .chat-input');

    const alreadyLoggedIn = await chatInput.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (alreadyLoggedIn) {
      console.log('Already logged in!');
      return;
    }

    const hasLocalButton = await localButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasLocalButton) {
      console.log('Clicking Local login button...');
      await localButton.click();
      await page.waitForTimeout(1000);
    }

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const hasLoginForm = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasLoginForm) {
      console.log('Login form detected, entering credentials...');
      await emailInput.click();
      await emailInput.fill(LOCAL_ADMIN_EMAIL);
      await passwordInput.click();
      await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
      await page.waitForTimeout(500);

      // Click SIGN IN via JavaScript
      console.log('Clicking SIGN IN button...');
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (btn) btn.click();
        else {
          const form = document.querySelector('form');
          if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      });

      await page.waitForTimeout(1000);

      // Wait for chat interface
      let loginSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.waitForSelector('[data-testid="chat-input"], textarea[placeholder*="message" i], textarea, .chat-input', {
            timeout: LOGIN_TIMEOUT / 3
          });
          loginSuccess = true;
          console.log('Login successful!');
          break;
        } catch (e) {
          console.log(`Login attempt ${attempt + 1} timed out, retrying...`);
          await page.screenshot({ path: `e2e/screenshots/codemode-login-attempt-${attempt + 1}.png` });
          await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
            if (btn) btn.click();
          });
        }
      }
      if (!loginSuccess) throw new Error('Login failed after 3 attempts');
    } else {
      await expect(chatInput.first()).toBeVisible({ timeout: LOGIN_TIMEOUT });
    }

    // Dismiss onboarding modal
    await page.waitForTimeout(1000);
    for (let i = 0; i < 3; i++) {
      const skipButton = page.locator('button:has-text("Skip")').first();
      const closeButton = page.locator('button[aria-label="Close"], button:has-text("×"), .modal-close').first();

      const hasSkip = await skipButton.isVisible({ timeout: 1000 }).catch(() => false);
      const hasClose = await closeButton.isVisible({ timeout: 500 }).catch(() => false);

      if (hasSkip) {
        console.log('Dismissing onboarding modal via Skip...');
        await skipButton.click();
        await page.waitForTimeout(500);
      } else if (hasClose) {
        console.log('Dismissing modal via close button...');
        await closeButton.click();
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }
  }

  /**
   * Navigate to Code Mode - click on >_Code button
   */
  async function goToCodeMode(page: Page) {
    console.log('Looking for >_Code button...');

    // Find and click the Code button (>_Code)
    const codeButton = page.locator('button:has-text(">_Code"), button:has-text("Code"), [data-testid="code-mode-button"]').first();
    await codeButton.waitFor({ timeout: 10000 });
    console.log('Found Code button, clicking...');
    await codeButton.click();
    await page.waitForTimeout(3000);

    // Dismiss any modals that appear in Code Mode
    for (let i = 0; i < 3; i++) {
      const skipButton = page.locator('button:has-text("Skip")').first();
      const closeButton = page.locator('button[aria-label="Close"], button:has-text("×")').first();

      if (await skipButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('Dismissing modal via Skip...');
        await skipButton.click();
        await page.waitForTimeout(500);
      } else if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log('Dismissing modal via close...');
        await closeButton.click();
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }

    // Wait for Code Mode input
    await page.waitForSelector('textarea', { timeout: 10000 });
    console.log('Code Mode loaded!');
  }

  /**
   * Send a message in Code Mode
   */
  async function sendCodeModeMessage(page: Page, message: string) {
    console.log(`Sending: "${message.substring(0, 80)}..."`);

    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill(message);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }

  test('should create Go application with proper agentic display', async ({ page }) => {
    await loginAsLocalAdmin(page);
    await goToCodeMode(page);

    const prompt = `Create a complete golang REST API for a todo list application with:
- In-memory storage
- CRUD endpoints (GET /todos, POST /todos, PUT /todos/:id, DELETE /todos/:id)
- Health check endpoint at /health
- Proper error handling
- A runnable main.go on port 8080

Create all files needed. This should be a complete, working application.`;

    await sendCodeModeMessage(page, prompt);

    // Monitor for 4 minutes, checking for duplication
    let duplicateCount = 0;
    let thinkingLeakedToText = false;

    for (let i = 0; i < 48; i++) { // 48 * 5s = 4 minutes
      await page.waitForTimeout(5000);

      // Get all page text
      const bodyText = await page.textContent('body') || '';

      // Check for thinking content appearing outside thinking block
      // Look for common thinking phrases that shouldn't appear in main content
      const thinkingPhrases = ['user wants to', 'I need to', 'Let me think about', 'First, I should'];
      for (const phrase of thinkingPhrases) {
        const regex = new RegExp(phrase, 'gi');
        const matches = bodyText.match(regex) || [];
        if (matches.length > 2) {
          console.log(`WARNING: "${phrase}" appears ${matches.length} times - possible duplication`);
          duplicateCount++;
        }
      }

      // Count tool blocks
      const toolBlocks = await page.locator('[data-testid="inline-tool-block"]').count();

      // Check for completion indicators
      const hasMainGo = bodyText.includes('main.go');
      const hasComplete = bodyText.toLowerCase().includes('complete') || bodyText.toLowerCase().includes('created');

      console.log(`[${i * 5}s] Tools: ${toolBlocks}, HasMain: ${hasMainGo}, Complete: ${hasComplete}, Duplicates: ${duplicateCount}`);

      if (hasMainGo && toolBlocks > 0 && hasComplete) {
        console.log('Task appears complete!');
        break;
      }
    }

    // Take final screenshot
    await page.screenshot({ path: 'e2e/screenshots/codemode-final.png', fullPage: true });

    // Assert no significant duplication
    expect(duplicateCount).toBeLessThan(5);
  });

  test('should create complex Rust CLI application', async ({ page }) => {
    await loginAsLocalAdmin(page);
    await goToCodeMode(page);

    const prompt = `Create a complete Rust CLI application that:
1. Parses command line arguments using clap
2. Fetches weather data from a mock API (just simulate the response)
3. Displays the weather in a formatted table using prettytable-rs
4. Has proper error handling with thiserror
5. Includes a Cargo.toml with all dependencies
6. Has multiple modules (main.rs, weather.rs, display.rs)

Create ALL files needed. Make it complete and runnable.`;

    await sendCodeModeMessage(page, prompt);

    // Monitor for 4 minutes
    let duplicateCount = 0;

    for (let i = 0; i < 48; i++) {
      await page.waitForTimeout(5000);

      const bodyText = await page.textContent('body') || '';

      // Check for duplication
      const thinkingPhrases = ['user wants to', 'I need to create', 'Let me think'];
      for (const phrase of thinkingPhrases) {
        const matches = bodyText.match(new RegExp(phrase, 'gi')) || [];
        if (matches.length > 2) {
          console.log(`WARNING: "${phrase}" appears ${matches.length} times`);
          duplicateCount++;
        }
      }

      const toolBlocks = await page.locator('[data-testid="inline-tool-block"]').count();
      const hasCargoToml = bodyText.includes('Cargo.toml');
      const hasMainRs = bodyText.includes('main.rs');

      console.log(`[${i * 5}s] Tools: ${toolBlocks}, Cargo: ${hasCargoToml}, Main: ${hasMainRs}, Dups: ${duplicateCount}`);

      if (hasCargoToml && hasMainRs && toolBlocks > 2) {
        console.log('Rust app appears complete!');
        break;
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/codemode-rust.png', fullPage: true });
    expect(duplicateCount).toBeLessThan(5);
  });
});
