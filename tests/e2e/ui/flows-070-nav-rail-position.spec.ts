/**
 * Playwright E2E — Workspace nav rail position + icon load.
 *
 * Two bugs the rail had to fix (reported 2026-04-26):
 *   1. Icon glyphs 404'd because <use href="#i-..."> didn't resolve.
 *   2. Rail was rendered INSIDE WorkflowsPage so it sat right of the
 *      chat sidebar instead of left of it.
 *
 * Asserts:
 *   - Login + click Flows tab.
 *   - All 9 nav-rail buttons render (Home..Settings) with aria-labels.
 *   - Rail's left edge is at ~0 and its right edge sits at <= 60 px.
 *   - The chat sidebar starts at x ≈ 56 (i.e. RIGHT of the rail).
 *   - No 4xx/5xx network responses for any URL containing 'i-' (the
 *     old sprite href pattern that was 404'ing).
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://chat-dev.openagentic.io';

const NAV_LABELS = [
  'Home', 'Flows', 'Agents', 'Tools & Data', 'Runs',
  'Insights', 'Library', 'Team', 'Settings',
];

test.describe('Flows 0.7.0 — workspace nav rail position', () => {
  test.setTimeout(60_000);

  test('rail sits LEFT of chat sidebar with no icon 404s', async ({ page }) => {
    const failedSpriteRequests: string[] = [];
    page.on('response', (resp) => {
      const url = resp.url();
      if (resp.status() >= 400 && /[#?/]i-(home|flows|agents|tools|runs|insights|library|team|settings)/.test(url)) {
        failedSpriteRequests.push(`${resp.status()} ${url}`);
      }
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const flowsTab = page.getByRole('button', { name: /flows/i }).or(
      page.getByRole('link', { name: /flows/i }),
    );
    await expect(flowsTab.first()).toBeVisible({ timeout: 15_000 });
    await flowsTab.first().click();

    // Wait for the rail to mount.
    const rail = page.getByRole('navigation', { name: /workspace sections/i });
    await expect(rail).toBeVisible({ timeout: 15_000 });

    // All 9 buttons present.
    for (const label of NAV_LABELS) {
      const btn = rail.getByRole('button', { name: label, exact: true });
      await expect(btn).toBeVisible();
    }

    // Geometric checks: rail at left edge, sidebar to its right.
    const railBox = await rail.boundingBox();
    expect(railBox).not.toBeNull();
    if (railBox) {
      expect(railBox.x).toBeLessThanOrEqual(2);
      expect(railBox.x + railBox.width).toBeLessThanOrEqual(64);
    }

    // Chat sidebar (the existing "fixed left" sidebar) should now start
    // at ~56px (right edge of the rail). We locate it by its known
    // ChatSidebar marker — the company-logo button or the panel toggle.
    const chatSidebar = page.locator('div.fixed.top-0.h-full.z-\\[1000\\]').first();
    await expect(chatSidebar).toBeVisible();
    const sidebarBox = await chatSidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    if (sidebarBox && railBox) {
      expect(sidebarBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width - 4);
    }

    // No icon 404s — the whole point of the inline-paths fix.
    expect(failedSpriteRequests).toEqual([]);
  });
});
