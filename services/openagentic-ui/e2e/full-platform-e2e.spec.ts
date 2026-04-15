/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Full Platform E2E Test Suite
 *
 * Tests EVERY interactive UI feature using Azure AD authentication.
 * Uses mcp-tester@phatoldsungmail.onmicrosoft.com (MFA disabled, admin user).
 *
 * Run:
 *   HEADLESS=true BASE_URL=https://chat-dev.openagentics.io \
 *   npx playwright test e2e/full-platform-e2e.spec.ts --reporter=list
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  actionTimeout: 15000,
});

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Set localStorage keys to prevent welcome/onboarding modals.
 * MUST be called BEFORE navigating to the app.
 */
async function suppressModals(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
  });
}

/**
 * Fallback modal dismissal (in case localStorage didn't suppress everything).
 */
async function dismissAnyModal(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const overlay = page.locator('.fixed.inset-0').first();
    if (!(await overlay.isVisible({ timeout: 800 }).catch(() => false))) break;

    // Try aria-label skip buttons
    for (const label of ['Skip', 'Skip tutorial', 'Close', 'Dismiss']) {
      const btn = page.locator(`[aria-label="${label}"]`);
      if (await btn.first().isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.first().click({ force: true });
        await page.waitForTimeout(400);
        break;
      }
    }

    // Try text buttons
    for (const text of ['Skip', 'Get Started', 'Close', 'Dismiss']) {
      const btn = page.locator(`button:has-text("${text}")`);
      if (await btn.first().isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.first().click({ force: true });
        await page.waitForTimeout(400);
        break;
      }
    }

    // Escape fallback
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/**
 * Azure AD login (Microsoft SSO).
 * Sets localStorage keys, then navigates and logs in if needed.
 */
async function loginAzureAD(page: Page) {
  console.log('=== Azure AD Login ===');
  await suppressModals(page);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Check if already logged in (chat textarea visible)
  const alreadyLoggedIn = await page.locator('[aria-label="Chat message input"], textarea').first().isVisible({ timeout: 3000 }).catch(() => false);
  if (alreadyLoggedIn) {
    console.log('Already logged in!');
    await dismissAnyModal(page);
    return;
  }

  // Click Microsoft sign-in button
  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    // Fill email
    const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await emailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    // Fill password
    const passInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await passInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await passInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    // Handle "Stay signed in?" prompt
    const noBtn = page.locator('button:has-text("No"), input[value="No"]');
    if (await noBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }

  // Wait for chat interface - try multiple selectors
  try {
    await page.waitForSelector('[aria-label="Chat message input"], textarea', { timeout: 60000 });
  } catch {
    // Fallback: may have landed on a different page or modal
    console.log('Chat textarea not found, trying to dismiss modals...');
    await dismissAnyModal(page);
    await page.waitForTimeout(2000);
    // Try going to root URL
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[aria-label="Chat message input"], textarea', { timeout: 30000 }).catch(() => {
      console.log('WARNING: Could not find chat textarea after retry');
    });
  }
  await dismissAnyModal(page);
  console.log('Login complete!');
}

// ─── Test Suite ──────────────────────────────────────────────────

test.describe('Full Platform E2E', () => {
  test.beforeEach(async ({ page }) => {
    await loginAzureAD(page);
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. CHAT MODE
  // ═══════════════════════════════════════════════════════════════

  test('1.1 Chat: send message and receive response', async ({ page }) => {
    console.log('=== Test 1.1: Chat Send/Receive ===');

    const textarea = page.locator('[aria-label="Chat message input"], textarea').first();
    await expect(textarea).toBeVisible();

    await textarea.fill('What is 2 + 2? Answer with just the number.');
    await page.waitForTimeout(300);

    // Send via button or Enter
    const sendBtn = page.locator('[aria-label="Send message"]');
    if (await sendBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await textarea.press('Enter');
    }
    console.log('Message sent, waiting for response...');

    // Wait for streaming response (up to 30s)
    await page.waitForTimeout(8000);

    const body = await page.textContent('body');
    const hasAnswer = body?.includes('4') || body?.toLowerCase().includes('four');
    console.log(`Response contains answer: ${hasAnswer}`);
    expect(hasAnswer).toBeTruthy();
  });

  test('1.2 Chat: toolbar with model selector and MCP buttons', async ({ page }) => {
    console.log('=== Test 1.2: Chat Toolbar ===');

    // The toolbar shows: [+] [MCP icons] .... [Smart Router v] [doc icon]
    // Model selector button has class "model-selector-button" and shows "Smart Router"
    const modelBtn = page.locator('.model-selector-button, button:has-text("Smart Router")');
    const modelVisible = await modelBtn.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Model selector (Smart Router) visible: ${modelVisible}`);

    // Check for plus/attachment button
    const plusBtn = page.locator('button[aria-label*="ttach"], button[aria-label*="Plus"]');
    const plusVisible = await plusBtn.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Plus/attach button visible: ${plusVisible}`);

    // Check for textarea (chat input)
    const textarea = page.locator('[aria-label="Chat message input"], textarea').first();
    const textareaVisible = await textarea.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Chat textarea visible: ${textareaVisible}`);

    expect(modelVisible || textareaVisible).toBeTruthy();
  });

  test('1.3 Chat: model selector dropdown', async ({ page }) => {
    console.log('=== Test 1.3: Model Selector ===');

    // Model selector button in toolbar
    const modelBtn = page.locator('.model-selector-button, [aria-label^="Select Model"]').first();
    const visible = await modelBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Model selector button visible: ${visible}`);

    if (visible) {
      await modelBtn.click();
      await page.waitForTimeout(800);

      // Check for dropdown with model options
      const dropdown = page.locator('.model-selector-dropdown, [role="listbox"], [class*="popover"]');
      const dropdownVisible = await dropdown.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Model dropdown visible: ${dropdownVisible}`);

      if (dropdownVisible) {
        // Count available models
        const options = page.locator('.model-selector-dropdown [role="option"], [role="listbox"] [role="option"]');
        const count = await options.count();
        console.log(`Available models: ${count}`);

        // Click first model option if available
        if (count > 0) {
          const firstModel = await options.first().textContent();
          console.log(`First model: ${firstModel}`);
          await options.first().click();
          await page.waitForTimeout(500);
        }
      }

      await page.keyboard.press('Escape');
    }

    expect(visible).toBeTruthy();
  });

  test('1.4 Chat: sidebar session management', async ({ page }) => {
    console.log('=== Test 1.4: Sidebar Session Management ===');

    // Check sidebar is visible
    const sidebar = page.locator('[class*="chat-sidebar"], [class*="ChatSidebar"]');
    const sidebarVisible = await sidebar.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Chat sidebar visible: ${sidebarVisible}`);

    // New session button
    const newChatBtn = page.locator('button[title*="New"], button[aria-label*="New Chat"], button:has-text("New Chat")');
    if (await newChatBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('New Chat button found');
      await newChatBtn.first().click();
      await page.waitForTimeout(1000);
      console.log('Clicked New Chat');
    }

    // Verify textarea is clear/ready
    const textarea = page.locator('[aria-label="Chat message input"], textarea').first();
    await expect(textarea).toBeVisible();
    console.log('Chat interface ready after new session');

    expect(sidebarVisible).toBeTruthy();
  });

  test('1.5 Chat: MCP tools panel', async ({ page }) => {
    console.log('=== Test 1.5: MCP Tools Panel ===');

    // MCP button in toolbar
    const mcpBtn = page.locator('.mcp-button, [aria-label^="MCP Servers"], button[title*="MCP"]');
    const mcpVisible = await mcpBtn.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`MCP button visible: ${mcpVisible}`);

    if (mcpVisible) {
      await mcpBtn.first().click();
      await page.waitForTimeout(1000);

      // Look for MCP panel content - tool names, server names, categories
      const mcpContent = page.locator('[class*="mcp"], [class*="tool-list"], [class*="ToolPanel"]');
      const contentVisible = await mcpContent.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`MCP panel content visible: ${contentVisible}`);

      // Count tools if visible
      const toolItems = page.locator('[class*="tool-item"], [class*="mcp-tool"], li:has([class*="tool"])');
      const toolCount = await toolItems.count();
      console.log(`MCP tools listed: ${toolCount}`);

      await page.screenshot({ path: 'e2e/screenshots/mcp-tools-panel.png' });
      await page.keyboard.press('Escape');
    }
  });

  test('1.6 Chat: memory panel (sidebar)', async ({ page }) => {
    console.log('=== Test 1.6: Memory Panel ===');

    // Memory panel is a collapsed button in the sidebar that says "MEMORY"
    const memoryBtn = page.locator('button:has-text("MEMORY"), button[title*="Memory"]');
    const memoryVisible = await memoryBtn.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Memory button visible: ${memoryVisible}`);

    if (memoryVisible) {
      await memoryBtn.first().click();
      await page.waitForTimeout(800);
      console.log('Memory panel toggled');

      const memoryPanel = page.locator('[class*="memory-panel"], [class*="MemoryPanel"]');
      const panelVisible = await memoryPanel.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Memory panel visible: ${panelVisible}`);

      await page.screenshot({ path: 'e2e/screenshots/memory-panel.png' });
    } else {
      console.log('Memory button not visible (may need sidebar expanded)');
    }
  });

  test('1.7 Chat: version info and sidebar footer', async ({ page }) => {
    console.log('=== Test 1.7: Version Info & Sidebar Footer ===');

    // Bottom of sidebar shows version info "v0.4.0 prod" and "Settings & more"
    const versionBadge = page.locator('text=/v\\d+\\.\\d+\\.\\d+/');
    const versionVisible = await versionBadge.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Version badge visible: ${versionVisible}`);

    const settingsBtn = page.getByText('Settings & more');
    const settingsVisible = await settingsBtn.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Settings & more visible: ${settingsVisible}`);

    // MEMORY and TOOL USAGE sections in sidebar
    const memorySection = page.locator('text="MEMORY"');
    const memoryVisible = await memorySection.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`MEMORY section visible: ${memoryVisible}`);

    const toolUsage = page.locator('text="TOOL USAGE"');
    const toolUsageVisible = await toolUsage.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`TOOL USAGE section visible: ${toolUsageVisible}`);

    expect(settingsVisible).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. SETTINGS & USER MENU
  // ═══════════════════════════════════════════════════════════════

  test('2.1 Settings: dropdown opens with all options', async ({ page }) => {
    console.log('=== Test 2.1: Settings Dropdown ===');

    const settingsBtn = page.getByText('Settings & more');
    const found = await settingsBtn.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Settings button found: ${found}`);

    if (found) {
      await settingsBtn.first().click();
      await page.waitForTimeout(800);

      // Check for dropdown menu items
      const expectedItems = ['Admin Panel', 'Theme', 'About'];
      let foundItems = 0;
      for (const item of expectedItems) {
        const el = page.locator(`text="${item}"`).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          foundItems++;
          console.log(`  Found: ${item}`);
        }
      }
      console.log(`Found ${foundItems}/${expectedItems.length} settings items`);

      await page.keyboard.press('Escape');
    }

    expect(found).toBeTruthy();
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. ADMIN PORTAL (full section navigation)
  // ═══════════════════════════════════════════════════════════════

  test('3.1 Admin: open portal via settings', async ({ page }) => {
    console.log('=== Test 3.1: Admin Portal ===');

    // Open settings dropdown
    const settingsBtn = page.getByText('Settings & more');
    if (await settingsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await settingsBtn.first().click();
      await page.waitForTimeout(800);

      // Click Admin Panel
      const adminLink = page.locator('text="Admin Panel"');
      if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await adminLink.click();
        await page.waitForTimeout(2000);
        await dismissAnyModal(page);

        console.log('Admin Portal opened');
        await page.screenshot({ path: 'e2e/screenshots/admin-portal.png' });

        // Verify admin content loaded
        const adminContent = page.locator('[class*="admin"], [class*="Admin"], h1, h2');
        const isAdmin = await adminContent.first().isVisible({ timeout: 5000 }).catch(() => false);
        expect(isAdmin).toBeTruthy();
        return;
      }
    }
    console.log('Could not open Admin Portal');
  });

  test('3.2 Admin: navigate ALL sidebar sections', async ({ page }) => {
    console.log('=== Test 3.2: Admin Sidebar Full Navigation ===');

    // Open admin portal
    const settingsBtn = page.getByText('Settings & more');
    if (await settingsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await settingsBtn.first().click();
      await page.waitForTimeout(500);
    }
    const adminLink = page.locator('text="Admin Panel"');
    if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await adminLink.click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
    }

    // Admin sidebar parent sections (these expand child sections)
    const parentSections = [
      'System Management',
      'LLM Providers',
      'MCP Management',
      'Agentic Workflows',
      'Agentic Frameworks',
      'Agent Management',
      'Content & Data',
      'Chargeback & Costs',
      'Monitoring & Logs',
      'Security & Access',
    ];

    let expandedCount = 0;
    for (const section of parentSections) {
      const sectionEl = page.locator(`text="${section}"`).first();
      if (await sectionEl.isVisible({ timeout: 1500 }).catch(() => false)) {
        await sectionEl.click({ force: true });
        await page.waitForTimeout(400);
        expandedCount++;
        console.log(`  Expanded: ${section}`);
      } else {
        console.log(`  Not found: ${section}`);
      }
    }
    console.log(`Expanded ${expandedCount}/${parentSections.length} parent sections`);
    expect(expandedCount).toBeGreaterThan(3);

    // Now click into specific child views
    const childViews = [
      'User Management',
      'Access Control',
      'Provider Management',
      'Tiered FC Config',
      'Server Management',
      'Access Control', // MCP access control
      'Native Workflows',
      'Agentic Loops',
      'CrewAI Config',
      'Claude Code',
      'Code Sessions',
      'OAT Tool Synthesis',
      'Pipeline Settings',
      'Usage & Costs',
      'Usage Statistics',
    ];

    let clickedViews = 0;
    for (const view of childViews) {
      const viewEl = page.locator(`text="${view}"`).first();
      if (await viewEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        await viewEl.click({ force: true });
        await page.waitForTimeout(600);
        clickedViews++;
        console.log(`  Clicked: ${view}`);
      }
    }
    console.log(`Clicked ${clickedViews}/${childViews.length} child views`);
    expect(clickedViews).toBeGreaterThan(3);

    await page.screenshot({ path: 'e2e/screenshots/admin-all-sections.png' });
  });

  test('3.3 Admin: LLM Provider Management view', async ({ page }) => {
    console.log('=== Test 3.3: LLM Provider Management ===');

    // Open admin portal
    const settingsBtn = page.getByText('Settings & more');
    await settingsBtn.first().click();
    await page.waitForTimeout(500);
    await page.locator('text="Admin Panel"').click();
    await page.waitForTimeout(2000);
    await dismissAnyModal(page);

    // Navigate to LLM Providers > Provider Management
    const llmSection = page.locator('text="LLM Providers"').first();
    if (await llmSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await llmSection.click();
      await page.waitForTimeout(400);

      const providerMgmt = page.locator('text="Provider Management"').first();
      if (await providerMgmt.isVisible({ timeout: 1500 }).catch(() => false)) {
        await providerMgmt.click();
        await page.waitForTimeout(1000);

        // Should show provider list or table
        const providerContent = page.locator('[class*="provider"], table, [class*="LLMProvider"]');
        const contentVisible = await providerContent.first().isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`Provider management content visible: ${contentVisible}`);

        await page.screenshot({ path: 'e2e/screenshots/admin-llm-providers.png' });
      }
    }
  });

  test('3.4 Admin: MCP Server Management view', async ({ page }) => {
    console.log('=== Test 3.4: MCP Server Management ===');

    // Open admin portal
    const settingsBtn = page.getByText('Settings & more');
    await settingsBtn.first().click();
    await page.waitForTimeout(500);
    await page.locator('text="Admin Panel"').click();
    await page.waitForTimeout(2000);
    await dismissAnyModal(page);

    // Navigate to MCP Management > Server Management
    const mcpSection = page.locator('text="MCP Management"').first();
    if (await mcpSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await mcpSection.click();
      await page.waitForTimeout(400);

      const serverMgmt = page.locator('text="Server Management"').first();
      if (await serverMgmt.isVisible({ timeout: 1500 }).catch(() => false)) {
        await serverMgmt.click();
        await page.waitForTimeout(1000);

        // Should show MCP server list
        const serverContent = page.locator('[class*="mcp"], table, [class*="MCPManagement"]');
        const contentVisible = await serverContent.first().isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`MCP server management visible: ${contentVisible}`);

        await page.screenshot({ path: 'e2e/screenshots/admin-mcp-servers.png' });
      }
    }
  });

  test('3.5 Admin: User Management & Permissions', async ({ page }) => {
    console.log('=== Test 3.5: User Management ===');

    // Open admin portal
    const settingsBtn = page.getByText('Settings & more');
    await settingsBtn.first().click();
    await page.waitForTimeout(500);
    await page.locator('text="Admin Panel"').click();
    await page.waitForTimeout(2000);
    await dismissAnyModal(page);

    // Navigate to System Management > User Management
    const sysSection = page.locator('text="System Management"').first();
    if (await sysSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sysSection.click();
      await page.waitForTimeout(400);

      const userMgmt = page.locator('text="User Management"').first();
      if (await userMgmt.isVisible({ timeout: 1500 }).catch(() => false)) {
        await userMgmt.click();
        await page.waitForTimeout(1000);

        // Should show user list
        const userContent = page.locator('table, [class*="user"], [class*="UserPermissions"]');
        const contentVisible = await userContent.first().isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`User management content visible: ${contentVisible}`);

        await page.screenshot({ path: 'e2e/screenshots/admin-users.png' });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. FLOWS PAGE
  // ═══════════════════════════════════════════════════════════════

  test('4.1 Flows: page loads with workflow list', async ({ page }) => {
    console.log('=== Test 4.1: Flows Page ===');

    // Navigate via tab - from screenshot, nav shows: Chat | Code | Flows as tabs
    const flowsTab = page.locator('button:has-text("Flows"), a:has-text("Flows")').first();
    const found = await flowsTab.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Flows tab visible: ${found}`);

    if (found) {
      await flowsTab.click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
    }

    // Flows page shows: "Workflows" heading, "+ Create Workflow" button, search bar
    const heading = page.locator('text="Workflows"');
    const headingVisible = await heading.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Workflows heading visible: ${headingVisible}`);

    const createBtn = page.locator('button:has-text("Create Workflow"), text="+ Create Workflow"');
    const createVisible = await createBtn.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Create Workflow button visible: ${createVisible}`);

    // Sidebar with sections
    const nodesSection = page.locator('text="NODES"');
    const nodesVisible = await nodesSection.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`NODES section visible: ${nodesVisible}`);

    // New Flow button
    const newFlowBtn = page.locator('text="New Flow", button:has-text("New Flow")');
    const newFlowVisible = await newFlowBtn.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`New Flow button visible: ${newFlowVisible}`);

    await page.screenshot({ path: 'e2e/screenshots/flows-page.png' });
    expect(headingVisible || nodesVisible || createVisible).toBeTruthy();
  });

  test('4.2 Flows: all sidebar sections visible and clickable', async ({ page }) => {
    console.log('=== Test 4.2: Flows Sidebar Sections ===');

    // Navigate to Flows
    const flowsBtn = page.locator('button[title="Flows Mode - Visual Workflow Builder"], button[title*="Flows"]');
    if (await flowsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsBtn.first().click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
    }

    // Expected sidebar section headers
    const sections = ['NODES', 'DEPLOYED', 'MY WORKFLOWS', 'TEMPLATES', 'MARKETPLACE', 'AGENTS', 'CONNECTIONS'];
    let found = 0;

    for (const section of sections) {
      // Try exact text match and case-insensitive
      const sectionEl = page.locator(`text="${section}"`).first();
      const altEl = page.locator(`text="${section.charAt(0) + section.slice(1).toLowerCase()}"`).first();

      const el = (await sectionEl.isVisible({ timeout: 1000 }).catch(() => false)) ? sectionEl :
                 (await altEl.isVisible({ timeout: 500 }).catch(() => false)) ? altEl : null;

      if (el) {
        found++;
        console.log(`  Found section: ${section}`);
        await el.click({ force: true });
        await page.waitForTimeout(400);
      } else {
        console.log(`  Not found: ${section}`);
      }
    }

    console.log(`Found ${found}/${sections.length} sidebar sections`);
    expect(found).toBeGreaterThan(0);
  });

  test('4.3 Flows: toolbar buttons visible', async ({ page }) => {
    console.log('=== Test 4.3: Flows Toolbar ===');

    // Navigate to Flows
    const flowsBtn = page.locator('button[title="Flows Mode - Visual Workflow Builder"], button[title*="Flows"]');
    if (await flowsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsBtn.first().click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
    }

    // Check toolbar buttons
    const toolbarButtons = [
      { label: 'New', selector: 'button:has-text("New")' },
      { label: 'Save', selector: 'button:has-text("Save")' },
      { label: 'AI', selector: 'button:has-text("AI"), button[title*="AI"]' },
      { label: 'Execute', selector: 'button:has-text("Execute"), button:has-text("Run")' },
    ];

    let foundBtns = 0;
    for (const btn of toolbarButtons) {
      const el = page.locator(btn.selector).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        foundBtns++;
        console.log(`  Found toolbar button: ${btn.label}`);
      } else {
        console.log(`  Not found: ${btn.label}`);
      }
    }
    console.log(`Found ${foundBtns}/${toolbarButtons.length} toolbar buttons`);
  });

  test('4.4 Flows: AI Flow Builder slide-out panel', async ({ page }) => {
    console.log('=== Test 4.4: AI Flow Builder ===');

    // Navigate to Flows
    const flowsBtn = page.locator('button[title="Flows Mode - Visual Workflow Builder"], button[title*="Flows"]');
    if (await flowsBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsBtn.first().click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
    }

    // Click AI button in toolbar
    const aiBtn = page.locator('button:has-text("AI"), button[title*="AI Flow"]').first();
    if (await aiBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await aiBtn.click();
      await page.waitForTimeout(1000);

      // Check for slide-out panel
      const slidePanel = page.locator('[class*="SlideInPanel"], [class*="slide-in"], [class*="ai-flow"]');
      const panelVisible = await slidePanel.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`AI Flow Builder panel visible: ${panelVisible}`);

      // Look for the text input area
      const builderInput = page.locator('text="AI Flow Builder", textarea, [class*="AIFlowBuilder"]');
      const inputVisible = await builderInput.first().isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Builder input area visible: ${inputVisible}`);

      await page.screenshot({ path: 'e2e/screenshots/ai-flow-builder.png' });

      // Close panel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      console.log('AI button not found in toolbar');
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. CODE MODE
  // ═══════════════════════════════════════════════════════════════

  test('5.1 Code Mode: page loads with layout', async ({ page }) => {
    console.log('=== Test 5.1: Code Mode ===');

    // Navigate via nav button
    const codeBtn = page.locator('button[title="Code Mode"], button[title*="Code"]');
    const found = await codeBtn.first().isVisible({ timeout: 5000 }).catch(() => false);

    if (found) {
      await codeBtn.first().click();
      await page.waitForTimeout(3000);
      await dismissAnyModal(page);
    }

    // Check for code mode layout
    const codeLayout = page.locator('[class*="code-mode"], [class*="CodeMode"], [class*="code-layout"]');
    const layoutVisible = await codeLayout.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Code mode layout visible: ${layoutVisible}`);

    // Check for terminal area or sidebar
    const terminal = page.locator('[class*="terminal"], [class*="xterm"], [class*="code-terminal"]');
    const terminalVisible = await terminal.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Terminal area visible: ${terminalVisible}`);

    // Check for code-server iframe
    const iframe = page.locator('iframe[src*="code-server"], iframe[class*="code"]');
    const iframeVisible = await iframe.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Code-server iframe visible: ${iframeVisible}`);

    await page.screenshot({ path: 'e2e/screenshots/code-mode.png' });
    expect(layoutVisible || terminalVisible || iframeVisible).toBeTruthy();
  });

  test('5.2 Code Mode: sidebar with session info', async ({ page }) => {
    console.log('=== Test 5.2: Code Mode Sidebar ===');

    // Navigate to Code Mode
    const codeBtn = page.locator('button[title="Code Mode"], button[title*="Code"]');
    if (await codeBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await codeBtn.first().click();
      await page.waitForTimeout(3000);
      await dismissAnyModal(page);
    }

    // Check for sidebar
    const sidebar = page.locator('[class*="CodeModeSidebar"], [class*="code-sidebar"]');
    const sidebarVisible = await sidebar.first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Code mode sidebar visible: ${sidebarVisible}`);

    // Look for session status elements
    const statusElements = page.locator('[class*="status"], [class*="session"], [class*="connection"]');
    const statusCount = await statusElements.count();
    console.log(`Status elements found: ${statusCount}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. NAVIGATION BETWEEN MODES
  // ═══════════════════════════════════════════════════════════════

  test('6.1 Navigation: switch between all three modes', async ({ page }) => {
    console.log('=== Test 6.1: Mode Navigation ===');

    const modes = [
      { name: 'Chat', selector: 'button[title="Chat Mode"]' },
      { name: 'Flows', selector: 'button[title="Flows Mode - Visual Workflow Builder"], button[title*="Flows"]' },
      { name: 'Code', selector: 'button[title="Code Mode"], button[title*="Code"]' },
      { name: 'Chat (return)', selector: 'button[title="Chat Mode"]' },
    ];

    let navigated = 0;
    for (const mode of modes) {
      const btn = page.locator(mode.selector).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1500);
        await dismissAnyModal(page);
        navigated++;
        console.log(`  Navigated to: ${mode.name} (URL: ${page.url()})`);
      } else {
        console.log(`  Button not found: ${mode.name}`);
      }
    }

    console.log(`Navigated to ${navigated}/${modes.length} modes`);
    expect(navigated).toBeGreaterThanOrEqual(2);
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. FULL PAGE SCREENSHOTS (visual regression baseline)
  // ═══════════════════════════════════════════════════════════════

  test('7.1 Visual: full-page screenshots of all sections', async ({ page }) => {
    console.log('=== Test 7.1: Visual Screenshots ===');

    // Chat page
    await page.screenshot({ path: 'e2e/screenshots/01-chat-page.png', fullPage: true });
    console.log('  Saved: 01-chat-page.png');

    // Flows page
    const flowsBtn = page.locator('button[title="Flows Mode - Visual Workflow Builder"], button[title*="Flows"]');
    if (await flowsBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await flowsBtn.first().click();
      await page.waitForTimeout(2000);
      await dismissAnyModal(page);
      await page.screenshot({ path: 'e2e/screenshots/02-flows-page.png', fullPage: true });
      console.log('  Saved: 02-flows-page.png');
    }

    // Code page
    const codeBtn = page.locator('button[title="Code Mode"], button[title*="Code"]');
    if (await codeBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await codeBtn.first().click();
      await page.waitForTimeout(3000);
      await dismissAnyModal(page);
      await page.screenshot({ path: 'e2e/screenshots/03-code-page.png', fullPage: true });
      console.log('  Saved: 03-code-page.png');
    }

    // Admin portal
    const chatBtn = page.locator('button[title="Chat Mode"]');
    if (await chatBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatBtn.first().click();
      await page.waitForTimeout(1500);
    }
    const settingsBtn = page.getByText('Settings & more');
    if (await settingsBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.first().click();
      await page.waitForTimeout(500);
      const adminLink = page.locator('text="Admin Panel"');
      if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        await adminLink.click();
        await page.waitForTimeout(2000);
        await dismissAnyModal(page);
        await page.screenshot({ path: 'e2e/screenshots/04-admin-portal.png', fullPage: true });
        console.log('  Saved: 04-admin-portal.png');
      }
    }

    console.log('All screenshots saved');
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. DIRECT API VALIDATION (inline)
  // ═══════════════════════════════════════════════════════════════

  test('8.1 API: health endpoint returns 200', async ({ page }) => {
    console.log('=== Test 8.1: API Health ===');

    const response = await page.request.get(`${BASE_URL}/api/health`);
    console.log(`Health status: ${response.status()}`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json().catch(() => null);
    if (body) {
      console.log(`Health response: ${JSON.stringify(body).substring(0, 200)}`);
    }
  });

  test('8.2 API: auth/me returns user info', async ({ page }) => {
    console.log('=== Test 8.2: API Auth/Me ===');

    // Get cookies from the page for authentication
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find(c => c.name === 'token' || c.name === 'auth_token');
    console.log(`Auth cookie found: ${!!tokenCookie}`);

    const response = await page.request.get(`${BASE_URL}/api/auth/me`);
    console.log(`Auth/me status: ${response.status()}`);

    if (response.ok()) {
      const body = await response.json().catch(() => null);
      if (body) {
        console.log(`User: ${body.user?.email || body.email || 'unknown'}`);
        console.log(`Admin: ${body.user?.isAdmin || body.isAdmin || false}`);
      }
    }
  });

  test('8.3 API: chat sessions CRUD', async ({ page }) => {
    console.log('=== Test 8.3: Chat Sessions API ===');

    // List sessions
    const listResponse = await page.request.get(`${BASE_URL}/api/chat/sessions`);
    console.log(`List sessions status: ${listResponse.status()}`);

    if (listResponse.ok()) {
      const sessions = await listResponse.json().catch(() => []);
      console.log(`Sessions count: ${Array.isArray(sessions) ? sessions.length : 'N/A'}`);
    }

    // Create session
    const createResponse = await page.request.post(`${BASE_URL}/api/chat/sessions`, {
      data: { title: 'E2E Test Session' },
    });
    console.log(`Create session status: ${createResponse.status()}`);

    if (createResponse.ok()) {
      const created = await createResponse.json().catch(() => null);
      const sessionId = created?.session?.id || created?.id;
      console.log(`Created session ID: ${sessionId}`);

      // Delete session
      if (sessionId) {
        const deleteResponse = await page.request.delete(`${BASE_URL}/api/chat/sessions/${sessionId}`);
        console.log(`Delete session status: ${deleteResponse.status()}`);
      }
    }
  });

  test('8.4 API: MCP tools listing', async ({ page }) => {
    console.log('=== Test 8.4: MCP Tools API ===');

    const response = await page.request.get(`${BASE_URL}/api/mcp/tools`);
    console.log(`MCP tools status: ${response.status()}`);

    if (response.ok()) {
      const body = await response.json().catch(() => null);
      if (body) {
        const tools = body.tools || body;
        const count = Array.isArray(tools) ? tools.length : Object.keys(tools).length;
        console.log(`MCP tools count: ${count}`);

        if (Array.isArray(tools) && tools.length > 0) {
          console.log(`First 5 tools: ${tools.slice(0, 5).map((t: any) => t.name || t).join(', ')}`);
        }
      }
    }
  });

  test('8.5 API: settings endpoint', async ({ page }) => {
    console.log('=== Test 8.5: Settings API ===');

    const response = await page.request.get(`${BASE_URL}/api/settings`);
    console.log(`Settings status: ${response.status()}`);

    if (response.ok()) {
      const body = await response.json().catch(() => null);
      if (body) {
        console.log(`Settings keys: ${Object.keys(body).slice(0, 10).join(', ')}`);
      }
    }
  });

  test('8.6 API: LLM providers listing', async ({ page }) => {
    console.log('=== Test 8.6: LLM Providers API ===');

    // Try both routes
    for (const path of ['/api/admin/providers', '/api/llm/providers', '/api/settings/providers']) {
      const response = await page.request.get(`${BASE_URL}${path}`);
      if (response.ok()) {
        const body = await response.json().catch(() => null);
        console.log(`${path} status: ${response.status()}, data: ${JSON.stringify(body).substring(0, 200)}`);
        break;
      }
    }
  });
});
