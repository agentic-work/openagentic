/**
 * Fix 1 regression — Thinking block header shows "Thought for X.Xs · ~N tokens"
 * and is collapsed by default.
 *
 * Targets chat-dev.openagentic.io with the mcp-tester auth state. Runs after
 * `auth.setup.ts` populates .auth/user.json.
 */

import { test, expect } from '../fixtures/auth.fixture';

test.describe('chat-polish: thinking block', () => {
  test('header starts "Thinking..." then settles to "Thought for X.Xs · ~N tokens", body collapsed by default', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // A deliberately open-ended analytical prompt to nudge the model into
    // producing an interleaved thinking block.
    const input = page
      .locator('[data-testid="chat-input"], .chat-input textarea, textarea')
      .first();
    await input.fill(
      'Think step by step about how many Boeing 747s can fit inside Yankee Stadium. Show your reasoning.'
    );
    await input.press('Enter');

    const thinking = page.locator('[data-testid="inline-thinking-block"]').first();
    await expect(thinking).toBeVisible({ timeout: 30_000 });

    // While streaming, the header starts with the live "Thinking..." label.
    const header = thinking.locator('[data-testid="inline-thinking-header"]');
    await expect(header).toHaveText(/Thinking\.\.\./);

    // Body is collapsed by default during streaming.
    expect(await thinking.getAttribute('data-expanded')).toBe('false');

    // Wait until header transitions to the final metric form.
    await expect(header).toHaveText(/Thought for \d+(\.\d+)?s · ~\d+ tokens/, {
      timeout: 90_000,
    });

    // Expand and verify body becomes visible.
    await thinking.locator('[data-testid="inline-thinking-toggle"]').click();
    await expect(thinking).toHaveAttribute('data-expanded', 'true');
    await expect(thinking.locator('[data-testid="inline-thinking-body"]')).toBeVisible();
  });
});
