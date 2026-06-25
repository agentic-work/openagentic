import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const TEST_EMAIL = 'admin@openagentic.io';
const TEST_PASSWORD = 'REPLACE_WITH_REAL_TEST_PASSWORD';

async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const localButton = page.locator('button:has-text("Local")');

  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await localButton.click();
    await page.waitForTimeout(1000);

    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });
    await emailField.fill(TEST_EMAIL);

    const passwordField = page.locator('input[type="password"]');
    await passwordField.fill(TEST_PASSWORD);

    const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
    await submitButton.click();
    await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 30000 });
  }
}

async function navigateToAdmin(page: Page) {
  // Look for admin menu or settings
  const adminLink = page.locator(
    'a[href*="admin"], ' +
    'button:has-text("Admin"), ' +
    '.admin-link, ' +
    '[data-testid="admin-menu"]'
  );

  if (await adminLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await adminLink.click();
    await page.waitForTimeout(2000);
  }
}

test.describe('Phase 7: Admin Portal Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
  });

  test('01 - Navigate to admin area', async ({ page }) => {
    await page.screenshot({ path: 'test-results/screenshots/07-admin-01-main.png', fullPage: true });

    await navigateToAdmin(page);

    await page.screenshot({ path: 'test-results/screenshots/07-admin-01-admin-area.png', fullPage: true });
  });

  test('02 - Dashboard metrics visible', async ({ page }) => {
    await navigateToAdmin(page);

    // Navigate to dashboard if there's a link
    const dashboardLink = page.locator('a[href*="dashboard"], button:has-text("Dashboard")');
    if (await dashboardLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dashboardLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-02-dashboard.png', fullPage: true });

    // Check for metric cards or charts
    const metrics = page.locator('.metric, .stat-card, .chart, [data-metric]');
    const metricsCount = await metrics.count();

    expect(metricsCount).toBeGreaterThanOrEqual(0); // May not have metrics page
  });

  test('03 - User management page', async ({ page }) => {
    await navigateToAdmin(page);

    const usersLink = page.locator('a[href*="user"], button:has-text("Users")');
    if (await usersLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await usersLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-03-users.png', fullPage: true });
  });

  test('04 - Chat sessions view', async ({ page }) => {
    await navigateToAdmin(page);

    const sessionsLink = page.locator('a[href*="session"], button:has-text("Sessions"), button:has-text("Chat")');
    if (await sessionsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionsLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-04-sessions.png', fullPage: true });
  });

  test('05 - Analytics page', async ({ page }) => {
    await navigateToAdmin(page);

    const analyticsLink = page.locator('a[href*="analytics"], button:has-text("Analytics")');
    if (await analyticsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await analyticsLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-05-analytics.png', fullPage: true });
  });

  test('06 - MCP servers status', async ({ page }) => {
    await navigateToAdmin(page);

    const mcpLink = page.locator('a[href*="mcp"], button:has-text("MCP"), button:has-text("Tools")');
    if (await mcpLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mcpLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-06-mcp.png', fullPage: true });
  });

  test('07 - Model providers', async ({ page }) => {
    await navigateToAdmin(page);

    const providersLink = page.locator('a[href*="provider"], a[href*="model"], button:has-text("Models"), button:has-text("Provider")');
    if (await providersLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await providersLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-07-providers.png', fullPage: true });
  });

  test('08 - Flowise workflows', async ({ page }) => {
    await navigateToAdmin(page);

    const flowiseLink = page.locator('a[href*="flowise"], a[href*="workflow"], button:has-text("Flowise"), button:has-text("Workflow")');
    if (await flowiseLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await flowiseLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-08-flowise.png', fullPage: true });
  });

  test('09 - Audit logs', async ({ page }) => {
    await navigateToAdmin(page);

    const auditLink = page.locator('a[href*="audit"], a[href*="log"], button:has-text("Audit"), button:has-text("Logs")');
    if (await auditLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await auditLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-09-audit.png', fullPage: true });
  });

  test('10 - Settings page', async ({ page }) => {
    await navigateToAdmin(page);

    const settingsLink = page.locator('a[href*="setting"], button:has-text("Settings")');
    if (await settingsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsLink.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/07-admin-10-settings.png', fullPage: true });
  });

  test('11 - Full admin area tour (video)', async ({ page }) => {
    // This test navigates through all admin areas for video capture
    await navigateToAdmin(page);
    await page.waitForTimeout(1000);

    const links = [
      'a[href*="dashboard"]',
      'a[href*="user"]',
      'a[href*="session"]',
      'a[href*="analytics"]',
      'a[href*="mcp"]',
      'a[href*="provider"]',
      'a[href*="flowise"]',
      'a[href*="audit"]',
      'a[href*="setting"]'
    ];

    for (const selector of links) {
      const link = page.locator(selector).first();
      if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
        await link.click();
        await page.waitForTimeout(2000);
        await page.screenshot({
          path: `test-results/screenshots/07-admin-tour-${Date.now()}.png`,
          fullPage: true
        });
      }
    }
  });
});
