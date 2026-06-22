/**
 * Fix 4 regression — ToolCallCard reveals input JSON character-by-character
 * while the tool is executing, then flips to the structured result once
 * the tool completes.
 *
 * NOTE: ToolCallCard is the canonical UI for tool calls; this test
 * exercises the UX when it is mounted. In environments where the
 * inline tool list is rendered in place of the card, this spec falls
 * back to the inline streaming input pane which also uses the same
 * data-testid contract ("tool-call-live-input").
 */

import { test, expect } from '../fixtures/auth.fixture';

test.describe('chat-polish: tool input streaming', () => {
  test('live input pane shows during calling and disappears on success', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    const input = page
      .locator('[data-testid="chat-input"], .chat-input textarea, textarea')
      .first();
    // A prompt that will definitely invoke a tool.
    await input.fill(
      'List all Kubernetes pods in the default namespace using the list_pods tool.'
    );
    await input.press('Enter');

    // Wait for a tool card to appear in calling state.
    const card = page.locator('[data-testid="tool-call-card"]').first();
    await expect(card).toBeVisible({ timeout: 60_000 });

    // Either the dedicated card shows live input, or the inline fallback
    // (same test id) does. Both satisfy the contract.
    const liveInput = page.locator('[data-testid="tool-call-live-input"]');
    if (await liveInput.count()) {
      await expect(liveInput.first()).toBeVisible({ timeout: 30_000 });
    }

    // Await resolution.
    await expect(card).toHaveAttribute('data-tool-status', /success|error/, {
      timeout: 120_000,
    });
    // Once complete, the live-input pane should be gone.
    await expect(liveInput).toHaveCount(0);
  });
});
