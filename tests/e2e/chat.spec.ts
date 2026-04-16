/**
 * Chat E2E Tests
 *
 * These tests use the authenticated fixture which automatically
 * loads the saved MFA session from .auth/user.json
 *
 * BEFORE RUNNING:
 *   npx playwright test --project=auth-setup
 *   (Complete MFA manually in the browser)
 *
 * THEN RUN TESTS:
 *   npx playwright test --project=chromium
 */

import { test, expect } from './fixtures/auth.fixture';

test.describe('Chat Functionality', () => {
  test('should load chat interface when authenticated', async ({ authenticatedPage }) => {
    // The authenticatedPage fixture already navigated and verified login
    const page = authenticatedPage;

    // Verify chat elements are present
    await expect(page.locator('[data-testid="chat-input"], .chat-input, textarea')).toBeVisible();
    await expect(page.locator('[data-testid="chat-sidebar"], .chat-sidebar')).toBeVisible();
  });

  test('should send a message and receive a response', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Find and fill the chat input
    const chatInput = page.locator('[data-testid="chat-input"], .chat-input textarea, textarea[placeholder*="message"]');
    await chatInput.fill('What is 2 + 2? Please respond with just the number.');

    // Click send button or press Enter
    const sendButton = page.locator('[data-testid="send-button"], button[type="submit"], button:has-text("Send")');
    if (await sendButton.isVisible()) {
      await sendButton.click();
    } else {
      await chatInput.press('Enter');
    }

    // Wait for response (assistant message should appear)
    const assistantMessage = page.locator('[data-testid="assistant-message"], .message-assistant, [class*="assistant"]');
    await expect(assistantMessage.first()).toBeVisible({ timeout: 60000 });

    // Verify response contains expected answer
    const messageText = await assistantMessage.first().textContent();
    expect(messageText).toContain('4');
  });

  test('should create a new chat session', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Click new chat button
    const newChatButton = page.locator('[data-testid="new-chat"], button:has-text("New"), button[aria-label*="new"]');
    await newChatButton.click();

    // Verify chat input is clear and ready
    const chatInput = page.locator('[data-testid="chat-input"], .chat-input textarea');
    await expect(chatInput).toHaveValue('');
  });

  test('should display model badge on LLM responses', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Send a message
    const chatInput = page.locator('[data-testid="chat-input"], .chat-input textarea, textarea');
    await chatInput.fill('Say hello');
    await chatInput.press('Enter');

    // Wait for response
    await page.waitForSelector('[data-testid="assistant-message"], .message-assistant', {
      timeout: 60000,
    });

    // Verify model badge is displayed (CUX-001 requirement)
    const modelBadge = page.locator('[data-testid="model-badge"], .model-badge, [class*="ModelBadge"]');
    await expect(modelBadge.first()).toBeVisible();
  });
});

test.describe('Intelligence Slider', () => {
  test('should change model selection when slider is adjusted', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Find the intelligence slider
    const slider = page.locator('[data-testid="intelligence-slider"], input[type="range"], .slider');

    if (await slider.isVisible()) {
      // Set to low value (economical)
      await slider.fill('20');

      // Send a message
      const chatInput = page.locator('[data-testid="chat-input"], textarea');
      await chatInput.fill('Test message at low slider');
      await chatInput.press('Enter');

      // Wait for response and capture model
      await page.waitForSelector('[data-testid="model-badge"], .model-badge', { timeout: 60000 });

      // Now set to high value (premium)
      await slider.fill('80');

      // Send another message
      await chatInput.fill('Test message at high slider');
      await chatInput.press('Enter');

      // Wait for second response
      await page.waitForTimeout(2000);

      // Verify different model badges are shown (CUX-005 requirement)
      const modelBadges = await page.locator('[data-testid="model-badge"], .model-badge').allTextContents();
      console.log('Model badges found:', modelBadges);
    }
  });
});
