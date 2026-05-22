/**
 * Playwright E2E — Multi-Agent Research Team end-to-end (Slice F + #63 + #73 + #76)
 *
 * Asserts:
 *   1. Templates page loads, Multi-Agent Research Team is visible.
 *   2. Copying it opens the editor (canvas with nodes).
 *   3. Per-slot model picker is visible on the multi_agent node.
 *   4. Saved viewport persists between page reloads.
 *   5. Run pops the trigger-inputs wizard (topic field).
 *   6. After submitting, the swarm popover appears with cards animating.
 *   7. Final report is rendered without "Please provide the topic" refusal.
 *
 * Auth: relies on saved Azure-AD MFA session in .auth/user.json. Run
 *   `npx playwright test --project=auth-setup` once to populate.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TEMPLATE_NAME = /Multi[-\s]?Agent Research Team/i;

test.describe('Flows — Multi-Agent swarm popover + per-slot model + viewport', () => {
  test.setTimeout(180_000);

  test('end-to-end: copy template, configure, run, see swarm + report', async ({ page }) => {
    // ─── Templates list ──────────────────────────────────────────────────
    await page.goto(`${BASE}/workflows`);
    await expect(page).toHaveURL(/\/workflows/);

    // Open the templates panel — UI surfaces it via "Templates" tab/button.
    const templatesLink = page.getByRole('link', { name: /templates/i }).or(
      page.getByRole('button', { name: /templates/i }),
    );
    await templatesLink.first().click();

    const card = page.locator('[data-testid="template-card"], .template-card', {
      hasText: TEMPLATE_NAME,
    });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });

    // Double-click copies the template into the user's workspace.
    await card.first().dblclick();

    // ─── Editor opens ─────────────────────────────────────────────────────
    // ReactFlow renders nodes with role="button" or .react-flow__node — wait
    // for at least one node to mount.
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBeGreaterThan(2); // trigger + 1 multi_agent + 1 output min

    // ─── Per-slot model picker visible (#63) ─────────────────────────────
    // Click the multi_agent node to open the inspector.
    const multiAgentNode = page.locator('.react-flow__node', {
      hasText: /research team|multi[-\s]?agent/i,
    });
    await multiAgentNode.first().click();

    // Inspector → expect at least one slot Model select with "(agent default)"
    await expect(
      page.getByRole('combobox', { name: /model/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('option', { name: /\(agent default\)/i }).first(),
    ).toBeAttached();

    // ─── Viewport persistence (#76) ──────────────────────────────────────
    // Pan the canvas a known amount, reload, confirm camera state survives.
    const canvas = page.locator('.react-flow__pane');
    await canvas.hover();
    await page.mouse.down();
    await page.mouse.move(120, 80);
    await page.mouse.up();

    // Read viewport before reload.
    const before = await page.evaluate(() => {
      return Object.entries(localStorage)
        .filter(([k]) => k.startsWith('openagentic.workflow.viewport.'))
        .map(([k, v]) => [k, v]);
    });
    expect(before.length).toBeGreaterThan(0);

    await page.reload();
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 });

    const after = await page.evaluate(() => {
      return Object.entries(localStorage)
        .filter(([k]) => k.startsWith('openagentic.workflow.viewport.'))
        .map(([k, v]) => [k, v]);
    });
    // Same keys + same values — proves we read on mount instead of refitting.
    expect(after).toEqual(before);

    // ─── Click Run → trigger-inputs wizard pops ──────────────────────────
    const runBtn = page.getByRole('button', { name: /^run$|run flow|execute/i });
    await runBtn.first().click();

    // Wait for either the run-inputs modal (topic field) or direct execution.
    const topicInput = page.getByLabel(/topic/i);
    if (await topicInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await topicInput.fill('Quantum-resistant cryptography for cloud workloads');
      await page.getByRole('button', { name: /run flow/i }).click();
    }

    // ─── Swarm popover appears with cards (Slice F) ─────────────────────
    // The popover renders its slot cards as the engine emits subagent.start.
    const popover = page.locator('[data-swarm-popover="multi-agent"]');
    await expect(popover.first()).toBeVisible({ timeout: 30_000 });

    const cards = popover.first().locator('[data-testid^="subagent-card-"]');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2);

    // ─── Final report — wait for execution_complete ──────────────────────
    await expect(page.locator('text=/execution complete|completed/i').first()).toBeVisible({
      timeout: 120_000,
    });

    // No refusal text in the final output panel.
    const finalOutput = page.locator(
      '[data-testid="execution-output"], .execution-output, .results-panel',
    );
    await expect(finalOutput.first()).toBeVisible();
    const text = await finalOutput.first().textContent();
    expect(text || '').not.toMatch(/please provide the topic/i);
    expect((text || '').length).toBeGreaterThan(200);
  });
});
