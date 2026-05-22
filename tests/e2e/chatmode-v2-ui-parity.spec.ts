/**
 * Chatmode V2 UI parity — assert mocks/UX/01-cloud-ops.html anatomy.
 *
 * Sends a one-shot prompt and asserts the assistant message renders the
 * V2 MessageHeader from services/openagentic-ui/src/features/chat/components/v2/:
 *
 *   - `.cm-msg-head` container (8px-baseline header row from mock)
 *   - `.cm-avatar.cm-av-asst` 28×28 purple gradient avatar
 *   - `.cm-name` 13px bold display name
 *   - NO `<span class="cost-pill">` per-message (per user direction)
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md Phase 2.
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

async function newChatSession(page: Page): Promise<void> {
  await page
    .getByRole('textbox', { name: 'Chat message input' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  const newChatBtn = page.getByRole('button', { name: 'New Chat', exact: true }).first();
  await newChatBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await newChatBtn.click({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Chat message input' });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test.describe('Chatmode V2 UI parity — mocks/UX/01 anatomy', () => {
  test.setTimeout(180_000);
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('onboarding_completed', 'true');
        localStorage.setItem('ac-welcome-shown', 'true');
        localStorage.setItem('ac-onboarding-completed', 'true');
      } catch {}
    });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    if (
      /\/login/i.test(page.url()) ||
      (await page
        .getByText(/Continue with Microsoft/i)
        .isVisible({ timeout: 1_000 })
        .catch(() => false))
    ) {
      await page.goto(BASE);
      await page.waitForLoadState('domcontentloaded');
    }
  });

  test('assistant message renders V2 MessageHeader (.cm-msg-head + .cm-avatar.cm-av-asst)', async ({
    page,
  }) => {
    await newChatSession(page);
    await sendChat(page, 'say hi in five words');

    // Wait for the assistant meta row to appear — fires as soon as the
    // assistant message starts streaming.
    const metaRow = page
      .locator('[data-testid="assistant-meta-row"]')
      .first();
    await expect(metaRow).toBeVisible({ timeout: 60_000 });

    // V2 anatomy assertions.
    await expect(metaRow.locator('.cm-msg-head')).toHaveCount(1);
    await expect(metaRow.locator('.cm-avatar.cm-av-asst')).toHaveCount(1);
    // Modern Claude.ai style: assistant variant has NO display name (the
    // avatar block + model pill carry the signal). Sub-agent variants
    // (c/g/s/k) render .cm-name; .cm-av-asst does not.
    await expect(metaRow.locator('.cm-name')).toHaveCount(0);

    // Per-message cost pill MUST be gone (topbar pill is the SoT).
    await expect(metaRow.locator('.cost-pill')).toHaveCount(0);
    await expect(metaRow.locator('[data-testid="cost-pill"]')).toHaveCount(0);
  });

  test('topbar session cost pill is mounted (cost moved from per-message)', async ({ page }) => {
    // The TopbarCostPill should be visible from the moment chat boots —
    // it aggregates session cost across all messages. No prompt needed.
    await page.getByRole('textbox', { name: 'Chat message input' }).waitFor({ state: 'visible', timeout: 30_000 });
    const pill = page.locator('[data-testid="topbar-cost-pill"]').first();
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await expect(pill).toHaveClass(/cm-cost-pill/);
    // The dollar amount span should always render (initial: $0.00).
    await expect(pill.locator('.cm-amount')).toBeVisible();
  });

  test('assistant avatar matches mock 01 size (28×28 rounded)', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'one short sentence please');
    const avatar = page.locator('.cm-avatar.cm-av-asst').first();
    await expect(avatar).toBeVisible({ timeout: 60_000 });
    const box = await avatar.boundingBox();
    expect(box, 'avatar should have a bounding box').not.toBeNull();
    // Mock spec: 28×28. Allow ±1px for fractional rendering.
    expect(box!.width).toBeGreaterThanOrEqual(27);
    expect(box!.width).toBeLessThanOrEqual(29);
    expect(box!.height).toBeGreaterThanOrEqual(27);
    expect(box!.height).toBeLessThanOrEqual(29);
  });
});
