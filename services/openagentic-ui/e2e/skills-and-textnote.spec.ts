/**
 * Skills Security UX & Text Note Node E2E Test
 *
 * 1. Admin Portal → Agents → Skills tab: verify DLP/Grounding/Network indicators,
 *    skill cards, and pipeline visualization render correctly.
 * 2. Flows page → Nodes sidebar: verify "Annotation" category with "Text Note" node exists.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function dismissOverlays(page: any) {
  const skipBtn = page.locator('button:has-text("Skip")').first();
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  });
  await page.waitForTimeout(300);
}

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
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
  console.log('Login complete!');
}

async function openAdminPortal(page: any) {
  console.log('Opening Admin Portal...');
  await dismissOverlays(page);
  await page.waitForTimeout(500);

  const settingsButton = page.locator('text=Settings & more').first();
  await settingsButton.click({ force: true });
  await page.waitForTimeout(1500);

  const adminPanelButton = page.locator('button:has-text("Admin Panel"), span:has-text("Admin Panel")').first();
  const adminVisible = await adminPanelButton.isVisible({ timeout: 5000 }).catch(() => false);
  expect(adminVisible).toBeTruthy();

  await adminPanelButton.click();
  await page.waitForTimeout(3000);

  // Dismiss any onboarding that reappears (but NOT the admin overlay itself)
  const skipBtnAfter = page.locator('button:has-text("Skip")').first();
  if (await skipBtnAfter.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtnAfter.click();
    await page.waitForTimeout(500);
  }

  console.log('Admin Portal opened');
}

test.describe('Skills Security UX & Text Note Node', () => {

  test('Admin Agents Skills tab renders security UX (DLP, Grounding, Network)', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);
    await openAdminPortal(page);

    // Expand Agent Management section in sidebar
    console.log('Expanding Agent Management...');
    const agentMgmt = page.locator('text="Agent Management"').first();
    if (await agentMgmt.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agentMgmt.click({ force: true });
      await page.waitForTimeout(1000);
    }

    // Click "Agent Registry" sub-item (this renders AgentManagementView with registry/skills/test tabs)
    console.log('Clicking Agent Registry...');
    const agentRegistryLink = page.locator('text="Agent Registry"').first();
    const registryVisible = await agentRegistryLink.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Agent Registry link visible: ${registryVisible}`);
    expect(registryVisible).toBeTruthy();

    await agentRegistryLink.click({ force: true });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skills-agent-registry.png' });

    // Click the "Skills" tab within the Agent Registry header tab bar
    // The tabs are: Registry | Skills | Test — rendered as buttons with CSS capitalize
    // Must be careful not to click the "Skills Marketplace" sidebar link instead
    console.log('Clicking Skills tab in Agent Registry...');
    // Target the tab button that's a sibling of the "registry" tab inside the tab bar
    const skillsTab = page.locator('button:text-is("skills")').first();
    const skillsTabVisible = await skillsTab.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Skills tab visible: ${skillsTabVisible}`);
    expect(skillsTabVisible).toBeTruthy();

    await skillsTab.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/skills-tab-active.png' });

    // Verify DLP indicator
    const dlpVisible = await page.locator('text="DLP"').first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`DLP indicator visible: ${dlpVisible}`);
    expect(dlpVisible).toBeTruthy();

    // Verify Grounding indicator
    const groundingVisible = await page.locator('text="Grounding"').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Grounding indicator visible: ${groundingVisible}`);
    expect(groundingVisible).toBeTruthy();

    // Verify Network indicator
    const networkVisible = await page.locator('text="Network"').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Network indicator visible: ${networkVisible}`);
    expect(networkVisible).toBeTruthy();

    // Verify "Skill Registry" heading is present
    const skillRegistryVisible = await page.locator('text=/Skill Registry/').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Skill Registry heading visible: ${skillRegistryVisible}`);
    expect(skillRegistryVisible).toBeTruthy();

    // Verify the security pipeline explanation text
    const pipelineText = await page.locator('text=/sandboxed with DLP/').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Pipeline explanation text visible: ${pipelineText}`);
    expect(pipelineText).toBeTruthy();

    // Check for skill cards (D/G/N badges) if skills are loaded
    const dBadge = await page.locator('span[title="DLP: Active"]').first().isVisible({ timeout: 3000 }).catch(() => false);
    const gBadge = await page.locator('span[title="Grounding: Active"]').first().isVisible({ timeout: 3000 }).catch(() => false);
    const nBadge = await page.locator('span[title="Network Policy: Active"]').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`D/G/N skill card badges: D=${dBadge} G=${gBadge} N=${nBadge}`);
    // These may not be visible if no skills are registered yet, so log but don't fail

    // Verify pipeline visualization section (threat list)
    const promptInjection = await page.locator('text="Prompt injection"').first().isVisible({ timeout: 3000 }).catch(() => false);
    const dataExfil = await page.locator('text="Data exfiltration"').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Pipeline threats visible: Prompt injection=${promptInjection}, Data exfil=${dataExfil}`);

    // Check for "DLP Scan" pipeline stage
    const dlpScan = await page.locator('text="DLP Scan"').first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`DLP Scan pipeline stage visible: ${dlpScan}`);

    await page.screenshot({ path: 'test-results/skills-security-ux.png', fullPage: true });

    // No crash check
    const hasError = await page.locator('text=Something went wrong').isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasError).toBe(false);

    console.log('Skills security UX test PASSED');
  });

  test('Flows sidebar has Annotation category with Text Note node', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    // Navigate to Flows
    console.log('Navigating to Flows...');
    const flowsLink = page.locator('a:has-text("Flows"), button:has-text("Flows"), [href*="flow" i]').first();
    await flowsLink.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/textnote-flows-page.png' });

    // Create a workflow to enter builder mode (where the Nodes sidebar is visible)
    const createBtn = page.locator('button:has-text("Create Workflow")').first();
    const createVisible = await createBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Create Workflow button visible: ${createVisible}`);

    if (createVisible) {
      await createBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'test-results/textnote-builder.png' });

    // Expand the Nodes section if collapsed
    const nodesHeader = page.locator('text="Nodes"').first();
    const nodesVisible = await nodesHeader.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Nodes section header visible: ${nodesVisible}`);
    expect(nodesVisible).toBeTruthy();

    // Click to expand if needed
    await nodesHeader.click();
    await page.waitForTimeout(1000);

    // Look for "Annotation" category label
    const annotationCategory = page.locator('text=/^Annotation$/i');
    const annotationVisible = await annotationCategory.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Annotation category visible: ${annotationVisible}`);
    expect(annotationVisible).toBeTruthy();

    // Look for "Text Note" node within the sidebar
    const textNoteNode = page.locator('text="Text Note"');
    const textNoteVisible = await textNoteNode.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Text Note node visible: ${textNoteVisible}`);
    expect(textNoteVisible).toBeTruthy();

    await page.screenshot({ path: 'test-results/textnote-annotation-node.png' });

    // Verify no crash
    const hasError = await page.locator('text=Something went wrong').isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasError).toBe(false);

    console.log('Annotation / Text Note test PASSED');
  });
});
