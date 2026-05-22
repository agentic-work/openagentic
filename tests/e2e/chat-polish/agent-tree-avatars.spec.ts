/**
 * Fix 5 regression — UnifiedActivityTree agent nodes render with avatars
 * (first-letter + hash-colored background), turn count, and collapse on
 * avatar click.
 */

import { test, expect } from '../fixtures/auth.fixture';

test.describe('chat-polish: agent tree avatars + collapse', () => {
  test('sub-agent card shows avatar, turn count; avatar click collapses', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    const input = page
      .locator('[data-testid="chat-input"], .chat-input textarea, textarea')
      .first();
    // Trigger multi-agent orchestration — "Bob" cloud-ops is the anchor.
    await input.fill(
      'Spawn 2 sub-agents to audit my Azure resource groups and list idle VMs. Coordinate their results.'
    );
    await input.press('Enter');

    const agent = page.locator('[data-testid="agent-card"]').first();
    await expect(agent).toBeVisible({ timeout: 120_000 });

    // Avatar is a button with a one-character label.
    const avatar = agent.locator('[data-testid="agent-avatar"]');
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveText(/^[A-Z0-9]$/);

    // Turn count label exists and reads "N turn(s)".
    await expect(agent.locator('[data-testid="agent-turn-count"]')).toHaveText(
      /\d+ turns?/,
    );

    // Click avatar → data-collapsed flips to "true".
    await expect(agent).toHaveAttribute('data-collapsed', 'false');
    await avatar.click();
    await expect(agent).toHaveAttribute('data-collapsed', 'true');
  });
});
