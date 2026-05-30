import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const TEST_EMAIL = 'admin@openagentic.io';
const TEST_PASSWORD = 'REPLACE_WITH_REAL_TEST_PASSWORD';

// Helper to login
async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Check if we're on login page with Local button
  const localButton = page.locator('button:has-text("Local")');

  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await localButton.click();
    await page.waitForTimeout(1000);

    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.fill(TEST_EMAIL);

    const passwordField = page.locator('input[type="password"]');
    await passwordField.fill(TEST_PASSWORD);

    const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
    await submitButton.click();
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 30000 });
  }
}

// Helper to send a chat message and wait for response
async function sendMessage(page: Page, message: string): Promise<string> {
  // Find chat input - OpenAgentic uses "What can I do for you?" placeholder
  const chatInput = page.locator(
    'textarea[placeholder*="What can I do" i], ' +
    'textarea[placeholder*="message" i], ' +
    'textarea, ' +
    '[data-testid="chat-input"], ' +
    '.chat-input textarea'
  ).first();

  await chatInput.waitFor({ state: 'visible', timeout: 10000 });
  await chatInput.fill(message);

  // Take screenshot before sending
  await page.screenshot({
    path: `test-results/screenshots/02-chat-input-${Date.now()}.png`
  });

  // Find and click send button - it's the ArrowUp icon button
  const sendButton = page.locator(
    'button:has(svg.lucide-arrow-up), ' +
    'button.bg-gray-600:has(svg), ' +
    'button:has(svg[class*="arrow"]), ' +
    'button:has(svg)'
  ).first();

  await sendButton.click();

  // Wait for response - look for new message or loading indicator to finish
  await page.waitForTimeout(2000); // Initial wait

  // Wait for streaming to complete (no more loading indicators)
  const loadingIndicator = page.locator('.loading, .streaming, [data-loading="true"]');
  try {
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 120000 });
  } catch {
    // Loading indicator might not exist, continue
  }

  // Get the last assistant message - use correct data attribute from ChatMessages.tsx
  const messages = page.locator('[data-message-role="assistant"]');
  const messageCount = await messages.count();

  // Wait for at least one assistant message if none exist yet
  if (messageCount === 0) {
    await messages.first().waitFor({ state: 'visible', timeout: 120000 });
  }

  const lastMessage = messages.last();

  let responseText = '';
  try {
    // Wait for message content to be non-empty (streaming complete)
    await page.waitForFunction(
      (selector) => {
        const msgs = document.querySelectorAll(selector);
        const last = msgs[msgs.length - 1];
        return last && last.textContent && last.textContent.length > 10;
      },
      '[data-message-role="assistant"]',
      { timeout: 120000 }
    );

    responseText = await lastMessage.textContent() || '';
  } catch {
    responseText = 'No response found';
  }

  return responseText;
}

test.describe('Phase 2: Chat System Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to chat if not already there
    await page.waitForTimeout(2000);
  });

  test('01 - Simple greeting', async ({ page }) => {
    await page.screenshot({ path: 'test-results/screenshots/02-chat-01-before.png', fullPage: true });

    const response = await sendMessage(page, 'Hello! Please respond with a brief greeting.');

    await page.screenshot({ path: 'test-results/screenshots/02-chat-01-response.png', fullPage: true });

    expect(response.length).toBeGreaterThan(0);
  });

  test('02 - Math question', async ({ page }) => {
    const response = await sendMessage(page, 'What is 15 * 7? Just give me the number.');

    await page.screenshot({ path: 'test-results/screenshots/02-chat-02-math.png', fullPage: true });

    expect(response).toContain('105');
  });

  test('03 - Knowledge question', async ({ page }) => {
    const response = await sendMessage(page, 'What is the capital of France? Answer in one word.');

    await page.screenshot({ path: 'test-results/screenshots/02-chat-03-knowledge.png', fullPage: true });

    expect(response.toLowerCase()).toContain('paris');
  });

  test('04 - Code generation', async ({ page }) => {
    const response = await sendMessage(
      page,
      'Write a Python function that calculates the factorial of a number. Just the code, no explanation.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-04-code.png', fullPage: true });

    expect(response.toLowerCase()).toMatch(/def.*factorial|factorial.*function/);
  });

  test('05 - Multi-turn conversation', async ({ page }) => {
    // First message
    await sendMessage(page, 'My name is TestUser. Please remember this.');
    await page.waitForTimeout(3000);

    // Second message - check memory
    const response = await sendMessage(page, 'What is my name?');

    await page.screenshot({ path: 'test-results/screenshots/02-chat-05-memory.png', fullPage: true });

    expect(response.toLowerCase()).toContain('testuser');
  });

  test('06 - List generation', async ({ page }) => {
    const response = await sendMessage(
      page,
      'List 5 primary colors. Just the colors, numbered 1-5.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-06-list.png', fullPage: true });

    expect(response).toMatch(/1\.|2\.|3\.|4\.|5\./);
  });

  test('07 - Explanation task', async ({ page }) => {
    const response = await sendMessage(
      page,
      'Explain what an API is in exactly 2 sentences.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-07-explain.png', fullPage: true });

    expect(response.length).toBeGreaterThan(50);
  });

  test('08 - Creative writing', async ({ page }) => {
    const response = await sendMessage(
      page,
      'Write a haiku about programming.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-08-creative.png', fullPage: true });

    expect(response.length).toBeGreaterThan(20);
  });

  test('09 - JSON generation', async ({ page }) => {
    const response = await sendMessage(
      page,
      'Generate a JSON object with fields: name, age, city. Use test data.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-09-json.png', fullPage: true });

    expect(response).toMatch(/\{[\s\S]*"name"[\s\S]*\}/);
  });

  test('10 - Complex reasoning', async ({ page }) => {
    const response = await sendMessage(
      page,
      'If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Explain your reasoning briefly.'
    );

    await page.screenshot({ path: 'test-results/screenshots/02-chat-10-reasoning.png', fullPage: true });

    expect(response.length).toBeGreaterThan(50);
  });
});
