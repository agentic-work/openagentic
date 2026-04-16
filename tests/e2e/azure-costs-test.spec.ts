import { test, expect, Page } from '@playwright/test';

/**
 * Azure Costs Performance Test
 *
 * Tests: "give me the costs per resource over the last 30 days in a line graph"
 * Measures: Response time, token usage, MCP tool calls, accuracy
 */

test.describe.configure({ mode: 'serial' });

// Test configuration
const BASE_URL = process.env.TEST_BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_USER = process.env.TEST_USER || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// Test metrics collection
interface TestMetrics {
  startTime: number;
  firstTokenTime: number | null;
  endTime: number | null;
  totalTimeMs: number | null;
  timeToFirstTokenMs: number | null;
  mcpToolsUsed: string[];
  responseLanguage: string;
  hasChart: boolean;
  responseAccurate: boolean;
  responseText: string;
  errors: string[];
}

test.describe('Azure Costs Performance Test', () => {
  let page: Page;
  const metrics: TestMetrics = {
    startTime: 0,
    firstTokenTime: null,
    endTime: null,
    totalTimeMs: null,
    timeToFirstTokenMs: null,
    mcpToolsUsed: [],
    responseLanguage: 'unknown',
    hasChart: false,
    responseAccurate: false,
    responseText: '',
    errors: []
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();

    // Capture console messages for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') {
        console.log(`[Browser Error] ${text}`);
        metrics.errors.push(text);
      }
    });

    page.on('pageerror', err => {
      console.error(`[Browser Error] ${err.message}`);
      metrics.errors.push(err.message);
    });
  });

  test('Login and setup', async () => {
    console.log('Navigating to login page...');
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Check if already logged in (has textarea)
    const hasTextarea = await page.locator('textarea').first().isVisible().catch(() => false);
    if (hasTextarea) {
      console.log('Already logged in!');
      return;
    }

    // Find and click local auth button
    const localAuthBtn = page.locator('button:has-text("Local"), button:has-text("Email")').first();
    if (await localAuthBtn.isVisible()) {
      console.log('Found local auth button, clicking...');
      await localAuthBtn.click();
      await page.waitForTimeout(1000);
    }

    // Fill login form
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(TEST_USER);
    await passwordInput.fill(TEST_PASSWORD);

    console.log('Submitting login...');
    await page.locator('button:has-text("Sign"), button[type="submit"]').first().click();

    // Wait for successful login (wait for textarea to appear)
    await page.waitForSelector('textarea', { timeout: 30000 });
    console.log('Login successful!');
  });

  test('Test Azure costs query with metrics', async () => {
    const testQuery = 'give me the costs per resource over the last 30 days in a line graph';

    console.log('\n' + '='.repeat(60));
    console.log('AZURE COSTS PERFORMANCE TEST');
    console.log('='.repeat(60));
    console.log(`Query: "${testQuery}"`);
    console.log('='.repeat(60) + '\n');

    // Click "New Chat" first to get a clean conversation
    const newChatBtn = page.locator('button:has-text("New Chat"), [data-testid="new-chat"]').first();
    if (await newChatBtn.isVisible()) {
      console.log('Starting new chat...');
      await newChatBtn.click();
      await page.waitForTimeout(1000);
    }

    // Find chat input
    const chatInput = page.locator('textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    console.log('Found chat input!');

    // Click to focus and type the query
    await chatInput.click();
    await chatInput.fill(testQuery);

    // Count existing messages before sending
    const initialMessageCount = await page.locator('[class*="message"]').count();
    console.log(`Initial message count: ${initialMessageCount}`);

    // Start timing
    metrics.startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Sending query via Enter key...`);

    // Send the message by pressing Enter
    await chatInput.press('Enter');

    // Wait for new response content to appear
    console.log('Waiting for response...');

    // Poll for response - look for assistant message content
    let responseFound = false;
    let pollAttempts = 0;
    const maxPollAttempts = 300; // 5 minutes max (300 * 1000ms = 300s)

    while (!responseFound && pollAttempts < maxPollAttempts) {
      await page.waitForTimeout(1000);
      pollAttempts++;

      // Check for assistant message content
      const messageContent = await page.evaluate(() => {
        // Find any element that looks like a response
        const allText = Array.from(document.querySelectorAll('*'))
          .map(el => (el as HTMLElement).innerText || '')
          .join(' ');

        // Check if there's substantial content
        return allText.length;
      });

      // Detect first token
      if (messageContent > 1000 && !metrics.firstTokenTime) {
        metrics.firstTokenTime = Date.now();
        metrics.timeToFirstTokenMs = metrics.firstTokenTime - metrics.startTime;
        console.log(`[TTFT] Time to first token: ${metrics.timeToFirstTokenMs}ms (${(metrics.timeToFirstTokenMs / 1000).toFixed(1)}s)`);
      }

      // Check if streaming is still happening (look for animated elements or loading indicators)
      const isStreaming = await page.evaluate(() => {
        // Check for typing cursor or streaming indicator
        const streamingEl = document.querySelector('.streaming-indicator, .typing-cursor, .loading-dots, [class*="streaming"]');
        // Check for send button disabled state
        const sendBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
        const sendDisabled = sendBtn?.disabled ?? false;
        return !!streamingEl || sendDisabled;
      });

      if (!isStreaming && pollAttempts > 5) {
        // Give it a few more seconds after streaming stops
        await page.waitForTimeout(2000);
        responseFound = true;
        console.log(`Response detected after ${pollAttempts} seconds`);
      }

      if (pollAttempts % 10 === 0) {
        console.log(`Still waiting... ${pollAttempts}s elapsed`);
      }
    }

    // Capture end time
    metrics.endTime = Date.now();
    metrics.totalTimeMs = metrics.endTime - metrics.startTime;

    // Take screenshot
    await page.screenshot({
      path: 'screenshots/azure-costs-test.png',
      fullPage: true
    });

    // Get full page text to analyze response
    const pageText = await page.evaluate(() => document.body.innerText);
    metrics.responseText = pageText.substring(0, 5000); // First 5000 chars

    // Detect language (check for Russian characters)
    const russianPattern = /[а-яА-ЯёЁ]{5,}/; // 5+ consecutive Russian chars
    if (russianPattern.test(metrics.responseText)) {
      metrics.responseLanguage = 'RUSSIAN (BUG!)';
      console.error('❌ RUSSIAN LANGUAGE DETECTED IN RESPONSE!');
    } else {
      metrics.responseLanguage = 'English';
    }

    // Check for chart
    metrics.hasChart = await page.locator('canvas, svg.recharts-surface, [class*="chart"]').first().isVisible().catch(() => false);

    // Check accuracy - does it mention costs/resources/azure?
    const lowerText = metrics.responseText.toLowerCase();
    const hasRelevantContent =
      lowerText.includes('cost') ||
      lowerText.includes('resource') ||
      lowerText.includes('azure') ||
      lowerText.includes('subscription');
    metrics.responseAccurate = hasRelevantContent;

    // Capture MCP tool calls from the UI
    const toolBoxes = await page.locator('[class*="tool"], [data-tool]').all();
    for (const box of toolBoxes.slice(0, 10)) { // Limit to first 10
      try {
        const text = await box.textContent();
        if (text && text.length > 2 && text.length < 100) {
          metrics.mcpToolsUsed.push(text.trim());
        }
      } catch {}
    }

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Time: ${metrics.totalTimeMs}ms (${(metrics.totalTimeMs! / 1000).toFixed(1)}s)`);
    console.log(`Time to First Token: ${metrics.timeToFirstTokenMs ? `${metrics.timeToFirstTokenMs}ms (${(metrics.timeToFirstTokenMs / 1000).toFixed(1)}s)` : 'N/A'}`);
    console.log(`Response Language: ${metrics.responseLanguage}`);
    console.log(`Has Chart: ${metrics.hasChart}`);
    console.log(`Response Accurate: ${metrics.responseAccurate}`);
    console.log(`MCP Tools Detected: ${metrics.mcpToolsUsed.length > 0 ? metrics.mcpToolsUsed.join(', ') : 'None in UI'}`);
    console.log(`Errors: ${metrics.errors.length > 0 ? metrics.errors.length : 'None'}`);
    console.log('');
    console.log('Response Preview (first 500 chars):');
    console.log('-'.repeat(40));
    console.log(metrics.responseText.substring(0, 500));
    console.log('-'.repeat(40));
    console.log('='.repeat(60) + '\n');

    // Assert critical requirements
    expect(metrics.totalTimeMs).toBeLessThan(180000); // Should complete within 3min
    expect(metrics.responseLanguage).not.toContain('RUSSIAN'); // Must be in English!

    // Log metrics as JSON for parsing
    console.log('METRICS_JSON_START');
    console.log(JSON.stringify({
      totalTimeMs: metrics.totalTimeMs,
      timeToFirstTokenMs: metrics.timeToFirstTokenMs,
      responseLanguage: metrics.responseLanguage,
      hasChart: metrics.hasChart,
      responseAccurate: metrics.responseAccurate,
      mcpToolsCount: metrics.mcpToolsUsed.length,
      errorsCount: metrics.errors.length
    }, null, 2));
    console.log('METRICS_JSON_END');
  });
});
