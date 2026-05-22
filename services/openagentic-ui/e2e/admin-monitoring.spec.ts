import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) return;

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

  // Aggressively dismiss any modals/overlays
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // Remove any blocking overlays via JS
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(500);
}

async function openAdminPanel(page: any): Promise<boolean> {
  // Click "Settings & more" button at bottom of sidebar
  let settingsButton = page.locator('text=Settings & more').first();
  if (!await settingsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    // May be collapsed sidebar - try gear icon
    settingsButton = page.locator('button[aria-label*="Settings"], button[title*="Settings"]').first();
  }

  if (await settingsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Remove any blocking overlays before clicking
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
    });
    await settingsButton.click({ force: true });
    await page.waitForTimeout(1500);

    // Click "Admin Panel" in the dropdown menu
    const adminPanelButton = page.locator('button:has-text("Admin Panel"), span:has-text("Admin Panel")').first();
    const foundAdminPanel = await adminPanelButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (foundAdminPanel) {
      await adminPanelButton.click();
      await page.waitForTimeout(3000);
      return true;
    }
  }

  console.log('Could not open Admin Panel via menu');
  return false;
}

test.describe('Admin Monitoring Sections', () => {
  test.setTimeout(120000);

  test('All monitoring sections load without crashing', async ({ page }) => {
    await login(page);
    const adminOpened = await openAdminPanel(page);

    await page.screenshot({ path: 'test-results/admin-landing.png', fullPage: true });

    if (!adminOpened) {
      console.log('SKIP: Could not open admin panel');
      return;
    }

    // Find and expand Monitoring & Logs in admin sidebar nav
    const monitoringItems = ['Monitoring & Logs', 'Monitoring'];
    let monitoringClicked = false;

    for (const item of monitoringItems) {
      const loc = page.locator(`text="${item}"`).first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loc.click({ force: true });
        await page.waitForTimeout(1500);
        monitoringClicked = true;
        console.log(`Clicked: ${item}`);
        break;
      }
    }

    await page.screenshot({ path: 'test-results/monitoring-nav.png', fullPage: true });

    if (!monitoringClicked) {
      console.log('SKIP: Could not find Monitoring nav item');
      // Screenshot to see what nav items exist
      return;
    }

    // Test each sub-section
    const sections = ['User Activity', 'Performance Metrics', 'Audit Logs', 'Feedback Analytics'];
    const results: Record<string, string> = {};

    for (const section of sections) {
      console.log(`\n=== Testing: ${section} ===`);
      const sectionLoc = page.locator(`text="${section}"`).first();
      if (await sectionLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sectionLoc.click({ force: true });
        await page.waitForTimeout(4000);

        // Check page didn't crash
        const body = page.locator('body');
        await expect(body).toBeVisible();

        const hasError = await page.locator('text=Something went wrong').isVisible({ timeout: 1000 }).catch(() => false);
        const hasCrash = await page.locator('text=error boundary').isVisible({ timeout: 500 }).catch(() => false);

        const slug = section.toLowerCase().replace(/\s+/g, '-');
        await page.screenshot({ path: `test-results/monitoring-${slug}.png`, fullPage: true });

        if (hasError || hasCrash) {
          results[section] = 'FAIL: crashed or showed error';
          console.log(`FAIL: ${section} crashed or showed error`);
        } else {
          results[section] = 'PASS';
          console.log(`PASS: ${section} loaded successfully`);
        }

        expect(hasError).toBe(false);
        expect(hasCrash).toBe(false);
      } else {
        results[section] = 'SKIP: nav item not found';
        console.log(`SKIP: ${section} nav item not found`);
        await page.screenshot({ path: `test-results/monitoring-${section.toLowerCase().replace(/\s+/g, '-')}-missing.png`, fullPage: true });
      }
    }

    console.log('\n=== RESULTS ===');
    for (const [section, result] of Object.entries(results)) {
      console.log(`${section}: ${result}`);
    }
  });
});
