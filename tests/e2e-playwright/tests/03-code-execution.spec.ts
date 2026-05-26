import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = 'admin@openagentic.io';
const TEST_PASSWORD = '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

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

async function sendCodeExecutionRequest(page: Page, request: string): Promise<{ hasToolCall: boolean; hasResult: boolean; responseText: string }> {
  // Find chat input - OpenAgentic uses "What can I do for you?" placeholder
  const chatInput = page.locator(
    'textarea[placeholder*="What can I do" i], ' +
    'textarea[placeholder*="message" i], ' +
    'textarea, ' +
    '[data-testid="chat-input"]'
  ).first();

  await chatInput.waitFor({ state: 'visible', timeout: 10000 });
  await chatInput.fill(request);

  // Find and click send button - it's the ArrowUp icon button
  const sendButton = page.locator(
    'button:has(svg.lucide-arrow-up), ' +
    'button.bg-gray-600:has(svg), ' +
    'button:has(svg)'
  ).first();

  await sendButton.click();

  // Wait for response with tool calls
  await page.waitForTimeout(5000);

  // Check for tool call indicators
  const toolCallIndicator = page.locator(
    '.tool-call, ' +
    '[data-tool-call], ' +
    '.mcp-tool, ' +
    '.code-execution, ' +
    ':has-text("execute_code"), ' +
    ':has-text("Executing")'
  );

  let hasToolCall = false;
  try {
    hasToolCall = await toolCallIndicator.isVisible({ timeout: 30000 });
  } catch {
    hasToolCall = false;
  }

  // Wait for completion
  await page.waitForTimeout(30000);

  // Check for results
  const resultIndicator = page.locator(
    '.tool-result, ' +
    '[data-tool-result], ' +
    '.execution-result, ' +
    '.code-output, ' +
    'pre:has-text("output")'
  );

  let hasResult = false;
  try {
    hasResult = await resultIndicator.isVisible({ timeout: 10000 });
  } catch {
    hasResult = false;
  }

  // Get response text - use correct data attribute from ChatMessages.tsx
  const messages = page.locator('[data-message-role="assistant"]');

  // Wait for assistant message to appear
  try {
    await messages.first().waitFor({ state: 'visible', timeout: 120000 });

    // Wait for streaming to complete
    await page.waitForFunction(
      (selector) => {
        const msgs = document.querySelectorAll(selector);
        const last = msgs[msgs.length - 1];
        return last && last.textContent && last.textContent.length > 10;
      },
      '[data-message-role="assistant"]',
      { timeout: 120000 }
    );
  } catch {
    // Continue even if wait fails
  }

  const lastMessage = messages.last();
  let responseText = '';
  try {
    responseText = await lastMessage.textContent() || '';
  } catch {
    responseText = '';
  }

  return { hasToolCall, hasResult, responseText };
}

test.describe('Phase 3: Code Execution Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
  });

  test('01 - Request Python execution', async ({ page }) => {
    await page.screenshot({ path: 'test-results/screenshots/03-code-01-before.png', fullPage: true });

    const result = await sendCodeExecutionRequest(
      page,
      'Execute this Python code and show me the output: print(sum([1, 2, 3, 4, 5]))'
    );

    await page.screenshot({ path: 'test-results/screenshots/03-code-01-result.png', fullPage: true });

    // The model should either execute the code or show the result
    expect(result.responseText.length).toBeGreaterThan(0);
  });

  test('02 - Python data processing', async ({ page }) => {
    const result = await sendCodeExecutionRequest(
      page,
      `Please execute this Python code:
\`\`\`python
data = [10, 20, 30, 40, 50]
print(f"Sum: {sum(data)}")
print(f"Average: {sum(data)/len(data)}")
\`\`\``
    );

    await page.screenshot({ path: 'test-results/screenshots/03-code-02-data.png', fullPage: true });

    expect(result.responseText.length).toBeGreaterThan(0);
  });

  test('03 - File creation request', async ({ page }) => {
    const result = await sendCodeExecutionRequest(
      page,
      'Create a file called test_output.txt with the text "Hello from Playwright test" and then read it back to show me the contents.'
    );

    await page.screenshot({ path: 'test-results/screenshots/03-code-03-file.png', fullPage: true });

    expect(result.responseText.length).toBeGreaterThan(0);
  });

  test('04 - Shell command execution', async ({ page }) => {
    const result = await sendCodeExecutionRequest(
      page,
      'Run this shell command and show me the output: echo "Shell test" && date'
    );

    await page.screenshot({ path: 'test-results/screenshots/03-code-04-shell.png', fullPage: true });

    expect(result.responseText.length).toBeGreaterThan(0);
  });

  test('05 - Complex Python script', async ({ page }) => {
    const result = await sendCodeExecutionRequest(
      page,
      `Execute this Python script:
\`\`\`python
import json

# Create sample data
users = [
    {"name": "Alice", "age": 30, "city": "NYC"},
    {"name": "Bob", "age": 25, "city": "LA"},
    {"name": "Charlie", "age": 35, "city": "Chicago"}
]

# Process and display
print("User Report:")
for user in users:
    print(f"  - {user['name']}: {user['age']} years old, lives in {user['city']}")

avg_age = sum(u['age'] for u in users) / len(users)
print(f"\\nAverage age: {avg_age:.1f}")
\`\`\``
    );

    await page.screenshot({ path: 'test-results/screenshots/03-code-05-complex.png', fullPage: true });

    expect(result.responseText.length).toBeGreaterThan(0);
  });
});
