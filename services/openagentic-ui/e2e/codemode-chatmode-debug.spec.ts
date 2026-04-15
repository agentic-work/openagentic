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
 * E2E Debug Tests: Code Mode Streaming & Chat Mode Duplication
 *
 * These tests diagnose specific issues:
 * 1. Code Mode: API is streaming but content not appearing in UI
 * 2. Chat Mode: Content duplication during streaming
 *
 * Run with:
 *   cd services/openagentic-ui
 *   AZURE_CLIENT_ID=<client-id> \
 *   AZURE_CLIENT_SECRET=<client-secret> \
 *   npx playwright test e2e/codemode-chatmode-debug.spec.ts --headed
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

// Azure AD credentials for Microsoft login — must be set via env
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';

// Local admin fallback
const LOCAL_ADMIN_EMAIL = 'localadmin@openagentic.local';
const LOCAL_ADMIN_PASSWORD = 'admin123';

// Target URL
const BASE_URL = 'https://chat-dev.openagentics.io';

// Timeouts
const LOGIN_TIMEOUT = 60000;
const STREAMING_TIMEOUT = 120000;

test.describe('Code Mode & Chat Mode Debug Tests', () => {
  test.setTimeout(300000); // 5 minutes max per test

  /**
   * Helper: Login via Microsoft Azure AD
   */
  async function loginViaMicrosoft(page: Page) {
    console.log('=== MICROSOFT LOGIN ===');
    console.log('Navigating to', BASE_URL);
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // Take initial screenshot
    await page.screenshot({ path: 'e2e/screenshots/debug-01-initial.png', fullPage: true });

    // Check if already logged in
    const chatInput = page.locator('textarea[placeholder*="message" i], textarea').first();
    const alreadyLoggedIn = await chatInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (alreadyLoggedIn) {
      console.log('Already logged in!');
      return;
    }

    // Look for Microsoft login button
    const microsoftButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft"), button[aria-label*="Microsoft"]').first();
    const hasMicrosoftButton = await microsoftButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasMicrosoftButton) {
      console.log('Clicking Microsoft login button...');
      await microsoftButton.click();
      await page.waitForTimeout(3000);

      // Handle Microsoft login flow
      // This may redirect to Microsoft login page
      const currentUrl = page.url();
      console.log('Current URL after Microsoft click:', currentUrl);

      if (currentUrl.includes('login.microsoftonline.com') || currentUrl.includes('microsoft')) {
        console.log('On Microsoft login page, entering credentials...');

        // Enter email
        const emailInput = page.locator('input[type="email"], input[name="loginfmt"]').first();
        await emailInput.waitFor({ timeout: 10000 });
        await emailInput.fill('localadmin@openagentic.local'); // Use configured admin email
        await page.click('input[type="submit"], button[type="submit"]');
        await page.waitForTimeout(2000);

        // Enter password if prompted
        const passwordInput = page.locator('input[type="password"], input[name="passwd"]').first();
        const hasPassword = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (hasPassword) {
          await passwordInput.fill(LOCAL_ADMIN_PASSWORD);
          await page.click('input[type="submit"], button[type="submit"]');
          await page.waitForTimeout(3000);
        }

        // Handle "Stay signed in?" prompt
        const noButton = page.locator('input[value="No"], button:has-text("No")').first();
        const hasNoButton = await noButton.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasNoButton) {
          await noButton.click();
          await page.waitForTimeout(2000);
        }
      }
    } else {
      // Fall back to Local login
      console.log('Microsoft button not found, trying Local login...');
      await loginAsLocalAdmin(page);
      return;
    }

    // Wait for redirect back to app and chat to load
    await page.waitForURL(url => url.toString().includes(BASE_URL.replace('https://', '')), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Verify logged in
    const chatInputAfterLogin = page.locator('textarea').first();
    await expect(chatInputAfterLogin).toBeVisible({ timeout: LOGIN_TIMEOUT });

    // Dismiss any onboarding modals
    await dismissModals(page);

    console.log('Login complete!');
    await page.screenshot({ path: 'e2e/screenshots/debug-02-logged-in.png', fullPage: true });
  }

  /**
   * Helper: Login as local admin (fallback)
   */
  async function loginAsLocalAdmin(page: Page) {
    console.log('=== LOCAL ADMIN LOGIN ===');

    // Look for Local button
    const localButton = page.locator('button:has-text("Local")').first();
    const hasLocalButton = await localButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasLocalButton) {
      await localButton.click();
      await page.waitForTimeout(1000);
    }

    // Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    const hasForm = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasForm) {
      await emailInput.fill(LOCAL_ADMIN_EMAIL);
      await passwordInput.fill(LOCAL_ADMIN_PASSWORD);

      // Click submit
      await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (btn) btn.click();
      });

      await page.waitForTimeout(2000);
    }

    // Wait for chat interface
    await page.waitForSelector('textarea', { timeout: LOGIN_TIMEOUT });

    // Dismiss modals
    await dismissModals(page);
  }

  /**
   * Helper: Dismiss onboarding/welcome modals
   */
  async function dismissModals(page: Page) {
    await page.waitForTimeout(1000);
    for (let i = 0; i < 3; i++) {
      const skipButton = page.locator('button:has-text("Skip")').first();
      const closeButton = page.locator('button[aria-label="Close"], button:has-text("×")').first();

      if (await skipButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await skipButton.click();
        await page.waitForTimeout(500);
      } else if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeButton.click();
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }
  }

  /**
   * Helper: Send message in current mode
   */
  async function sendMessage(page: Page, message: string) {
    console.log(`Sending message: "${message.substring(0, 80)}..."`);

    const textarea = page.locator('textarea').first();
    await textarea.fill(message);
    await textarea.press('Enter');
    await page.waitForTimeout(1000);
  }

  /**
   * TEST 1: Code Mode Streaming Debug
   *
   * This test investigates why API streams data but UI doesn't display it.
   * We'll capture:
   * - WebSocket messages
   * - Console logs
   * - Network requests
   * - DOM changes
   */
  test('DEBUG: Code Mode streaming - diagnose why content not appearing', async ({ page, context }) => {
    // Enable detailed logging
    const logs: string[] = [];
    const wsMessages: { direction: string; data: string }[] = [];
    const networkRequests: { url: string; status?: number; method: string }[] = [];

    // Capture console logs
    page.on('console', msg => {
      const text = `[${msg.type()}] ${msg.text()}`;
      logs.push(text);
      if (msg.text().includes('CodeMode') || msg.text().includes('WebSocket') ||
          msg.text().includes('text_block') || msg.text().includes('stream') ||
          msg.text().includes('event') || msg.text().includes('PTY')) {
        console.log('CONSOLE:', text);
      }
    });

    // Capture network requests
    page.on('request', req => {
      const entry = { url: req.url(), method: req.method() };
      networkRequests.push(entry);
      if (req.url().includes('openagentic') || req.url().includes('ws/')) {
        console.log('REQUEST:', req.method(), req.url());
      }
    });

    page.on('response', res => {
      const entry = networkRequests.find(r => r.url === res.url());
      if (entry) entry.status = res.status();
      if (res.url().includes('openagentic') || res.status() >= 400) {
        console.log('RESPONSE:', res.status(), res.url());
      }
    });

    // Setup WebSocket interception via CDP
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', (params) => {
      const data = params.response.payloadData;
      wsMessages.push({ direction: 'received', data });
      console.log('WS RECV:', data.substring(0, 200));
    });

    client.on('Network.webSocketFrameSent', (params) => {
      const data = params.response.payloadData;
      wsMessages.push({ direction: 'sent', data });
      console.log('WS SENT:', data.substring(0, 200));
    });

    // Login
    await loginViaMicrosoft(page);

    // Switch to Code Mode
    console.log('\n=== SWITCHING TO CODE MODE ===');
    const codeModeButton = page.locator('button:has-text("Code"), [data-testid="code-mode"], button[aria-label*="Code" i]').first();

    if (await codeModeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await codeModeButton.click();
      console.log('Clicked Code Mode button');
    } else {
      // Try finding in navigation/sidebar
      const navCode = page.locator('nav >> text=Code, aside >> text=Code').first();
      if (await navCode.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navCode.click();
      }
    }

    // Wait for Code Mode to initialize
    console.log('Waiting for Code Mode session to initialize...');
    await page.waitForTimeout(8000);

    await page.screenshot({ path: 'e2e/screenshots/debug-03-codemode-entered.png', fullPage: true });

    // Check what's visible
    const codeModeIndicators = await page.evaluate(() => {
      return {
        hasCodeModeUI: !!document.querySelector('[class*="CodeMode"], [class*="code-mode"]'),
        hasTextarea: !!document.querySelector('textarea'),
        hasModelBadge: !!document.querySelector('[class*="model-badge"], [class*="ModelBadge"]'),
        visibleText: document.body.innerText.substring(0, 500),
      };
    });
    console.log('Code Mode indicators:', JSON.stringify(codeModeIndicators, null, 2));

    // Send a test message
    console.log('\n=== SENDING TEST MESSAGE ===');
    await sendMessage(page, 'Hello, please respond with a simple greeting and confirm you are working.');

    // Monitor for 30 seconds
    console.log('\n=== MONITORING RESPONSE ===');
    let responseAppeared = false;
    let contentLength = 0;

    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(2500);

      // Get all text content
      const bodyText = await page.evaluate(() => document.body.innerText);
      const newLength = bodyText.length;

      // Check for response indicators
      const hasResponse = bodyText.toLowerCase().includes('hello') ||
                         bodyText.toLowerCase().includes('greeting') ||
                         bodyText.toLowerCase().includes('working') ||
                         bodyText.toLowerCase().includes('assist');

      console.log(`[${(i + 1) * 2.5}s] Content length: ${newLength}, Has response: ${hasResponse}`);

      if (hasResponse && newLength > contentLength + 50) {
        responseAppeared = true;
        console.log('RESPONSE DETECTED!');
      }

      contentLength = newLength;

      if (i % 4 === 0) {
        await page.screenshot({ path: `e2e/screenshots/debug-04-codemode-${i}.png`, fullPage: true });
      }
    }

    // Dump diagnostics
    console.log('\n=== DIAGNOSTICS ===');
    console.log(`Response appeared: ${responseAppeared}`);
    console.log(`WebSocket messages received: ${wsMessages.filter(m => m.direction === 'received').length}`);
    console.log(`WebSocket messages sent: ${wsMessages.filter(m => m.direction === 'sent').length}`);

    // Check for specific events
    const textBlockEvents = wsMessages.filter(m => m.data.includes('text_block') || m.data.includes('text_delta'));
    console.log(`text_block/text_delta events: ${textBlockEvents.length}`);
    if (textBlockEvents.length > 0) {
      console.log('Sample text event:', textBlockEvents[0].data.substring(0, 300));
    }

    // Check for errors
    const errorLogs = logs.filter(l => l.toLowerCase().includes('error'));
    console.log(`Error logs: ${errorLogs.length}`);
    errorLogs.slice(0, 5).forEach(e => console.log('  ', e));

    // Final screenshot
    await page.screenshot({ path: 'e2e/screenshots/debug-05-codemode-final.png', fullPage: true });

    // Write diagnostic report
    const report = {
      timestamp: new Date().toISOString(),
      responseAppeared,
      wsMessagesReceived: wsMessages.filter(m => m.direction === 'received').length,
      wsMessagesSent: wsMessages.filter(m => m.direction === 'sent').length,
      textBlockEvents: textBlockEvents.length,
      errorCount: errorLogs.length,
      sampleLogs: logs.slice(-20),
      sampleWsMessages: wsMessages.slice(-10),
    };

    console.log('\n=== FULL DIAGNOSTIC REPORT ===');
    console.log(JSON.stringify(report, null, 2));

    // The test passes if we can diagnose the issue
    // We don't fail on responseAppeared because the goal is diagnosis
  });

  /**
   * TEST 2: Chat Mode Duplication Debug
   *
   * This test investigates content duplication during streaming.
   * We'll send a unique message and count occurrences.
   */
  test('DEBUG: Chat Mode content duplication - track streaming events', async ({ page, context }) => {
    const streamingEvents: string[] = [];
    const contentSnapshots: { time: number; length: number; text: string }[] = [];

    // Capture console for SSE events
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('SSE') || text.includes('stream') || text.includes('content_block') ||
          text.includes('delta') || text.includes('Event')) {
        streamingEvents.push(`[${msg.type()}] ${text}`);
        console.log('STREAM EVENT:', text.substring(0, 200));
      }
    });

    // Login
    await loginViaMicrosoft(page);

    // Ensure we're in Chat Mode (not Code Mode)
    console.log('\n=== ENSURING CHAT MODE ===');
    const chatModeButton = page.locator('button:has-text("Chat"), [data-testid="chat-mode"]').first();
    if (await chatModeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatModeButton.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'e2e/screenshots/debug-10-chatmode.png', fullPage: true });

    // Send a message with unique markers to detect duplication
    const uniqueId = `MARKER_${Date.now()}`;
    const testMessage = `Please respond with EXACTLY this text and nothing else: "START ${uniqueId} Hello from the test END ${uniqueId}"`;

    console.log('\n=== SENDING UNIQUE MESSAGE ===');
    console.log('Unique ID:', uniqueId);
    await sendMessage(page, testMessage);

    // Monitor streaming and capture content at intervals
    console.log('\n=== MONITORING STREAMING ===');
    const startTime = Date.now();

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);

      const elapsed = Date.now() - startTime;

      // Get message area content
      const messageContent = await page.evaluate(() => {
        // Get all assistant message elements
        const messages = document.querySelectorAll('[data-message-role="assistant"], .assistant-message, [class*="assistant"]');
        let text = '';
        messages.forEach(m => {
          text += m.textContent + '\n---\n';
        });
        return text || document.body.innerText;
      });

      contentSnapshots.push({
        time: elapsed,
        length: messageContent.length,
        text: messageContent.substring(0, 500),
      });

      // Count marker occurrences
      const startCount = (messageContent.match(new RegExp(`START ${uniqueId}`, 'g')) || []).length;
      const endCount = (messageContent.match(new RegExp(`END ${uniqueId}`, 'g')) || []).length;

      console.log(`[${Math.floor(elapsed / 1000)}s] Content length: ${messageContent.length}, START markers: ${startCount}, END markers: ${endCount}`);

      if (startCount > 1 || endCount > 1) {
        console.log('!!! DUPLICATION DETECTED !!!');
        await page.screenshot({ path: `e2e/screenshots/debug-11-duplication-${i}.png`, fullPage: true });
      }

      if (i % 5 === 0) {
        await page.screenshot({ path: `e2e/screenshots/debug-12-chatmode-${i}.png`, fullPage: true });
      }

      // Check if streaming complete
      if (messageContent.includes(`END ${uniqueId}`) && startCount === 1 && endCount === 1) {
        console.log('Response complete with no duplication!');
        break;
      }
    }

    // Final analysis
    console.log('\n=== DUPLICATION ANALYSIS ===');

    const finalContent = await page.evaluate(() => document.body.innerText);
    const finalStartCount = (finalContent.match(new RegExp(`START ${uniqueId}`, 'g')) || []).length;
    const finalEndCount = (finalContent.match(new RegExp(`END ${uniqueId}`, 'g')) || []).length;

    console.log(`Final START marker count: ${finalStartCount}`);
    console.log(`Final END marker count: ${finalEndCount}`);
    console.log(`Streaming events captured: ${streamingEvents.length}`);

    // Check for duplicate patterns in events
    const eventCounts = new Map<string, number>();
    streamingEvents.forEach(e => {
      const key = e.substring(0, 100);
      eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
    });

    const duplicateEvents = Array.from(eventCounts.entries()).filter(([_, count]) => count > 1);
    console.log(`Duplicate event patterns: ${duplicateEvents.length}`);

    // Analyze content growth pattern
    console.log('\n=== CONTENT GROWTH PATTERN ===');
    let previousLength = 0;
    for (const snapshot of contentSnapshots) {
      const growth = snapshot.length - previousLength;
      if (growth < 0) {
        console.log(`[${snapshot.time}ms] LENGTH DECREASED by ${Math.abs(growth)} - REGRESSION!`);
      } else if (growth > 0) {
        console.log(`[${snapshot.time}ms] Length: ${snapshot.length} (+${growth})`);
      }
      previousLength = snapshot.length;
    }

    await page.screenshot({ path: 'e2e/screenshots/debug-13-chatmode-final.png', fullPage: true });

    // Report
    const hasDuplication = finalStartCount > 1 || finalEndCount > 1;
    console.log(`\n=== RESULT: ${hasDuplication ? 'DUPLICATION FOUND' : 'NO DUPLICATION'} ===`);

    // Fail test if duplication found
    expect(finalStartCount).toBeLessThanOrEqual(1);
    expect(finalEndCount).toBeLessThanOrEqual(1);
  });

  /**
   * TEST 3: Complex Code Mode Application Generation
   *
   * Tests the full Code Mode flow with a complex request.
   */
  test('Code Mode: Generate complex golang application', async ({ page, context }) => {
    // Setup logging
    page.on('console', msg => {
      if (msg.text().includes('CodeMode') || msg.text().includes('text_')) {
        console.log('CONSOLE:', msg.text().substring(0, 200));
      }
    });

    // Login
    await loginViaMicrosoft(page);

    // Switch to Code Mode
    console.log('\n=== SWITCHING TO CODE MODE ===');
    const codeModeButton = page.locator('button:has-text("Code")').first();
    await codeModeButton.click().catch(() => {});
    await page.waitForTimeout(8000);

    await page.screenshot({ path: 'e2e/screenshots/debug-20-codemode-ready.png', fullPage: true });

    // Send complex request
    const complexPrompt = `Create a fully working golang application that:
1. Fetches current weather data for Seattle from an API
2. Calculates the average wind speed
3. Compares it to the airspeed velocity of an unladen swallow (about 11 m/s)
4. Prints a fun message about whether the swallow could fly today

Please create all necessary files and explain your approach.`;

    console.log('\n=== SENDING COMPLEX PROMPT ===');
    await sendMessage(page, complexPrompt);

    // Monitor for 3 minutes
    let hasThinking = false;
    let hasToolCalls = false;
    let hasGoCode = false;
    let responseLength = 0;

    for (let i = 0; i < 36; i++) { // 3 minutes
      await page.waitForTimeout(5000);

      const content = await page.evaluate(() => document.body.innerText);

      // Check for expected elements
      if (content.toLowerCase().includes('thinking') || content.includes('Thought')) hasThinking = true;
      if (content.includes('package main') || content.includes('func main')) hasGoCode = true;
      if (content.toLowerCase().includes('tool') || content.toLowerCase().includes('write')) hasToolCalls = true;

      const newLength = content.length;
      console.log(`[${(i + 1) * 5}s] Length: ${newLength}, Thinking: ${hasThinking}, Tools: ${hasToolCalls}, Go: ${hasGoCode}`);

      if (newLength > responseLength) {
        responseLength = newLength;
      }

      if (i % 6 === 0) {
        await page.screenshot({ path: `e2e/screenshots/debug-21-golang-${i}.png`, fullPage: true });
      }

      // Exit early if we have golang code
      if (hasGoCode && responseLength > 3000) {
        console.log('Go code detected, finishing...');
        await page.waitForTimeout(10000);
        break;
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/debug-22-golang-final.png', fullPage: true });

    console.log('\n=== GOLANG TEST RESULTS ===');
    console.log(`Has thinking: ${hasThinking}`);
    console.log(`Has tool calls: ${hasToolCalls}`);
    console.log(`Has Go code: ${hasGoCode}`);
    console.log(`Final length: ${responseLength}`);

    // Should have produced some substantial response
    expect(responseLength).toBeGreaterThan(500);
  });
});
