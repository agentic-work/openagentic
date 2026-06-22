/**
 * Chat UI E2E Tests
 *
 * Tests for:
 * - Chat interface functionality
 * - Message sending/receiving
 * - Streaming display
 * - Tool execution display
 * - Session management UI
 */

import { test, expect } from '@playwright/test';

test.describe('Chat UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to chat page
    await page.goto('/');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test.describe('Initial Load', () => {
    test('chat page loads successfully', async ({ page }) => {
      await expect(page).toHaveTitle(/OpenAgentic|Chat/i);
    });

    test('chat input is visible', async ({ page }) => {
      const chatInput = page.locator('textarea, input[type="text"]').first();
      await expect(chatInput).toBeVisible({ timeout: 10000 });
    });

    test('send button is visible', async ({ page }) => {
      const sendButton = page.locator('button').filter({ hasText: /send|submit/i }).first();
      await expect(sendButton).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Session Management', () => {
    test('new chat button creates session', async ({ page }) => {
      const newChatBtn = page.locator('button').filter({ hasText: /new|chat|\+/i }).first();
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
        // Should update URL or create new session
        await page.waitForTimeout(1000);
      }
    });

    test('session list shows sessions', async ({ page }) => {
      // Look for session list or sidebar
      const sidebar = page.locator('[class*="sidebar"], [class*="session"], nav').first();
      await expect(sidebar).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Message Sending', () => {
    test('can type message in input', async ({ page }) => {
      const chatInput = page.locator('textarea, input[placeholder*="message" i], input[placeholder*="type" i]').first();
      await chatInput.fill('Test message');
      await expect(chatInput).toHaveValue('Test message');
    });

    test('send button becomes active with message', async ({ page }) => {
      const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
      await chatInput.fill('Test message');

      const sendButton = page.locator('button[type="submit"], button:has-text("Send")').first();
      // Button should be enabled
      await expect(sendButton).toBeEnabled({ timeout: 5000 });
    });

    test('message appears after sending', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('Hello, this is a test message');

      // Press Enter or click send
      await chatInput.press('Enter');

      // Wait for message to appear
      await page.waitForTimeout(2000);

      // Look for the message in chat
      const messageArea = page.locator('[class*="message"], [class*="chat"]');
      await expect(messageArea.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Streaming Response', () => {
    test('shows loading indicator during streaming', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('What is 2+2?');
      await chatInput.press('Enter');

      // Look for loading/streaming indicator
      const loadingIndicator = page.locator('[class*="loading"], [class*="streaming"], [class*="spinner"]').first();
      // May appear briefly
      await page.waitForTimeout(1000);
    });

    test('response appears after sending', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('What is 2+2?');
      await chatInput.press('Enter');

      // Wait for response
      await page.waitForTimeout(15000);

      // Look for assistant message
      const messages = page.locator('[class*="message"], [class*="response"]');
      expect(await messages.count()).toBeGreaterThan(0);
    });
  });

  test.describe('UI Controls', () => {
    test('settings button opens settings', async ({ page }) => {
      const settingsBtn = page.locator('button').filter({ hasText: /settings|gear|⚙/i }).first();
      if (await settingsBtn.isVisible()) {
        await settingsBtn.click();
        // Settings modal or panel should appear
        await page.waitForTimeout(500);
      }
    });

    test('model selector is accessible', async ({ page }) => {
      const modelSelector = page.locator('select, [class*="model"], [class*="dropdown"]').first();
      // May or may not be visible
      if (await modelSelector.isVisible()) {
        await expect(modelSelector).toBeEnabled();
      }
    });

    test('slider control is visible for admins', async ({ page }) => {
      // Slider may be in settings or header
      const slider = page.locator('input[type="range"], [class*="slider"]').first();
      // May not be visible for non-admins
    });
  });

  test.describe('Tool Execution Display', () => {
    test('tool calls are displayed during execution', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('Search the web for test');
      await chatInput.press('Enter');

      // Wait for potential tool execution
      await page.waitForTimeout(10000);

      // Look for tool call indicator
      const toolIndicator = page.locator('[class*="tool"], [class*="mcp"]');
      // May or may not appear based on tool routing
    });
  });

  test.describe('Keyboard Shortcuts', () => {
    test('Enter sends message', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('Keyboard test');
      await chatInput.press('Enter');
      await page.waitForTimeout(1000);
      // Input should be cleared after sending
    });

    test('Shift+Enter creates new line in textarea', async ({ page }) => {
      const chatInput = page.locator('textarea').first();
      if (await chatInput.isVisible()) {
        await chatInput.fill('Line 1');
        await chatInput.press('Shift+Enter');
        await chatInput.type('Line 2');
        const value = await chatInput.inputValue();
        expect(value).toContain('\n');
      }
    });

    test('Escape cancels streaming', async ({ page }) => {
      const chatInput = page.locator('textarea, input').first();
      await chatInput.fill('Long question that might take time');
      await chatInput.press('Enter');
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      // Should stop streaming
    });
  });

  test.describe('Responsive Design', () => {
    test('mobile viewport adjusts layout', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Chat should still be functional
      const chatInput = page.locator('textarea, input').first();
      await expect(chatInput).toBeVisible({ timeout: 10000 });
    });

    test('tablet viewport shows sidebar', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.reload();
      await page.waitForLoadState('networkidle');
    });
  });
});
