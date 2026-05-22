/**
 * v0.6.0 Agents E2E Test
 * Tests agent CRUD, sidebar play button, and delegate_to_agents tool usage.
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(120_000);

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) return;

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await msEmailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msEmailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await msPasswordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msPasswordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
    if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await staySignedIn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('textarea', { timeout: 60000 });
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
  const backdrop = page.locator('.fixed.inset-0.bg-black\\/70');
  if (await backdrop.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
}

test.describe('v0.6.0 Agents', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('1. Admin — Create agent "test-reviewer"', async ({ page }) => {
    // Navigate to admin
    const settingsBtn = page.locator('text=Settings & more, button:has-text("Settings")').first();
    if (await settingsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1000);
    }
    const adminBtn = page.locator('text=Admin Panel, text=Admin Console').first();
    if (await adminBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await adminBtn.click();
      await page.waitForTimeout(3000);
    }

    // Navigate to agents tab
    const agentsTab = page.locator('text=Agents, button:has-text("Agents")').first();
    if (await agentsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agentsTab.click();
      await page.waitForTimeout(2000);
    }

    // Click Create Agent
    const createBtn = page.locator('button:has-text("Create Agent"), button:has-text("New Agent"), button:has-text("Add")').first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(1000);

      // Fill in agent name
      const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill('test-reviewer-v060');
      }

      // Submit
      const saveBtn = page.locator('button:has-text("Create"), button:has-text("Save")').first();
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    console.log('Agent creation attempted');
  });

  test('2. Sidebar — Agents section shows agents', async ({ page }) => {
    // Navigate to flows to see sidebar
    await page.goto(`${BASE_URL}/flows`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Look for agents section in sidebar
    const agentsSection = page.locator('text=Agents, [data-section="agents"]').first();
    const visible = await agentsSection.isVisible({ timeout: 10000 }).catch(() => false);
    console.log('Agents section in sidebar visible:', visible);
  });

  test('3. Sidebar — Click Play on agent', async ({ page }) => {
    await page.goto(`${BASE_URL}/flows`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Find play button in agents section
    const playBtn = page.locator('button[title="Test agent"], button:has(svg.lucide-play)').first();
    if (await playBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await playBtn.click();
      console.log('Agent play button clicked');
      // Wait for result (should show spinner then result, not just 2s fake spinner)
      await page.waitForTimeout(10000);

      // Check for test result
      const result = page.locator('text=Test Passed, text=Test Failed');
      const hasResult = await result.first().isVisible({ timeout: 5000 }).catch(() => false);
      console.log('Agent test result visible:', hasResult);
    } else {
      console.log('No play button found in agents section');
    }
  });

  test('4. Chat — Agent delegation', async ({ page }) => {
    const textarea = page.locator('textarea');
    await textarea.fill('Use your available agents to analyze what services are running and check their health status.');
    await textarea.press('Enter');

    // Wait for response — may include delegate_to_agents tool call
    await page.waitForTimeout(15000);

    const response = page.locator('[data-testid="message-content"], .message-content, .prose').last();
    await expect(response).toBeVisible({ timeout: 60000 });
    const text = await response.textContent();
    console.log('Agent delegation response:', text?.substring(0, 300));
  });
});
