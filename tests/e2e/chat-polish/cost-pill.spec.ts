/**
 * Fix 2 regression — CostPill consumes cost_delta during streaming and
 * pulses on each update (pulse-key attribute ticks), then settles into
 * the authoritative "$X.XX" (no tilde) after stream end.
 */

import { test, expect } from '../fixtures/auth.fixture';

test.describe('chat-polish: cost pill streaming', () => {
  test('shows ~$ prefix while streaming, pulse-key ticks, exact $ after done', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    const input = page
      .locator('[data-testid="chat-input"], .chat-input textarea, textarea')
      .first();
    // A prompt that will produce a substantial response so cost deltas flow.
    await input.fill(
      'Write a 300-word essay about the economics of AI inference. Include 2 short paragraphs.'
    );
    await input.press('Enter');

    // Wait for the streaming pill to appear.
    const pill = page.locator('[data-testid="cost-pill"]').last();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText(/~\$/, { timeout: 30_000 });

    // Capture first pulse key, then wait for it to tick at least once.
    const initialKey = Number(await pill.getAttribute('data-pulse-key') ?? '0');
    await page.waitForFunction(
      ([selector, initial]) => {
        const el = document.querySelector(selector as string);
        const k = Number(el?.getAttribute('data-pulse-key') ?? '0');
        return k > Number(initial);
      },
      ['[data-testid="cost-pill"]', initialKey],
      { timeout: 30_000 }
    );

    // After stream ends, pill should flip to non-tilde authoritative form.
    await expect(pill).not.toContainText(/~\$/, { timeout: 90_000 });
    await expect(pill).toContainText(/^\$/);
  });
});
