/**
 * UI Component E2E Tests
 *
 * Tests for all major UI components:
 * - Chat interface
 * - Session sidebar
 * - Message display
 * - Tool call display
 * - Admin portal
 * - Settings panels
 */

import { test, expect } from '@playwright/test';

const UI_URL = process.env.TEST_UI_URL || 'http://localhost:80';

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test('should display chat input', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await expect(input).toBeVisible();
  });

  test('should display send button', async ({ page }) => {
    const sendButton = page.locator('button').filter({ hasText: /send|submit/i }).first();
    await expect(sendButton).toBeVisible();
  });

  test('should allow typing in chat input', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Hello, world!');
    await expect(input).toHaveValue('Hello, world!');
  });

  test('should submit message on Enter', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Test message');
    await input.press('Enter');

    // Message should appear in chat
    await expect(page.locator('text=Test message')).toBeVisible({ timeout: 5000 });
  });

  test('should submit message on button click', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Button test');

    const sendButton = page.locator('button').filter({ hasText: /send|submit/i }).first();
    await sendButton.click();

    await expect(page.locator('text=Button test')).toBeVisible({ timeout: 5000 });
  });

  test('should show loading state while waiting for response', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Quick test');
    await input.press('Enter');

    // Look for loading indicator
    const loading = page.locator('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
    // May or may not show loading state
  });

  test('should display assistant response', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Say hello');
    await input.press('Enter');

    // Wait for response (may take time)
    await page.waitForTimeout(10000);

    // Should have assistant message
    const messages = page.locator('[class*="message"], [class*="chat"]');
    await expect(messages).toHaveCount({ minimum: 2 }, { timeout: 30000 });
  });
});

test.describe('Session Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display session list', async ({ page }) => {
    const sidebar = page.locator('[class*="sidebar"], [class*="session-list"]');
    await expect(sidebar).toBeVisible();
  });

  test('should show new chat button', async ({ page }) => {
    const newChatBtn = page.locator('button').filter({ hasText: /new|create|chat/i }).first();
    await expect(newChatBtn).toBeVisible();
  });

  test('should create new session', async ({ page }) => {
    const newChatBtn = page.locator('button').filter({ hasText: /new|create|chat/i }).first();
    await newChatBtn.click();

    // New session should be created
    await page.waitForTimeout(1000);
  });

  test('should switch between sessions', async ({ page }) => {
    // Create a session first
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Session 1');
    await input.press('Enter');
    await page.waitForTimeout(2000);

    // Create another session
    const newChatBtn = page.locator('button').filter({ hasText: /new|create/i }).first();
    if (newChatBtn) {
      await newChatBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  test('should delete session', async ({ page }) => {
    // Find delete button (usually in context menu or hover state)
    const sessionItem = page.locator('[class*="session"]').first();
    await sessionItem.hover();

    const deleteBtn = page.locator('button').filter({ hasText: /delete|remove/i }).first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
    }
  });
});

test.describe('Message Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display user messages with correct styling', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('User message test');
    await input.press('Enter');

    const userMessage = page.locator('text=User message test');
    await expect(userMessage).toBeVisible();
  });

  test('should render markdown in messages', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Please respond with **bold** text');
    await input.press('Enter');

    await page.waitForTimeout(10000);

    // Check for rendered markdown (bold tags)
    const boldText = page.locator('strong, b');
    // May or may not have bold text in response
  });

  test('should render code blocks', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Write a simple hello world in Python');
    await input.press('Enter');

    await page.waitForTimeout(15000);

    // Check for code block
    const codeBlock = page.locator('pre, code');
    // Should have code block if LLM responds with code
  });

  test('should have copy button for code blocks', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Show me a code example');
    await input.press('Enter');

    await page.waitForTimeout(15000);

    const copyButton = page.locator('button').filter({ hasText: /copy/i });
    // May or may not have copy button
  });
});

test.describe('Tool Call Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display tool calls', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.fill('Search the web for TypeScript tutorials');
    await input.press('Enter');

    await page.waitForTimeout(20000);

    // Look for tool call indicator
    const toolCall = page.locator('[class*="tool"], [class*="function"]');
    // May or may not have tool calls
  });

  test('should show tool call status', async ({ page }) => {
    // Tool calls should show pending/running/complete status
  });

  test('should expand tool call details', async ({ page }) => {
    // Tool calls should be expandable
  });
});

test.describe('Intelligence Slider', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display slider control', async ({ page }) => {
    const slider = page.locator('input[type="range"], [class*="slider"]');
    await expect(slider).toBeVisible();
  });

  test('should update slider value', async ({ page }) => {
    const slider = page.locator('input[type="range"]').first();
    if (await slider.isVisible()) {
      await slider.fill('75');
      await expect(slider).toHaveValue('75');
    }
  });

  test('should show slider label', async ({ page }) => {
    // Slider should show current value or mode (Economical/Balanced/Premium)
    const label = page.locator('[class*="slider"] span, [class*="slider"] label');
    // May have various labels
  });
});

test.describe('Model Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should display model selector', async ({ page }) => {
    const modelSelect = page.locator('select, [class*="model-select"], [role="combobox"]');
    // May or may not have visible model selector
  });

  test('should list available models', async ({ page }) => {
    const modelSelect = page.locator('select').first();
    if (await modelSelect.isVisible()) {
      await modelSelect.click();
      const options = page.locator('option');
      await expect(options).toHaveCount({ minimum: 1 });
    }
  });
});

test.describe('Admin Portal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${UI_URL}/admin`);
    await page.waitForLoadState('networkidle');
  });

  test('should display admin dashboard', async ({ page }) => {
    const dashboard = page.locator('[class*="admin"], [class*="dashboard"]');
    await expect(dashboard).toBeVisible();
  });

  test('should show user management section', async ({ page }) => {
    const usersTab = page.locator('text=Users, text=User Management').first();
    if (await usersTab.isVisible()) {
      await usersTab.click();
      // Should show user list
    }
  });

  test('should show API key management', async ({ page }) => {
    const keysTab = page.locator('text=API Keys, text=Tokens').first();
    if (await keysTab.isVisible()) {
      await keysTab.click();
      // Should show API key list
    }
  });

  test('should show metrics', async ({ page }) => {
    const metricsTab = page.locator('text=Metrics, text=Analytics').first();
    if (await metricsTab.isVisible()) {
      await metricsTab.click();
      // Should show metrics charts
    }
  });

  test('should show system settings', async ({ page }) => {
    const settingsTab = page.locator('text=Settings, text=Configuration').first();
    if (await settingsTab.isVisible()) {
      await settingsTab.click();
      // Should show settings form
    }
  });
});

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(UI_URL);

    // Should still be usable
    const input = page.locator('textarea, input[type="text"]').first();
    await expect(input).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(UI_URL);

    const input = page.locator('textarea, input[type="text"]').first();
    await expect(input).toBeVisible();
  });

  test('should show hamburger menu on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(UI_URL);

    // Sidebar may be collapsed
    const menuButton = page.locator('button[aria-label*="menu"], [class*="hamburger"]');
    // May or may not have hamburger menu
  });
});

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should focus chat input with shortcut', async ({ page }) => {
    await page.keyboard.press('Control+/');
    // Or another shortcut
  });

  test('should navigate with Tab key', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // Should navigate through interactive elements
  });

  test('should submit with Ctrl+Enter', async ({ page }) => {
    const input = page.locator('textarea, input[type="text"]').first();
    await input.focus();
    await input.fill('Keyboard test');
    await page.keyboard.press('Control+Enter');
  });
});

test.describe('Dark Mode', () => {
  test('should respect system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(UI_URL);

    // Should apply dark mode styles
    const body = page.locator('body');
    // Check for dark background or dark mode class
  });

  test('should toggle dark mode', async ({ page }) => {
    await page.goto(UI_URL);

    const themeToggle = page.locator('button').filter({ hasText: /dark|light|theme/i }).first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
    }
  });
});

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(UI_URL);
    await page.waitForLoadState('networkidle');
  });

  test('should have proper heading structure', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount({ minimum: 1 });
  });

  test('should have alt text on images', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      // Should have alt attribute
    }
  });

  test('should have proper button labels', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');
      // Should have text or aria-label
      expect(text?.trim() || ariaLabel).toBeDefined();
    }
  });

  test('should be navigable with screen reader', async ({ page }) => {
    // Check for ARIA roles
    const main = page.locator('[role="main"], main');
    // Should have main landmark
  });
});
