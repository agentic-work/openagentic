/**
 * Fix 3 regression — Shiki code block highlights incrementally while
 * streaming and freezes into a final render on close.
 */

import { test, expect } from '../fixtures/auth.fixture';

test.describe('chat-polish: code block incremental highlighting', () => {
  test('code block appears with data-streaming=true, then flips to false on close', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    const input = page
      .locator('[data-testid="chat-input"], .chat-input textarea, textarea')
      .first();
    await input.fill(
      'Write a Python script (at least 40 lines) that implements a FIFO queue using a linked list. Wrap in ```python```.'
    );
    await input.press('Enter');

    const block = page.locator('[data-testid="enhanced-shiki-code-block"]').first();
    await expect(block).toBeVisible({ timeout: 60_000 });

    // While streaming, data-streaming = 'true'
    await expect(block).toHaveAttribute('data-streaming', 'true', { timeout: 60_000 });
    // And language was detected
    await expect(block).toHaveAttribute('data-language', 'python');

    // Once complete, data-streaming = 'false'
    await expect(block).toHaveAttribute('data-streaming', 'false', { timeout: 120_000 });

    // Auto-scroll happened during streaming (scrollTop > 0 on final render
    // is not meaningful once complete, so skip assertion). Final <pre> has
    // at least one Shiki span — i.e. highlighting applied.
    const spanCount = await block.locator('pre code span').count();
    expect(spanCount).toBeGreaterThan(5);
  });
});
