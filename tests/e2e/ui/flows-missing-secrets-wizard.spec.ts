/**
 * Playwright E2E — Missing-secrets wizard (#73)
 *
 * Acceptance:
 *   1. Open a flow that references {{secret:NEEDS_VALUE_X}}
 *   2. Click Run
 *   3. Wizard pops listing the missing secret(s) with masked input
 *   4. Cancel closes without creating any secret
 *   5. Submit POSTs to /admin/workflow-secrets and re-fires Run
 *
 * Auth: depends on .auth/user.json (Azure-AD MFA captured once via
 *   `npx playwright test --project=auth-setup`).
 *
 * Requires test fixture flow: `e2e-secrets-wizard-fixture` with a
 * single mcp_tool node that uses `{{secret:E2E_TEST_SECRET}}` in a
 * config field. The test creates this flow via the API on start
 * and tears it down on end so it never persists.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const TEST_SECRET_NAME = 'E2E_MISSING_SECRET_TEST';

test.describe('Flows — Missing-secrets wizard (#73)', () => {
  test.setTimeout(120_000);

  test('pops wizard, accepts a value, saves, re-runs', async ({ page }) => {
    // ─── Setup: create a fixture flow via API ────────────────────────────
    const api = await playwrightRequest.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
      ignoreHTTPSErrors: true,
    });

    // Sanity-check we have a session (auth-setup ran).
    const me = await api.get('/api/auth/me');
    expect(me.ok(), 'auth-setup must have populated .auth/user.json').toBeTruthy();

    const create = await api.post('/api/workflows', {
      data: {
        name: 'e2e-secrets-wizard-fixture',
        description: 'Auto-created by Playwright; safe to delete.',
        definition: {
          nodes: [
            { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { triggerType: 'manual' } },
            {
              id: 'http',
              type: 'http_request',
              position: { x: 250, y: 0 },
              data: {
                url: 'https://example.com',
                headers: { 'X-Auth': `{{secret:${TEST_SECRET_NAME}}}` },
              },
            },
          ],
          edges: [{ id: 'e1', source: 't', target: 'http' }],
        },
      },
    });
    expect(create.ok()).toBeTruthy();
    const wf = await create.json();
    const workflowId = wf?.workflow?.id || wf?.id;
    expect(workflowId).toBeTruthy();

    try {
      await page.goto(`${BASE}/workflows/${workflowId}`);
      await page.waitForSelector('.react-flow__node', { timeout: 30_000 });

      // Click Run — the gate should pop the missing-secrets wizard.
      const runBtn = page.getByRole('button', { name: /^run$|run flow|execute/i });
      await runBtn.first().click();

      // Wizard appears.
      const wizard = page.locator('[data-testid="missing-secrets-wizard"]');
      await expect(wizard).toBeVisible({ timeout: 10_000 });

      // Field for our test secret is rendered, type=password.
      const field = page.getByLabel(TEST_SECRET_NAME) as ReturnType<typeof page.getByLabel>;
      await expect(field).toBeVisible();
      await expect(field).toHaveAttribute('type', 'password');

      // Save & Run is disabled until the field is filled.
      const saveBtn = page.getByRole('button', { name: /save & run/i });
      await expect(saveBtn).toBeDisabled();
      await field.fill('e2e-test-token-value');
      await expect(saveBtn).toBeEnabled();

      await saveBtn.click();

      // Wizard closes.
      await expect(wizard).not.toBeVisible({ timeout: 10_000 });

      // Run proceeds — execution panel surfaces the SSE stream.
      // We don't wait for completion (the http_request will fail at
      // example.com, that's fine — we just want proof the gate
      // resolved + the run actually fired).
      await expect(
        page.locator('text=/running|completed|failed|execution/i').first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      // ─── Teardown: delete the fixture flow + the secret we created ─────
      await api.delete(`/api/workflows/${workflowId}`).catch(() => {});
      // Best-effort secret cleanup — find by name and delete.
      const list = await api.get(`/api/admin/workflow-secrets?search=${TEST_SECRET_NAME}`);
      if (list.ok()) {
        const data = await list.json();
        for (const s of data?.secrets || []) {
          if (s?.name === TEST_SECRET_NAME) {
            await api.delete(`/api/admin/workflow-secrets/${s.id}`).catch(() => {});
          }
        }
      }
      await api.dispose();
    }
  });
});
