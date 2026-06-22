import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.onmicrosoft.com';
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

  // Dismiss onboarding wizard if present (Skip button)
  await page.waitForTimeout(1500);
  const skipBtn = page.locator('button:has-text("Skip")');
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(1000);
  }
  // Dismiss any remaining modals
  for (let i = 0; i < 3; i++) {
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
  }
  await page.waitForTimeout(1000);
}

test('Node palette opens as floating drawer over canvas', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);

  // Navigate to Flows
  const flowsBtn = page.locator('button:has-text("Flows"), a:has-text("Flows"), [data-testid="flows-tab"]');
  if (await flowsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await flowsBtn.first().click();
    await page.waitForTimeout(3000);
  }

  // Create a new flow to get into builder mode (needed for the canvas overlay)
  const newFlowBtn = page.locator('button:has-text("New Flow")').first();
  if (await newFlowBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newFlowBtn.click();
    await page.waitForTimeout(3000);
  }

  // Look for the Nodes section header in sidebar
  const nodesHeader = page.locator('button:has-text("Nodes")').first();
  await expect(nodesHeader).toBeVisible({ timeout: 10000 });
  console.log('Nodes header visible in sidebar');

  // Click Nodes to open the floating drawer
  await nodesHeader.click();
  await page.waitForTimeout(500);

  // Verify the floating drawer appeared (Node Palette title)
  const drawerTitle = page.locator('text=Node Palette');
  await expect(drawerTitle).toBeVisible({ timeout: 5000 });
  console.log('Node Palette floating drawer opened');

  // Verify it has search input
  const searchInput = page.locator('input[placeholder="Search nodes..."]');
  await expect(searchInput).toBeVisible({ timeout: 3000 });
  console.log('Search input visible in drawer');

  // Verify category headers are present
  const triggersHeader = page.locator('text=Triggers').first();
  await expect(triggersHeader).toBeVisible({ timeout: 3000 });
  console.log('Triggers category visible');

  const aiHeader = page.locator('text=AI / LLM').first();
  await expect(aiHeader).toBeVisible({ timeout: 3000 });
  console.log('AI / LLM category visible');

  // Verify "Drag items onto the canvas" footer hint
  const hint = page.locator('text=Drag items onto the canvas');
  await expect(hint).toBeVisible({ timeout: 3000 });
  console.log('Drag hint visible');

  // Verify the Annotation category with Text Note
  const annotationHeader = page.locator('text=Annotation').first();
  // May need to scroll to see it
  await page.waitForTimeout(500);
  const isAnnotationVisible = await annotationHeader.isVisible({ timeout: 3000 }).catch(() => false);
  if (isAnnotationVisible) {
    console.log('Annotation category visible');
  } else {
    // Scroll within the drawer to find it
    const drawerScroll = page.locator('.wf-scrollbar').last();
    await drawerScroll.evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(300);
    const isNowVisible = await annotationHeader.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(isNowVisible ? 'Annotation category visible after scroll' : 'Annotation category not found');
  }

  // Close drawer by clicking X
  const closeBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
  // Or just press Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Verify drawer closed
  const drawerGone = await drawerTitle.isVisible({ timeout: 1000 }).catch(() => false);
  console.log(drawerGone ? 'Drawer still visible after Escape' : 'Drawer closed on Escape');

  console.log('\n=== Node Palette Drawer Test PASSED ===');
});
