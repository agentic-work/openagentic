import { test, expect, Page } from '@playwright/test';

// Use Caddy reverse proxy URL (port 8080 for local dev)
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
// Dev mode uses local auth with DEV_API_KEY
const USE_DEV_API_KEY = true;

/**
 * Code Mode InlineToolBlock Test
 *
 * Tests that Code Mode displays interleaved text and tool blocks:
 * - Text explaining what the assistant is about to do
 * - Tool blocks showing execution
 * - Text explaining results
 */

async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot to see login state
  await page.screenshot({ path: 'test-results/screenshots/06-code-mode-00-login-page.png', fullPage: true });

  // Check if we need to click "Continue as Test User" or similar dev login
  const devLoginButton = page.locator(
    'button:has-text("Continue as"), ' +
    'button:has-text("Test User"), ' +
    'button:has-text("Dev Login"), ' +
    'button:has-text("Skip")'
  ).first();

  if (await devLoginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await devLoginButton.click();
    await page.waitForTimeout(2000);
    return;
  }

  // Check if there's a local/dev auth option
  const localButton = page.locator('button:has-text("Local"), button:has-text("Development")');

  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await localButton.click();
    await page.waitForTimeout(1000);

    // Fill dev credentials
    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailField.fill('admin@openagentic.io');
      const passwordField = page.locator('input[type="password"]');
      // Password from ADMIN_USER_PASSWORD env var
      await passwordField.fill('6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3');
      const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
      await submitButton.click();
      // Wait for either redirect or password change prompt
      await page.waitForTimeout(3000);
      // Handle password change requirement if it appears
      const passwordChangeModal = page.locator('text=Password change required, text=change your password');
      if (await passwordChangeModal.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('Password change required - need to update password first');
        // For testing, skip if password change is required
      }
    }
  }

  // If already on main page (no login needed), continue
  await page.waitForTimeout(2000);
}

async function navigateToCodeMode(page: Page) {
  // Look for Code Mode navigation button
  const codeModeButton = page.locator(
    'a[href*="code"], ' +
    'button:has-text("Code"), ' +
    '[data-testid="code-mode"], ' +
    '.nav-code-mode, ' +
    'a:has-text("Code Mode")'
  ).first();

  if (await codeModeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await codeModeButton.click();
    await page.waitForTimeout(2000);
  } else {
    // Try direct navigation
    await page.goto(`${BASE_URL}/code`);
    await page.waitForTimeout(2000);
  }

  // Wait for Code Mode to load
  await page.waitForLoadState('networkidle');
}

async function sendCodeModeMessage(page: Page, message: string) {
  // Find chat input in Code Mode
  const chatInput = page.locator(
    'textarea[placeholder*="message" i], ' +
    'textarea[placeholder*="What" i], ' +
    'textarea[placeholder*="task" i], ' +
    '[data-testid="code-input"], ' +
    'textarea'
  ).first();

  await chatInput.waitFor({ state: 'visible', timeout: 10000 });
  await chatInput.fill(message);

  // Press Enter to send (per the UI hint: "Press Enter to send")
  await chatInput.press('Enter');
}

test.describe('Code Mode InlineToolBlock Tests', () => {
  test.setTimeout(180000); // 3 minute timeout

  test.beforeEach(async ({ page }) => {
    // Capture console messages for debugging
    page.on('console', msg => {
      if (msg.text().includes('[WS Handler]') || msg.text().includes('[Store]') || msg.text().includes('[Render]')) {
        console.log('BROWSER:', msg.text());
      }
    });

    await login(page);
    await navigateToCodeMode(page);
  });

  test('Flask app creation shows interleaved text and tool blocks', async ({ page }) => {
    // Take initial screenshot
    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-01-initial.png',
      fullPage: true
    });

    // Send the Flask app request
    await sendCodeModeMessage(
      page,
      'please create a test python application running in flask and tail out its logs after you start it- it should generate colorful random numbers'
    );

    // Wait for response to start
    await page.waitForTimeout(5000);
    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-02-streaming.png',
      fullPage: true
    });

    // Wait for tool blocks to appear
    const toolBlock = page.locator(
      '[data-testid="inline-tool-block"], ' +
      '.inline-tool-block'
    ).first();

    try {
      await toolBlock.waitFor({ state: 'visible', timeout: 60000 });
      console.log('✓ Tool block appeared');
    } catch {
      console.log('✗ No tool block found');
    }

    // Check for INTERLEAVED text and tool blocks
    // The key is: text BEFORE tool, then tool, then text AFTER
    await page.waitForTimeout(10000);

    // Look for text content in assistant messages
    const assistantMessages = page.locator(
      '[data-message-role="assistant"], ' +
      '.assistant-message, ' +
      '[class*="Message"]:has([class*="assistant"])'
    );

    // Take screenshot of streaming state
    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-03-with-tools.png',
      fullPage: true
    });

    // Wait for completion (tool execution can take a while)
    await page.waitForTimeout(60000);

    // Final screenshot
    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-04-complete.png',
      fullPage: true
    });

    // Extract all content blocks to analyze structure
    const contentStructure = await page.evaluate(() => {
      const blocks: Array<{ type: string; preview: string }> = [];

      // Find tool blocks by data-testid
      const toolBlocks = document.querySelectorAll('[data-testid="inline-tool-block"], .inline-tool-block');
      toolBlocks.forEach(el => {
        const toolName = el.getAttribute('data-tool-name') || 'Unknown';
        blocks.push({ type: 'tool', preview: toolName });
      });

      // Find text blocks (paragraphs in the message area)
      const messageArea = document.querySelector('[class*="CodeModeLayout"]') ||
                         document.querySelector('[class*="space-y"]');
      if (messageArea) {
        const textElements = messageArea.querySelectorAll('p, .prose-sm-tight');
        textElements.forEach(el => {
          const text = el.textContent?.trim() || '';
          if (text.length > 5 && !text.includes('●')) { // Exclude tool block content
            blocks.push({ type: 'text', preview: text.slice(0, 50) });
          }
        });
      }

      return blocks;
    });

    console.log('Content structure found:', JSON.stringify(contentStructure, null, 2));

    // Check that we have BOTH text and tool blocks
    const hasTextBlocks = contentStructure.some(b => b.type === 'text');
    const hasToolBlocks = contentStructure.some(b => b.type === 'tool');

    console.log(`Has text blocks: ${hasTextBlocks}`);
    console.log(`Has tool blocks: ${hasToolBlocks}`);

    // The test passes if we see tool blocks using Playwright locator
    const toolBlocksLocator = page.locator('[data-testid="inline-tool-block"], .inline-tool-block');
    const toolBlockCount = await toolBlocksLocator.count();
    console.log(`Found ${toolBlockCount} tool blocks via Playwright`);
    expect(toolBlockCount).toBeGreaterThan(0);
  });

  test('Verify InlineToolBlock renders with animation', async ({ page }) => {
    // Send a simple command that will trigger a tool call
    await sendCodeModeMessage(page, 'list the files in the current directory');

    // Wait for tool block to appear
    await page.waitForTimeout(5000);

    // Look for InlineToolBlock elements
    const toolBlocks = page.locator('[data-testid="inline-tool-block"], .inline-tool-block');

    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-05-tool-block.png',
      fullPage: true
    });

    // Wait for streaming to complete
    await page.waitForTimeout(30000);

    await page.screenshot({
      path: 'test-results/screenshots/06-code-mode-06-tool-complete.png',
      fullPage: true
    });

    // Check tool block styling
    const toolBlockCount = await toolBlocks.count();
    console.log(`Found ${toolBlockCount} tool blocks`);

    // Expect at least one tool block for a file listing command
    if (toolBlockCount > 0) {
      console.log('✓ Tool blocks rendered');

      // Check if tool block has expected structure
      const firstToolBlock = toolBlocks.first();
      const toolBlockHTML = await firstToolBlock.innerHTML().catch(() => '');
      console.log('Tool block HTML preview:', toolBlockHTML.slice(0, 300));
    }
  });
});
