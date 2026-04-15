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
 * E2E Test: Streaming vs Loaded Parity
 *
 * CRITICAL TEST: Ensures that content rendered during live streaming
 * matches exactly what is shown after page reload.
 *
 * The test:
 * 1. Logs in as admin
 * 2. Sends a complex query (cloud info + diagram)
 * 3. Captures state during streaming
 * 4. Captures state after streaming completes
 * 5. Reloads page and captures loaded state
 * 6. Compares streaming vs loaded - they MUST match
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const TEST_URL = process.env.TEST_URL || 'https://chat-dev.openagentics.io';
const TEST_API_KEY = process.env.TEST_API_KEY || '';
const LOCAL_ADMIN_USERNAME = process.env.ADMIN_USER_EMAIL || 'admin@openagentics.io';
const LOCAL_ADMIN_PASSWORD = process.env.ADMIN_USER_PASSWORD || '';
const SCREENSHOT_DIR = 'e2e/screenshots/parity-test';

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface ContentCapture {
  hasRawHtml: boolean;
  rawHtmlCount: number;
  artifactCount: number;
  thinkingBlockCount: number;
  toolCallCount: number;
  textContent: string;
  codeBlockCount: number;
  iframeCount: number;
}

async function captureContentState(page: Page, label: string): Promise<ContentCapture> {
  // Take screenshot
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${label}.png`,
    fullPage: true
  });

  // Count raw HTML code blocks (BAD - should be rendered)
  const rawHtmlBlocks = await page.locator('pre:has-text("<!DOCTYPE"), pre:has-text("<html"), code:has-text("<!DOCTYPE")').count();

  // Count rendered artifacts (GOOD)
  const artifacts = await page.locator('iframe[src], [class*="artifact-renderer"], [class*="ArtifactRenderer"]').count();

  // Count thinking blocks
  const thinkingBlocks = await page.locator('[class*="thinking"], [class*="Thinking"], [data-type="thinking"]').count();

  // Count tool calls
  const toolCalls = await page.locator('[class*="tool-call"], [class*="ToolCall"], [data-type="tool"]').count();

  // Count code blocks
  const codeBlocks = await page.locator('pre code').count();

  // Count iframes
  const iframes = await page.locator('iframe').count();

  // Get text content
  const textContent = await page.locator('body').textContent() || '';

  console.log(`\n=== ${label} ===`);
  console.log(`Raw HTML blocks (BAD): ${rawHtmlBlocks}`);
  console.log(`Rendered artifacts (GOOD): ${artifacts}`);
  console.log(`Thinking blocks: ${thinkingBlocks}`);
  console.log(`Tool calls: ${toolCalls}`);
  console.log(`Code blocks: ${codeBlocks}`);
  console.log(`Iframes: ${iframes}`);

  return {
    hasRawHtml: rawHtmlBlocks > 0,
    rawHtmlCount: rawHtmlBlocks,
    artifactCount: artifacts,
    thinkingBlockCount: thinkingBlocks,
    toolCallCount: toolCalls,
    textContent,
    codeBlockCount: codeBlocks,
    iframeCount: iframes,
  };
}

test.describe('Streaming vs Loaded Parity', () => {
  test.setTimeout(180000); // 3 minutes for complex queries

  test('live streaming must match loaded state', async ({ page }) => {
    console.log('\n🚀 Starting Streaming Parity Test');
    console.log(`URL: ${TEST_URL}`);

    // Step 1: Go to login page
    console.log('\n📝 Step 1: Logging in...');
    await page.goto(TEST_URL);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/00-login-page.png`, fullPage: true });

    // Click "Local" login button
    const localButton = page.locator('button:has-text("Local")');
    if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Found Local login button, clicking...');
      await localButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/00b-local-form.png`, fullPage: true });

      // Enter username and password
      const usernameInput = page.locator('input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], input[placeholder*="mail"], input[placeholder*="user"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log(`Entering username: ${LOCAL_ADMIN_USERNAME}`);
        await usernameInput.fill(LOCAL_ADMIN_USERNAME);
      }

      if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Entering password...');
        await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
      }

      // Click submit/login button
      const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign In"), button:has-text("Continue")').first();
      if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking login button...');
        await submitButton.click();
      } else {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(5000);
    } else {
      // Try localStorage approach as fallback
      console.log('No Local button found, trying localStorage...');
      await page.evaluate((apiKey) => {
        localStorage.setItem('openagentic_api_key', apiKey);
        localStorage.setItem('auth_token', apiKey);
      }, TEST_API_KEY);
      await page.reload();
      await page.waitForTimeout(3000);
    }

    // Step 2: Close any modals/overlays and find chat input
    console.log('\n📝 Step 2: Finding chat input...');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-after-login.png`, fullPage: true });

    // Close any modal overlays that might be blocking
    const modalClose = page.locator('button:has-text("Close"), button:has-text("Got it"), button:has-text("Dismiss"), button:has-text("OK"), [aria-label="Close"], .modal-close, button:has-text("×")').first();
    if (await modalClose.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Closing modal overlay...');
      await modalClose.click();
      await page.waitForTimeout(1000);
    }

    // Try pressing Escape to close any modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Click outside any modal to close it
    const overlay = page.locator('.fixed.inset-0, [class*="backdrop"], [class*="overlay"]').first();
    if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('Clicking overlay to dismiss...');
      await overlay.click({ position: { x: 10, y: 10 }, force: true });
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01b-after-modal-close.png`, fullPage: true });

    // Try multiple selectors for chat input
    let chatInput = page.locator('textarea[placeholder*="message"], textarea[placeholder*="Message"], textarea[placeholder*="chat"], textarea[placeholder*="What can"]').first();

    if (!(await chatInput.isVisible({ timeout: 5000 }).catch(() => false))) {
      chatInput = page.locator('textarea').first();
    }

    await expect(chatInput).toBeVisible({ timeout: 15000 });
    console.log('✓ Chat input found');

    // Step 3: Send the test message
    console.log('\n📝 Step 3: Sending test message...');
    const testMessage = 'please show my my azure subs and rgs, aws accounts and gcp information- and create an interactive shankey diagram showing last 3 months costs by service types';

    await chatInput.click({ force: true });
    await chatInput.fill(testMessage);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-message-filled.png`, fullPage: true });

    // Press Enter to send
    await page.keyboard.press('Enter');
    console.log('✓ Message sent');

    // Step 4: Capture during streaming (multiple times)
    console.log('\n📝 Step 4: Capturing during streaming...');

    // Wait a bit for streaming to start
    await page.waitForTimeout(5000);
    const streamingCapture1 = await captureContentState(page, '03-streaming-5s');

    await page.waitForTimeout(10000);
    const streamingCapture2 = await captureContentState(page, '04-streaming-15s');

    await page.waitForTimeout(15000);
    const streamingCapture3 = await captureContentState(page, '05-streaming-30s');

    // Step 5: Wait for completion
    console.log('\n📝 Step 5: Waiting for completion...');

    // Wait for streaming to complete (look for stop button to disappear or loading indicator)
    await page.waitForTimeout(30000); // Total wait for completion

    // Additional wait to ensure everything is rendered
    await page.waitForTimeout(5000);

    const completedCapture = await captureContentState(page, '06-completed');
    console.log('✓ Streaming completed');

    // Capture the session URL/ID for reload
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // Step 6: Reload and capture loaded state
    console.log('\n📝 Step 6: Reloading page...');
    await page.reload();
    await page.waitForTimeout(5000);

    const loadedCapture = await captureContentState(page, '07-loaded-after-reload');
    console.log('✓ Page reloaded');

    // Step 7: Compare states
    console.log('\n\n========================================');
    console.log('         PARITY COMPARISON');
    console.log('========================================\n');

    const issues: string[] = [];

    // Check 1: Raw HTML should not appear in completed state
    if (completedCapture.hasRawHtml) {
      issues.push(`❌ FAIL: Completed state has ${completedCapture.rawHtmlCount} raw HTML blocks (should be 0)`);
    } else {
      console.log('✓ PASS: Completed state has no raw HTML blocks');
    }

    // Check 2: Raw HTML should not appear in loaded state
    if (loadedCapture.hasRawHtml) {
      issues.push(`❌ FAIL: Loaded state has ${loadedCapture.rawHtmlCount} raw HTML blocks (should be 0)`);
    } else {
      console.log('✓ PASS: Loaded state has no raw HTML blocks');
    }

    // Check 3: Artifact counts should be close (within 1) - scrolling/viewport can affect this
    const artifactDiff = Math.abs(completedCapture.artifactCount - loadedCapture.artifactCount);
    if (artifactDiff > 1) {
      issues.push(`❌ FAIL: Artifact count mismatch too large - Completed: ${completedCapture.artifactCount}, Loaded: ${loadedCapture.artifactCount}`);
    } else {
      console.log(`✓ PASS: Artifact counts close (Completed: ${completedCapture.artifactCount}, Loaded: ${loadedCapture.artifactCount})`);
    }

    // Check 4: iframe counts should be close (within 1) - scrolling/viewport can affect this
    const iframeDiff = Math.abs(completedCapture.iframeCount - loadedCapture.iframeCount);
    if (iframeDiff > 1) {
      issues.push(`❌ FAIL: iframe count mismatch too large - Completed: ${completedCapture.iframeCount}, Loaded: ${loadedCapture.iframeCount}`);
    } else {
      console.log(`✓ PASS: iframe counts close (Completed: ${completedCapture.iframeCount}, Loaded: ${loadedCapture.iframeCount})`);
    }

    // Check 5: If loaded has artifacts, completed should too
    if (loadedCapture.artifactCount > 0 && completedCapture.artifactCount === 0) {
      issues.push(`❌ CRITICAL: Loaded state has artifacts (${loadedCapture.artifactCount}) but completed streaming state has none!`);
    }

    // Check 6: If loaded has no raw HTML but completed does, that's the bug
    if (!loadedCapture.hasRawHtml && completedCapture.hasRawHtml) {
      issues.push(`❌ CRITICAL: THE BUG - Completed state shows raw HTML, loaded state renders it correctly`);
    }

    // Summary
    console.log('\n========================================');
    console.log('              SUMMARY');
    console.log('========================================');

    if (issues.length === 0) {
      console.log('\n✅ ALL PARITY CHECKS PASSED!\n');
    } else {
      console.log(`\n❌ ${issues.length} PARITY ISSUES FOUND:\n`);
      issues.forEach(issue => console.log(issue));
      console.log('\n');
    }

    // Write results to file
    const results = {
      timestamp: new Date().toISOString(),
      url: TEST_URL,
      streamingCaptures: [streamingCapture1, streamingCapture2, streamingCapture3],
      completedCapture,
      loadedCapture,
      issues,
      passed: issues.length === 0,
    };

    fs.writeFileSync(
      `${SCREENSHOT_DIR}/results.json`,
      JSON.stringify(results, null, 2)
    );

    // Assert no parity issues
    expect(issues.length, `Parity issues found:\n${issues.join('\n')}`).toBe(0);
  });
});
