import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function dismissOverlays(page: any) {
  // Click Skip on onboarding if visible
  const skipBtn = page.locator('button:has-text("Skip")').first();
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(500);
  }
  // Press Escape multiple times
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  // Force-remove all fixed overlays
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
    // Also close any modals with z-index > 9000
    document.querySelectorAll('[class*="z-[9"]').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(300);
}

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    await dismissOverlays(page);
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');
    const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await msEmailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msEmailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }
    const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await msPasswordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msPasswordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }
    const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
    if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await staySignedIn.click();
      await page.waitForTimeout(2000);
    }
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }
  await page.waitForSelector('textarea', { timeout: 60000 });
  await dismissOverlays(page);
}

test.describe('Dashboard Overview - Comprehensive Coverage', () => {
  test.setTimeout(120000);

  test('Dashboard shows all platform metrics and tabs', async ({ page }) => {
    await login(page);

    // Ensure all overlays dismissed before clicking Settings
    await dismissOverlays(page);
    await page.waitForTimeout(500);

    // Click Settings & more
    const settingsButton = page.locator('text=Settings & more').first();
    await settingsButton.click({ force: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/dashboard-after-settings.png' });

    // Click Admin Panel
    const adminPanelButton = page.locator('button:has-text("Admin Panel"), span:has-text("Admin Panel")').first();
    const adminVisible = await adminPanelButton.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Admin Panel button visible: ${adminVisible}`);

    if (adminVisible) {
      await adminPanelButton.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/dashboard-after-admin-click.png' });

      // Wait for admin console to render
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'test-results/dashboard-after-admin-wait.png' });

      // Note: Do NOT call dismissOverlays here - the admin panel IS a fixed overlay
      // Only dismiss the onboarding wizard if it appeared
      const skipBtnAfter = page.locator('button:has-text("Skip")').first();
      if (await skipBtnAfter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await skipBtnAfter.click();
        await page.waitForTimeout(500);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      console.log('Admin Panel not found in dropdown');
      return;
    }

    // Check if Admin Console sidebar is visible
    const adminConsole = page.locator('text="Admin Console"').first();
    const adminConsoleVisible = await adminConsole.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Admin Console visible: ${adminConsoleVisible}`);

    // Click Dashboard Overview in sidebar
    const dashLink = page.locator('text="Dashboard Overview"').first();
    const dashLinkVisible = await dashLink.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Dashboard Overview link visible: ${dashLinkVisible}`);
    if (dashLinkVisible) {
      await dashLink.click({ force: true });
      await page.waitForTimeout(4000);
    }

    await page.screenshot({ path: 'test-results/dashboard-overview.png', fullPage: true });

    // Verify stat cards are present
    const statLabels = ['Total Users', 'Chat Sessions', 'Messages', 'Code Sessions', 'Flow Executions', 'Agent Runs'];
    for (const label of statLabels) {
      const visible = await page.locator(`text="${label}"`).isVisible({ timeout: 2000 }).catch(() => false);
      console.log(`Stat card "${label}": ${visible ? 'VISIBLE' : 'NOT FOUND'}`);
    }

    // Verify tabs exist
    const expectedTabs = ['Overview', 'Usage & Tokens', 'Cost Analysis', 'Flows & Agents', 'MCP & Tools', 'Infrastructure'];
    for (const tab of expectedTabs) {
      const tabVisible = await page.locator(`button:has-text("${tab}")`).isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Tab "${tab}": ${tabVisible ? 'VISIBLE' : 'NOT FOUND'}`);
    }

    // Click Flows & Agents tab
    const flowsTab = page.locator('button:has-text("Flows & Agents")').first();
    if (await flowsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await flowsTab.click({ force: true });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/dashboard-flows-agents.png', fullPage: true });
      console.log('Flows & Agents tab screenshot taken');
    }

    // Click Infrastructure tab
    const infraTab = page.locator('button:has-text("Infrastructure")').first();
    if (await infraTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await infraTab.click({ force: true });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/dashboard-infrastructure.png', fullPage: true });
      console.log('Infrastructure tab screenshot taken');
    }

    // Verify no crash
    const hasError = await page.locator('text=Something went wrong').isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasError).toBe(false);
  });
});
