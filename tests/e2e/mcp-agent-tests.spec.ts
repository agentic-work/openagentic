/**
 * E2E Test: MCP Agent Functionality Tests
 *
 * Tests real-world agent scenarios:
 * - Weather query (requires MCP tools)
 * - Code generation and execution (Golang script)
 *
 * Run with: npx playwright test mcp-agent-tests.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'https://chat.example.com';
const LOCAL_ADMIN_EMAIL = 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD || 'REPLACE_WITH_REAL_TEST_PASSWORD';

// Screenshot directory
const SCREENSHOT_DIR = 'tests/e2e/screenshots/mcp-agent';

// Helper to capture console logs and errors
async function setupConsoleCapture(page: Page) {
  const logs: { type: string; text: string; timestamp: Date }[] = [];

  page.on('console', (msg) => {
    logs.push({ type: msg.type(), text: msg.text(), timestamp: new Date() });
    if (msg.type() === 'error') {
      console.log(`[CONSOLE ERROR]: ${msg.text()}`);
    }
  });

  page.on('pageerror', (error) => {
    console.log(`[PAGE ERROR]: ${error.message}`);
    logs.push({ type: 'pageerror', text: error.message, timestamp: new Date() });
  });

  return logs;
}

// Helper to login as local admin
async function loginAsLocalAdmin(page: Page) {
  console.log('Navigating to login page...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Check for local auth button
  const localAuthButton = page.locator('text=Local Login')
    .or(page.locator('text=local'))
    .or(page.locator('[data-testid="local-auth"]'));

  if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Found local auth button, clicking...');
    await localAuthButton.click();
    await page.waitForTimeout(1000);
  }

  // Fill in credentials
  const emailInput = page.locator('input[type="email"]')
    .or(page.locator('input[name="email"]'))
    .or(page.locator('input[placeholder*="email" i]'));
  const passwordInput = page.locator('input[type="password"]')
    .or(page.locator('input[name="password"]'));

  await emailInput.fill(LOCAL_ADMIN_EMAIL);
  await passwordInput.fill(LOCAL_ADMIN_PASSWORD);

  // Submit login
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.click();

  // Wait for login completion
  await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), {
    timeout: 30000
  });

  console.log('✅ Login successful');
  return true;
}

// Helper to send a chat message and wait for response
async function sendChatMessage(page: Page, message: string, screenshotPrefix: string): Promise<{ success: boolean; responseText: string }> {
  // Find chat input
  const chatInput = page.locator('textarea')
    .or(page.locator('input[placeholder*="message" i]'))
    .or(page.locator('[contenteditable="true"]'));

  const hasChatInput = await chatInput.first().isVisible({ timeout: 10000 }).catch(() => false);
  if (!hasChatInput) {
    console.log('❌ Chat input not found');
    return { success: false, responseText: '' };
  }

  // Type message
  console.log(`Sending message: "${message}"`);
  await chatInput.first().fill(message);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${screenshotPrefix}-01-typed.png`, fullPage: true });

  // Find and click send button or press Enter
  const sendButton = page.locator('button[aria-label*="Send" i]')
    .or(page.locator('button:has-text("Send")'))
    .or(page.locator('button[type="submit"]'));

  if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await sendButton.first().click();
  } else {
    await chatInput.first().press('Enter');
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/${screenshotPrefix}-02-sent.png`, fullPage: true });

  // Wait for response - look for streaming content or completion
  console.log('Waiting for AI response...');

  // Wait for thinking/processing indicator to appear and then disappear
  const thinkingIndicator = page.locator('[class*="thinking"]')
    .or(page.locator('[class*="loading"]'))
    .or(page.locator('.animate-spin'))
    .or(page.locator('text=thinking'));

  // Wait up to 60 seconds for response
  const startTime = Date.now();
  const maxWaitTime = 120000; // 2 minutes for complex queries
  let responseCompleted = false;

  while (Date.now() - startTime < maxWaitTime && !responseCompleted) {
    await page.waitForTimeout(2000);

    // Check if thinking indicator is gone and we have a response
    const isThinking = await thinkingIndicator.first().isVisible({ timeout: 500 }).catch(() => false);

    if (!isThinking) {
      // Look for assistant message
      const assistantMessages = page.locator('[data-role="assistant"]')
        .or(page.locator('.assistant-message'))
        .or(page.locator('[class*="assistant"]'));

      const messageCount = await assistantMessages.count();
      if (messageCount > 0) {
        // Check if the last message has content (not empty)
        const lastMessage = assistantMessages.last();
        const content = await lastMessage.textContent();
        if (content && content.trim().length > 10) {
          responseCompleted = true;
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  Waiting... ${elapsed}s (thinking: ${isThinking})`);
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/${screenshotPrefix}-03-response.png`, fullPage: true });

  // Get the response text
  const assistantMessages = page.locator('[data-role="assistant"]')
    .or(page.locator('.assistant-message'))
    .or(page.locator('[class*="assistant"]'));

  let responseText = '';
  const messageCount = await assistantMessages.count();
  if (messageCount > 0) {
    responseText = await assistantMessages.last().textContent() || '';
  }

  console.log(`Response received (${responseText.length} chars)`);
  console.log(`Response preview: ${responseText.substring(0, 200)}...`);

  return { success: responseCompleted, responseText };
}

test.describe('MCP Agent Functionality Tests', () => {

  test.setTimeout(300000); // 5 minute timeout for complex agent tasks

  test('Test 1: Weather Query - "What is the weather like in Juneau AK right now"', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);

    console.log('\n' + '='.repeat(70));
    console.log('TEST: WEATHER QUERY');
    console.log('Query: "What is the weather like in Juneau AK right now"');
    console.log('='.repeat(70));

    // ========================================================================
    // SECTION 1: LOGIN
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN ===');
    await loginAsLocalAdmin(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/weather-00-logged-in.png`, fullPage: true });

    // Wait for chat interface to load
    await page.waitForTimeout(3000);

    // ========================================================================
    // SECTION 2: START NEW CHAT (if possible)
    // ========================================================================
    console.log('\n=== SECTION 2: START NEW CHAT ===');

    // Try to start a new chat to avoid context pollution
    const newChatButton = page.locator('button:has-text("New Chat")')
      .or(page.locator('[aria-label*="New" i]'))
      .or(page.locator('button:has(svg.lucide-plus)'));

    if (await newChatButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Starting new chat...');
      await newChatButton.first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/weather-01-new-chat.png`, fullPage: true });

    // ========================================================================
    // SECTION 3: SEND WEATHER QUERY
    // ========================================================================
    console.log('\n=== SECTION 3: SEND WEATHER QUERY ===');

    const weatherQuery = 'What is the weather like in Juneau AK right now?';
    const { success, responseText } = await sendChatMessage(page, weatherQuery, 'weather');

    // ========================================================================
    // SECTION 4: ANALYZE RESPONSE
    // ========================================================================
    console.log('\n=== SECTION 4: ANALYZE RESPONSE ===');

    // Check for expected weather-related content
    const weatherKeywords = [
      'temperature', 'degrees', '°F', '°C',
      'weather', 'forecast', 'conditions',
      'Juneau', 'Alaska',
      'rain', 'snow', 'cloudy', 'sunny', 'clear', 'overcast',
      'wind', 'humidity'
    ];

    const foundKeywords = weatherKeywords.filter(kw =>
      responseText.toLowerCase().includes(kw.toLowerCase())
    );

    console.log(`Found weather keywords: ${foundKeywords.join(', ')}`);

    // Check for MCP tool usage indicators in UI
    const mcpIndicator = page.locator('[class*="mcp"]')
      .or(page.locator('[class*="tool"]'))
      .or(page.locator('text=fetching'))
      .or(page.locator('text=weather'));

    const hasMcpIndicator = await mcpIndicator.first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`MCP/Tool indicator visible: ${hasMcpIndicator ? '✅' : '❌'}`);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/weather-04-final.png`, fullPage: true });

    // ========================================================================
    // SECTION 5: CHECK FOR ERRORS
    // ========================================================================
    console.log('\n=== SECTION 5: CHECK FOR ERRORS ===');

    const consoleErrors = consoleLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
    console.log(`Console errors: ${consoleErrors.length}`);

    // Check for failover notification
    const failoverLogs = consoleLogs.filter(l =>
      l.text.includes('failover') || l.text.includes('FAILOVER')
    );
    if (failoverLogs.length > 0) {
      console.log('⚠️ Provider failover detected:');
      failoverLogs.forEach(log => console.log(`  - ${log.text.substring(0, 200)}`));
    }

    // ========================================================================
    // TEST SUMMARY
    // ========================================================================
    console.log('\n=== TEST SUMMARY ===');
    console.log(`  Response received: ${success ? '✅' : '❌'}`);
    console.log(`  Response length: ${responseText.length} chars`);
    console.log(`  Weather keywords found: ${foundKeywords.length}/${weatherKeywords.length}`);
    console.log(`  Console errors: ${consoleErrors.length === 0 ? '✅ None' : `❌ ${consoleErrors.length}`}`);

    // Assertions
    expect(success).toBe(true);
    expect(responseText.length).toBeGreaterThan(50);
    expect(foundKeywords.length).toBeGreaterThan(2);
  });

  test('Test 2: Golang Script - "Show me a complex Golang script and run it"', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);

    console.log('\n' + '='.repeat(70));
    console.log('TEST: GOLANG SCRIPT GENERATION AND EXECUTION');
    console.log('Query: "Show me a complex Golang script and run it and show me while you run it"');
    console.log('='.repeat(70));

    // ========================================================================
    // SECTION 1: LOGIN
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN ===');
    await loginAsLocalAdmin(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/golang-00-logged-in.png`, fullPage: true });

    // Wait for chat interface to load
    await page.waitForTimeout(3000);

    // ========================================================================
    // SECTION 2: START NEW CHAT
    // ========================================================================
    console.log('\n=== SECTION 2: START NEW CHAT ===');

    const newChatButton = page.locator('button:has-text("New Chat")')
      .or(page.locator('[aria-label*="New" i]'))
      .or(page.locator('button:has(svg.lucide-plus)'));

    if (await newChatButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Starting new chat...');
      await newChatButton.first().click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/golang-01-new-chat.png`, fullPage: true });

    // ========================================================================
    // SECTION 3: SEND GOLANG QUERY
    // ========================================================================
    console.log('\n=== SECTION 3: SEND GOLANG QUERY ===');

    const golangQuery = 'Show me a complex Golang script and run it and show me while you run it';
    const { success, responseText } = await sendChatMessage(page, golangQuery, 'golang');

    // ========================================================================
    // SECTION 4: ANALYZE RESPONSE
    // ========================================================================
    console.log('\n=== SECTION 4: ANALYZE RESPONSE ===');

    // Check for expected Golang-related content
    const golangKeywords = [
      'package', 'func', 'main',
      'import', 'fmt', 'go',
      'golang', 'Go',
      'struct', 'interface',
      'goroutine', 'channel',
      'defer', 'return'
    ];

    const foundKeywords = golangKeywords.filter(kw =>
      responseText.includes(kw)
    );

    console.log(`Found Golang keywords: ${foundKeywords.join(', ')}`);

    // Check for code block in response
    const hasCodeBlock = responseText.includes('```') ||
                         responseText.includes('package main') ||
                         responseText.includes('func main');
    console.log(`Has code block: ${hasCodeBlock ? '✅' : '❌'}`);

    // Check for execution output indicators
    const executionIndicators = [
      'output', 'result', 'executing', 'running',
      'success', 'completed', 'returned'
    ];

    const foundExecutionIndicators = executionIndicators.filter(kw =>
      responseText.toLowerCase().includes(kw.toLowerCase())
    );
    console.log(`Found execution indicators: ${foundExecutionIndicators.join(', ')}`);

    // Check for tool call indicators (code execution)
    const toolIndicator = page.locator('[class*="tool"]')
      .or(page.locator('[class*="mcp"]'))
      .or(page.locator('text=Executing'))
      .or(page.locator('text=Running'));

    const hasToolIndicator = await toolIndicator.first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Tool/Execution indicator visible: ${hasToolIndicator ? '✅' : '❌'}`);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/golang-04-final.png`, fullPage: true });

    // ========================================================================
    // SECTION 5: CHECK FOR CODE EXECUTION OUTPUT
    // ========================================================================
    console.log('\n=== SECTION 5: CHECK FOR CODE EXECUTION OUTPUT ===');

    // Look for output/result sections in the response
    const outputSection = page.locator('text=Output')
      .or(page.locator('text=Result'))
      .or(page.locator('[class*="output"]'));

    const hasOutputSection = await outputSection.first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Output section visible: ${hasOutputSection ? '✅' : '❌'}`);

    // ========================================================================
    // SECTION 6: CHECK FOR ERRORS
    // ========================================================================
    console.log('\n=== SECTION 6: CHECK FOR ERRORS ===');

    const consoleErrors = consoleLogs.filter(l => l.type === 'error' || l.type === 'pageerror');
    console.log(`Console errors: ${consoleErrors.length}`);

    // Check for failover notification
    const failoverLogs = consoleLogs.filter(l =>
      l.text.includes('failover') || l.text.includes('FAILOVER')
    );
    if (failoverLogs.length > 0) {
      console.log('⚠️ Provider failover detected:');
      failoverLogs.forEach(log => console.log(`  - ${log.text.substring(0, 200)}`));
    }

    // ========================================================================
    // TEST SUMMARY
    // ========================================================================
    console.log('\n=== TEST SUMMARY ===');
    console.log(`  Response received: ${success ? '✅' : '❌'}`);
    console.log(`  Response length: ${responseText.length} chars`);
    console.log(`  Has code block: ${hasCodeBlock ? '✅' : '❌'}`);
    console.log(`  Golang keywords found: ${foundKeywords.length}/${golangKeywords.length}`);
    console.log(`  Execution indicators: ${foundExecutionIndicators.length > 0 ? '✅' : '❌'}`);
    console.log(`  Console errors: ${consoleErrors.length === 0 ? '✅ None' : `❌ ${consoleErrors.length}`}`);

    // Assertions
    expect(success).toBe(true);
    expect(responseText.length).toBeGreaterThan(100);
    expect(hasCodeBlock).toBe(true);
    expect(foundKeywords.length).toBeGreaterThan(3);
  });

  test('Test 3: Provider Failover Notification Check', async ({ page }) => {
    const consoleLogs = await setupConsoleCapture(page);

    console.log('\n' + '='.repeat(70));
    console.log('TEST: PROVIDER FAILOVER NOTIFICATION');
    console.log('Checking that failover notifications are emitted when providers fail');
    console.log('='.repeat(70));

    // ========================================================================
    // SECTION 1: LOGIN
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN ===');
    await loginAsLocalAdmin(page);

    // Wait for chat interface to load
    await page.waitForTimeout(3000);

    // ========================================================================
    // SECTION 2: CAPTURE SSE EVENTS
    // ========================================================================
    console.log('\n=== SECTION 2: SETUP SSE EVENT MONITORING ===');

    // Intercept network requests to capture SSE events
    const sseEvents: string[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/chat') && response.headers()['content-type']?.includes('text/event-stream')) {
        console.log(`SSE stream detected: ${url}`);
        // Note: Can't easily capture SSE body in Playwright, but we log the presence
        sseEvents.push(`SSE stream opened: ${url}`);
      }
    });

    // ========================================================================
    // SECTION 3: SEND A QUERY
    // ========================================================================
    console.log('\n=== SECTION 3: SEND QUERY ===');

    const newChatButton = page.locator('button:has-text("New Chat")')
      .or(page.locator('[aria-label*="New" i]'));

    if (await newChatButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await newChatButton.first().click();
      await page.waitForTimeout(2000);
    }

    const testQuery = 'Hello, please respond with a short greeting.';
    const { success, responseText } = await sendChatMessage(page, testQuery, 'failover-test');

    // ========================================================================
    // SECTION 4: CHECK FOR FAILOVER INDICATORS
    // ========================================================================
    console.log('\n=== SECTION 4: CHECK FOR FAILOVER INDICATORS ===');

    // Check console logs for failover-related messages
    const failoverLogs = consoleLogs.filter(l =>
      l.text.toLowerCase().includes('failover') ||
      l.text.toLowerCase().includes('provider_failover') ||
      l.text.toLowerCase().includes('switching') ||
      l.text.toLowerCase().includes('failed')
    );

    console.log(`Failover-related console logs: ${failoverLogs.length}`);
    failoverLogs.forEach((log, i) => {
      console.log(`  ${i + 1}. [${log.type}] ${log.text.substring(0, 200)}`);
    });

    // Check UI for failover notification
    const failoverNotification = page.locator('text=failover')
      .or(page.locator('text=switching provider'))
      .or(page.locator('text=Primary provider'))
      .or(page.locator('[class*="warning"]'));

    const hasFailoverUI = await failoverNotification.first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Failover notification in UI: ${hasFailoverUI ? '✅ YES' : '❌ NO (expected if no failover occurred)'}`);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/failover-test-final.png`, fullPage: true });

    // ========================================================================
    // TEST SUMMARY
    // ========================================================================
    console.log('\n=== TEST SUMMARY ===');
    console.log(`  Response received: ${success ? '✅' : '❌'}`);
    console.log(`  SSE streams detected: ${sseEvents.length}`);
    console.log(`  Failover logs found: ${failoverLogs.length}`);
    console.log(`  Failover UI notification: ${hasFailoverUI ? '✅ YES' : 'N/A (no failover)'}`);

    // The test passes if we got a response (failover may or may not have occurred)
    expect(success).toBe(true);
  });
});
