import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    // Dismiss onboarding
    await page.waitForTimeout(1500);
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(1000);
    }
    for (let i = 0; i < 3; i++) {
      try { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch {}
    }
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
  await page.waitForTimeout(1500);
  const skipBtn = page.locator('button:has-text("Skip")');
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(1000);
  }
  for (let i = 0; i < 3; i++) {
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch {}
  }
}

test('Drag and drop node onto canvas', async ({ page }) => {
  test.setTimeout(120000);

  // Capture console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });

  await login(page);

  // Navigate to Flows
  const flowsBtn = page.locator('button:has-text("Flows")').first();
  await flowsBtn.click();
  await page.waitForTimeout(3000);

  // Create new flow
  const newFlowBtn = page.locator('button:has-text("New Flow")').first();
  await expect(newFlowBtn).toBeVisible({ timeout: 10000 });
  await newFlowBtn.click();
  await page.waitForTimeout(3000);

  // Take screenshot of canvas state
  await page.screenshot({ path: '/tmp/before-drag.png' });
  console.log('Canvas state before drag saved to /tmp/before-drag.png');

  // Open node palette drawer
  const nodesBtn = page.locator('button:has-text("Nodes")').first();
  await expect(nodesBtn).toBeVisible({ timeout: 5000 });
  await nodesBtn.click();
  await page.waitForTimeout(1000);

  // Verify drawer opened
  const drawerTitle = page.locator('text=Node Palette');
  await expect(drawerTitle).toBeVisible({ timeout: 5000 });
  console.log('Node Palette drawer opened');

  // Find a palette item to drag (e.g., first one visible)
  const paletteItem = page.locator('.wf-palette-item').first();
  await expect(paletteItem).toBeVisible({ timeout: 5000 });
  const itemText = await paletteItem.textContent();
  console.log(`Dragging palette item: ${itemText?.trim()}`);

  // Find the ReactFlow canvas area (the drop target)
  const canvas = page.locator('.react-flow__pane').first();
  await expect(canvas).toBeVisible({ timeout: 5000 });
  console.log('Canvas pane found');

  // Get positions
  const itemBox = await paletteItem.boundingBox();
  const canvasBox = await canvas.boundingBox();
  console.log(`Palette item: x=${itemBox?.x}, y=${itemBox?.y}`);
  console.log(`Canvas: x=${canvasBox?.x}, y=${canvasBox?.y}, w=${canvasBox?.width}, h=${canvasBox?.height}`);

  if (!itemBox || !canvasBox) {
    console.log('ERROR: Could not get bounding boxes');
    return;
  }

  // Calculate drop target (center of canvas)
  const dropX = canvasBox.x + canvasBox.width / 2;
  const dropY = canvasBox.y + canvasBox.height / 2;

  // Perform drag and drop using mouse events
  // Start drag from palette item
  await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);

  // Move to canvas center in steps
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = itemBox.x + (dropX - itemBox.x) * (i / steps);
    const y = itemBox.y + (dropY - itemBox.y) * (i / steps);
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(1000);

  // Check for errors
  console.log(`Console errors: ${consoleErrors.length}`);
  consoleErrors.forEach(e => console.log(`  ERROR: ${e}`));

  // Try HTML5 drag and drop API instead
  console.log('\n--- Trying HTML5 drag and drop ---');

  // Re-open drawer if it closed
  if (!(await drawerTitle.isVisible().catch(() => false))) {
    await nodesBtn.click();
    await page.waitForTimeout(1000);
  }

  // Use the dataTransfer API
  const paletteItem2 = page.locator('.wf-palette-item').first();
  const canvasPane = page.locator('.react-flow__pane').first();

  // Simulate HTML5 drag and drop
  await paletteItem2.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('application/reactflow', JSON.stringify({
      type: 'trigger',
      label: 'Manual Trigger',
      description: 'Start flow manually',
      icon: '⚡',
      color: '#ff9800',
      category: 'trigger',
      defaultData: { label: 'Manual Trigger', triggerType: 'manual' },
    }));

    const dragStartEvent = new DragEvent('dragstart', { dataTransfer: dt, bubbles: true });
    el.dispatchEvent(dragStartEvent);
  });

  await page.waitForTimeout(200);

  // Dispatch dragover on canvas to allow drop
  await canvasPane.evaluate((el) => {
    const dt = new DataTransfer();
    const dragOverEvent = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(dragOverEvent);
  });

  await page.waitForTimeout(100);

  // Dispatch drop on canvas
  const dropResult = await canvasPane.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('application/reactflow', JSON.stringify({
      type: 'trigger',
      label: 'Manual Trigger',
      description: 'Start flow manually',
      icon: '⚡',
      color: '#ff9800',
      category: 'trigger',
      defaultData: { label: 'Manual Trigger', triggerType: 'manual' },
    }));

    const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 500, clientY: 400 });
    const result = el.dispatchEvent(dropEvent);
    return result;
  });

  console.log(`Drop event dispatched: ${dropResult}`);
  await page.waitForTimeout(2000);

  // Check if a node appeared on the canvas
  const nodes = page.locator('.react-flow__node');
  const nodeCount = await nodes.count();
  console.log(`Nodes on canvas after drop: ${nodeCount}`);

  // Check for errors after drop
  const newErrors = consoleErrors.filter(e => !e.includes('DEPRECATED'));
  if (newErrors.length > 0) {
    console.log('\nPost-drop errors:');
    newErrors.forEach(e => console.log(`  ${e}`));
  }

  // Take screenshot
  await page.screenshot({ path: '/tmp/after-drag.png' });
  console.log('After-drag screenshot saved to /tmp/after-drag.png');

  // Final assertion
  if (nodeCount > 0) {
    console.log('\n=== DRAG AND DROP WORKS ===');
  } else {
    console.log('\n=== DRAG AND DROP FAILED - no nodes on canvas ===');
    // Check for React error boundary
    const errorBoundary = page.locator('text=Something went wrong');
    if (await errorBoundary.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('React error boundary triggered!');
      await page.screenshot({ path: '/tmp/react-crash.png' });
    }
  }
});
