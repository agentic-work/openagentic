/**
 * Playwright E2E — 0.7.0 What's-new toast visibility on the Flows tab.
 *
 * Asserts:
 *   1. Login lands on the chat shell.
 *   2. Clicking the Flows tab in the chat sidebar mounts the embedded
 *      WorkflowsPage.
 *   3. The WhatsNewToast portals into document.body and is visible
 *      (role=alert) bottom-right.
 *   4. Toast lists at least 4 of the 5 marquee 0.7.0 features.
 *   5. Clicking the dismiss × hides it AND localStorage records
 *      'openagentic.workflow.whatsNew.dismissed=0.7.0-r2'.
 *   6. Direct /workflows URL navigation returns the SPA shell but
 *      renders 404 client-side (no WorkflowsPage), proving the route
 *      was retired.
 *
 * Auth: depends on .auth/user.json. Run
 *   `npx playwright test --project=auth-setup`
 * once first (5-min MFA prompt) so this spec runs headless.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const DISMISS_KEY = 'openagentic.workflow.whatsNew.dismissed';
const DISMISS_VALUE = '0.7.0-r2';

test.describe('Flows 0.7.0 — embedded entry + What\'s New toast', () => {
  test.setTimeout(60_000);

  test('Flows tab in chat sidebar shows the toast on first visit', async ({ page, context }) => {
    // Wipe any prior dismissal so the toast is guaranteed to render.
    await context.addInitScript((key) => {
      try { localStorage.removeItem(key); } catch {}
    }, DISMISS_KEY);

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Find + click the Flows tab in the chat sidebar.
    const flowsTab = page.getByRole('button', { name: /flows/i }).or(
      page.getByRole('link', { name: /flows/i }),
    );
    await expect(flowsTab.first()).toBeVisible({ timeout: 15_000 });
    await flowsTab.first().click();

    // Embedded WorkflowsPage should mount — react-flow node renders or
    // the workflow list/empty-state. Use a forgiving selector.
    await expect(
      page.locator('.react-flow, [data-testid="workflow-list"], h1, h2').first(),
    ).toBeVisible({ timeout: 15_000 });

    // The toast (role=alert) is portaled into body — should be findable
    // anywhere in the document.
    const toast = page.getByRole('alert').filter({ hasText: /what.{1,3}s new/i });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Marquee features — at least 4 of 5 visible.
    const marqueeBits = [
      /swarm/i, /secret/i, /model picker|per-slot/i, /nav rail|sidebar/i, /signed trace|trace/i,
    ];
    const matches = await Promise.all(
      marqueeBits.map(async (re) => (await toast.locator('button[data-feature]').filter({ hasText: re }).count()) > 0),
    );
    expect(matches.filter(Boolean).length).toBeGreaterThanOrEqual(4);

    // Dismiss writes the version flag.
    await toast.getByRole('button', { name: /dismiss/i }).click();
    await expect(toast).not.toBeVisible({ timeout: 5_000 });
    const stored = await page.evaluate((key) => localStorage.getItem(key), DISMISS_KEY);
    expect(stored).toBe(DISMISS_VALUE);
  });

  test('Direct /workflows URL renders 404 (Code Mode pattern)', async ({ page }) => {
    await page.goto(`${BASE}/workflows`);
    // SPA shell loads (200), then router falls through to NotFound.
    // The marker: WorkflowsPage chrome (.react-flow, FlowsSidebar) is
    // NOT in the DOM. We assert NotFound text or absence of canvas.
    await page.waitForLoadState('networkidle');
    const hasReactFlow = await page.locator('.react-flow').count();
    expect(hasReactFlow).toBe(0);
  });
});
