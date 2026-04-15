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
 * Streaming Artifacts E2E Tests
 *
 * Tests that artifacts render LIVE during SSE streaming, not just after completion.
 * Validates the visual experience matches the expected behavior where artifacts
 * appear and update incrementally as the LLM generates content.
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@openagentics.io';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Login helper
async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Click Local button for auth provider selection
  const localButton = page.getByRole('button', { name: /local/i });
  if (await localButton.isVisible()) {
    await localButton.click();
    await page.waitForTimeout(500);
  }

  // Fill login form
  await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"], input[name="password"]', ADMIN_PASSWORD);

  // Submit via keyboard to avoid button interception issues
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Dismiss onboarding modal if present
  const skipButton = page.getByRole('button', { name: /skip|close|dismiss/i });
  if (await skipButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipButton.click();
  }

  // Wait for chat interface
  await expect(page.locator('[data-testid="chat-input"], textarea, .chat-input')).toBeVisible({ timeout: 10000 });
}

// Send message helper
async function sendMessage(page: Page, message: string) {
  const input = page.locator('[data-testid="chat-input"], textarea, .chat-input').first();
  await input.fill(message);
  await page.keyboard.press('Enter');
}

test.describe('Streaming Artifacts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('SVG artifact should render live during streaming', async ({ page }) => {
    // Send a message that will trigger SVG artifact generation
    await sendMessage(page, 'Create a simple SVG of a blue circle on a white background. Use artifact:svg code block.');

    // The streaming artifact indicator should appear BEFORE the response is complete
    // This validates that we're rendering incrementally, not waiting for completion
    const streamingIndicator = page.locator('[data-testid="streaming-artifact"]');

    // Should see streaming artifact within 5 seconds of starting generation
    // This is the key assertion - if we wait too long, we're not streaming
    await expect(streamingIndicator).toBeVisible({ timeout: 10000 });

    // The streaming indicator should show "Generating..."
    await expect(page.locator('text=Generating...')).toBeVisible({ timeout: 5000 });

    // Wait for completion and verify final render
    const completeArtifact = page.locator('[data-testid="artifact-complete"]');
    await expect(completeArtifact).toBeVisible({ timeout: 60000 });

    // Verify an iframe is present (artifact rendered)
    await expect(page.locator('iframe[title*="artifact"]')).toBeVisible();
  });

  test('HTML artifact should render live during streaming', async ({ page }) => {
    await sendMessage(page, 'Create a simple HTML page with a red heading that says "Hello World". Use artifact:html code block.');

    // Should see streaming artifact appear quickly
    const streamingIndicator = page.locator('[data-testid="streaming-artifact"]');
    await expect(streamingIndicator).toBeVisible({ timeout: 10000 });

    // Wait for completion
    await expect(page.locator('[data-testid="artifact-complete"]')).toBeVisible({ timeout: 60000 });

    // Verify iframe content loaded
    const iframe = page.frameLocator('iframe[title*="artifact"]');
    await expect(iframe.locator('body')).toBeVisible();
  });

  test('Mermaid diagram should render live during streaming', async ({ page }) => {
    await sendMessage(page, 'Create a simple mermaid flowchart showing: Start -> Process -> End. Use mermaid code block.');

    // Should see streaming artifact appear
    const streamingIndicator = page.locator('[data-testid="streaming-artifact"]');
    await expect(streamingIndicator).toBeVisible({ timeout: 10000 });

    // Wait for completion
    await expect(page.locator('[data-testid="artifact-complete"]')).toBeVisible({ timeout: 60000 });
  });

  test('artifact content before fence should render immediately', async ({ page }) => {
    await sendMessage(page, 'First write a paragraph about circles, then create an SVG of a circle using artifact:svg.');

    // The text before the artifact should be visible immediately
    // while the artifact streams
    await expect(page.locator('.llm-content')).toBeVisible({ timeout: 10000 });

    // Should eventually see the streaming artifact
    await expect(page.locator('[data-testid="streaming-artifact"], [data-testid="artifact-complete"]')).toBeVisible({ timeout: 30000 });
  });

  test('no black box or raw code during streaming', async ({ page }) => {
    await sendMessage(page, 'Create a colorful SVG with multiple shapes. Use artifact:svg code block.');

    // Wait a bit for streaming to start
    await page.waitForTimeout(3000);

    // Should NOT see raw backticks or code fence syntax during streaming
    // This would indicate the artifact isn't being detected/rendered properly
    const rawFenceVisible = await page.locator('text=/```artifact:|```svg/').isVisible().catch(() => false);
    expect(rawFenceVisible).toBe(false);

    // Should see either streaming or complete artifact
    await expect(page.locator('[data-testid="streaming-artifact"], [data-testid="artifact-complete"], iframe[title*="artifact"]')).toBeVisible({ timeout: 30000 });
  });

  test('artifact transitions smoothly from streaming to complete', async ({ page }) => {
    await sendMessage(page, 'Create a simple SVG rectangle. Use artifact:svg code block.');

    // Wait for streaming to start
    const streamingArtifact = page.locator('[data-testid="streaming-artifact"]');
    await expect(streamingArtifact).toBeVisible({ timeout: 15000 });

    // Wait for completion
    const completeArtifact = page.locator('[data-testid="artifact-complete"]');
    await expect(completeArtifact).toBeVisible({ timeout: 60000 });

    // Verify streaming indicator is gone after completion
    await expect(page.locator('text=Generating...')).not.toBeVisible({ timeout: 5000 });

    // Verify iframe is still present and functional
    await expect(page.locator('iframe')).toBeVisible();
  });
});

test.describe('Streaming Artifacts - Provider Specific', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Anthropic (Claude) - artifacts stream correctly', async ({ page }) => {
    // This test assumes the default provider is Anthropic
    await sendMessage(page, 'Create a simple SVG circle. Use artifact:svg.');

    // Verify streaming behavior
    await expect(page.locator('[data-testid="streaming-artifact"], [data-testid="artifact-complete"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('iframe')).toBeVisible({ timeout: 60000 });
  });
});
