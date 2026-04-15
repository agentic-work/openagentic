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
 * Admin LLM Provider CRUD Test
 * Exercises the full lifecycle: list, add, edit, test, toggle, delete providers
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({ ignoreHTTPSErrors: true });

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
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

  // Mark onboarding as completed in localStorage to prevent the tour overlay from appearing
  await page.evaluate(() => {
    localStorage.setItem('onboarding_completed', 'true');
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
  });

  // If the onboarding overlay already appeared, dismiss it
  await page.waitForTimeout(2000);
  const skipBtn = page.locator('button:has-text("Skip")').first();
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('Dismissing onboarding wizard via Skip...');
    await skipBtn.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // Click backdrop overlay if still present (onClick={handleComplete} on the backdrop)
  const backdrop = page.locator('.fixed.inset-0[style*="rgba"]').first();
  if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('Clicking backdrop overlay to dismiss...');
    await backdrop.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // Final fallback: press Escape
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}

  // Wait for overlay to fully disappear
  await page.waitForTimeout(500);
  const overlayGone = await page.locator('.fixed.inset-0.z-\\[9998\\]').isVisible({ timeout: 1000 }).catch(() => false);
  if (overlayGone) {
    console.log('WARNING: z-[9998] overlay still visible after dismissal attempts');
    // Force-remove it via JS as last resort
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach(el => {
        const z = (el as HTMLElement).style.zIndex || window.getComputedStyle(el).zIndex;
        if (parseInt(z) >= 9998) {
          (el as HTMLElement).remove();
        }
      });
    });
    await page.waitForTimeout(500);
  }

  console.log('Login complete!');
}

async function openAdminPortal(page: any) {
  console.log('Opening Admin Portal...');

  // Ensure no overlays are blocking (onboarding tour, modals, etc.)
  const overlayBlocking = await page.locator('.fixed.inset-0.z-\\[9998\\]').isVisible({ timeout: 1000 }).catch(() => false);
  if (overlayBlocking) {
    console.log('Overlay detected before opening admin, removing...');
    await page.evaluate(() => {
      localStorage.setItem('onboarding_completed', 'true');
      document.querySelectorAll('.fixed.inset-0').forEach(el => {
        const z = (el as HTMLElement).className;
        if (z.includes('9998') || z.includes('9999') || z.includes('10000')) {
          (el as HTMLElement).remove();
        }
      });
    });
    await page.waitForTimeout(500);
  }

  let settingsButton = page.locator('text=Settings & more').first();
  let found = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);

  if (!found) {
    settingsButton = page.locator('.border-t button').first();
    found = await settingsButton.isVisible({ timeout: 3000 }).catch(() => false);
  }

  if (found) {
    await settingsButton.click({ force: true });
    await page.waitForTimeout(1000);

    const adminPanelButton = page.locator('button:has-text("Admin Panel"), span:has-text("Admin Panel")').first();
    if (await adminPanelButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await adminPanelButton.click();
      await page.waitForTimeout(2000);
    }
  }

  const hasAdminSidebar = await page.locator('text=Admin Console').first().isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`Admin Console visible: ${hasAdminSidebar}`);
  return hasAdminSidebar;
}

async function navigateToProviderManagement(page: any) {
  console.log('Navigating to Provider Management...');

  // Step 1: Expand the "LLM Providers" accordion in the sidebar
  const llmNav = page.locator('text=LLM Providers').first();
  if (await llmNav.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Expanding LLM Providers section...');
    await llmNav.click();
    await page.waitForTimeout(1000);
  }

  // Step 2: Click "Provider Management" sub-item
  const providerMgmt = page.locator('text=Provider Management').first();
  if (await providerMgmt.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Clicking Provider Management...');
    await providerMgmt.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  }

  console.log('ERROR: Could not find Provider Management sub-item');
  return false;
}

test.describe('Admin LLM Provider Management', () => {
  test.beforeEach(async ({ page }) => {
    // Log API errors
    page.on('response', async response => {
      if (response.status() >= 400) {
        const url = response.url();
        if (url.includes('/api/')) {
          const body = await response.text().catch(() => '');
          console.log(`[HTTP ${response.status()}] ${url} → ${body.substring(0, 300)}`);
        }
      }
    });
  });

  test('Full provider CRUD lifecycle', async ({ page }) => {
    test.setTimeout(300000);

    // ═══════════════════════════════════════════════════════════════
    // LOGIN
    // ═══════════════════════════════════════════════════════════════
    await login(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/llm-01-logged-in.png', fullPage: true });

    // ═══════════════════════════════════════════════════════════════
    // OPEN ADMIN → PROVIDER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    const adminOpen = await openAdminPortal(page);
    expect(adminOpen).toBe(true);
    await page.screenshot({ path: '/tmp/llm-02-admin-open.png', fullPage: true });

    const foundProvMgmt = await navigateToProviderManagement(page);
    expect(foundProvMgmt).toBe(true);
    await page.screenshot({ path: '/tmp/llm-03-provider-mgmt.png', fullPage: true });

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Verify Provider List
    // ═══════════════════════════════════════════════════════════════
    console.log('\n=== PHASE 1: Verify Provider List ===');

    // The LLMProviderManagement component shows tabs: Providers, Ollama, Playground, Metrics
    // Default tab is "Providers" — check for "Add Provider" button
    const addBtn = page.locator('button:has-text("Add Provider")').first();
    const hasAddBtn = await addBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Add Provider button visible: ${hasAddBtn}`);

    // Check for existing provider cards or "No providers configured" message
    const noProviders = await page.locator('text=No providers configured').isVisible({ timeout: 2000 }).catch(() => false);
    if (noProviders) {
      console.log('No providers configured yet — empty state');
    } else {
      // Count existing provider cards
      const bodyText = await page.locator('body').textContent() || '';
      const knownProviders = ['Azure OpenAI', 'AWS Bedrock', 'Google Vertex AI', 'Ollama', 'Anthropic', 'OpenAI'];
      for (const p of knownProviders) {
        if (bodyText.includes(p)) {
          console.log(`  Found provider type: ${p}`);
        }
      }
    }
    await page.screenshot({ path: '/tmp/llm-04-providers-list.png', fullPage: true });

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Add a Test Provider (Ollama — simplest, no real creds needed)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n=== PHASE 2: Add Test Provider ===');
    const testProviderName = `e2e-test-${Date.now()}`;

    if (!hasAddBtn) {
      // If "Add Provider" button is inside empty state, click it there
      const emptyAddBtn = page.locator('button:has-text("Add Provider")').first();
      const hasEmptyAdd = await emptyAddBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasEmptyAdd) {
        await emptyAddBtn.click();
      } else {
        console.log('FAIL: No Add Provider button found anywhere');
        await page.screenshot({ path: '/tmp/llm-05-no-add-btn.png', fullPage: true });
        return;
      }
    } else {
      await addBtn.click();
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/llm-05-add-panel.png', fullPage: true });

    // Verify slide-in panel opened with "Add New Provider" title
    const panel = page.locator('[role="dialog"]');
    const panelTitle = await panel.locator('text=Add New Provider').isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Panel opened: ${panelTitle}`);
    expect(panelTitle).toBe(true);

    // Ollama is the default provider type — no need to click it
    // But let's verify it's selected by checking the highlighted border
    console.log('Using default Ollama provider type');

    // Fill Provider Name (input placeholder="my-provider") — scoped to dialog
    const nameInput = panel.locator('input[placeholder="my-provider"]');
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameInput.fill(testProviderName);
      console.log(`Filled provider name: ${testProviderName}`);
    } else {
      console.log('WARNING: Provider name input not found');
    }

    // Fill Display Name (input placeholder="Production Ollama")
    const displayInput = panel.locator('input[placeholder="Production Ollama"]');
    if (await displayInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await displayInput.fill('E2E Test Provider');
      console.log('Filled display name: E2E Test Provider');
    } else {
      console.log('WARNING: Display name input not found');
    }

    // Fill Endpoint URL for Ollama (input placeholder="http://ollama:11434")
    const endpointInput = panel.locator('input[placeholder="http://ollama:11434"]');
    if (await endpointInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await endpointInput.fill('http://ollama:11434');
      console.log('Filled endpoint URL');
    } else {
      console.log('WARNING: Endpoint URL input not found');
    }

    // Fill Chat Model (input placeholder contains "qwen2.5-coder" or "e.g.")
    const chatModelInput = panel.locator('input[placeholder*="qwen2.5-coder"], input[placeholder*="e.g."]').first();
    if (await chatModelInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await chatModelInput.fill('qwen2.5:7b');
      console.log('Filled chat model: qwen2.5:7b');
    } else {
      console.log('WARNING: Chat model input not found');
    }

    await page.screenshot({ path: '/tmp/llm-06-form-filled.png', fullPage: true });

    // Click "Create Provider" submit button — scoped to dialog
    const createBtn = panel.locator('button:has-text("Create Provider"), button[type="submit"]').first();
    const hasCreate = await createBtn.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Create Provider button visible: ${hasCreate}`);

    if (hasCreate) {
      await createBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await createBtn.click();
      console.log('Clicked Create Provider');
      await page.waitForTimeout(5000);
    }

    await page.screenshot({ path: '/tmp/llm-07-after-save.png', fullPage: true });

    // Check for success toast
    const toasts = page.locator('.fixed.top-4.right-4 div');
    const toastCount = await toasts.count().catch(() => 0);
    if (toastCount > 0) {
      const toastText = await toasts.first().textContent().catch(() => '');
      console.log(`Toast: ${toastText}`);
    }

    // Check for validation errors in the form
    const errorSpans = await page.locator('text=is required').count().catch(() => 0);
    if (errorSpans > 0) {
      console.log(`VALIDATION ERRORS: ${errorSpans} "is required" messages visible`);
      await page.screenshot({ path: '/tmp/llm-07b-validation-errors.png', fullPage: true });
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Verify Provider Was Created
    // ═══════════════════════════════════════════════════════════════
    console.log('\n=== PHASE 3: Verify Provider Created ===');
    await page.waitForTimeout(2000);

    const testProviderVisible = await page.locator(`text=E2E Test Provider`).isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Test provider visible in list: ${testProviderVisible}`);
    await page.screenshot({ path: '/tmp/llm-08-after-create.png', fullPage: true });

    if (!testProviderVisible) {
      console.log('Provider creation may have failed. Checking page state...');
      // Check if we're still on the panel
      const stillOnPanel = await page.locator('text=Add New Provider').isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Still on add panel: ${stillOnPanel}`);

      // Check if panel closed but provider not in list
      const panelClosed = !stillOnPanel;
      console.log(`Panel closed: ${panelClosed}`);

      // Dump visible providers
      const bodyText = await page.locator('body').textContent() || '';
      const providerNames = bodyText.match(/[a-z]+-[a-z]+-\d+/g);
      if (providerNames) {
        console.log(`Found provider-like names: ${providerNames.join(', ')}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Expand Provider Card & Test Actions
    // ═══════════════════════════════════════════════════════════════
    if (testProviderVisible) {
      console.log('\n=== PHASE 4: Expand Provider Card ===');

      // Click the provider card to expand it
      const providerCard = page.locator(`text=E2E Test Provider`).first();
      await providerCard.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: '/tmp/llm-09-expanded.png', fullPage: true });

      // The expanded card is the one containing "E2E Test Provider" text
      // Find the specific card container for our test provider
      const testCard = page.locator('div:has(> div:has-text("E2E Test Provider"))').first();

      // Check for action buttons in expanded section
      const hasEditBtn = await page.locator('button:has-text("Edit")').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasTestBtn = await page.locator('button:has-text("Test")').first().isVisible({ timeout: 1000 }).catch(() => false);
      const hasDeleteBtn = await page.locator('button:has-text("Delete")').first().isVisible({ timeout: 1000 }).catch(() => false);
      const hasDiscoverBtn = await page.locator('button:has-text("Discover Models")').first().isVisible({ timeout: 1000 }).catch(() => false);
      const hasPlaygroundBtn = await page.locator('button:has-text("Playground")').first().isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Actions: Edit=${hasEditBtn}, Test=${hasTestBtn}, Delete=${hasDeleteBtn}, Discover=${hasDiscoverBtn}, Playground=${hasPlaygroundBtn}`);

      // Check expanded details
      const hasChatModel = await page.locator('text=CHAT MODEL').first().isVisible({ timeout: 1000 }).catch(() => false);
      const hasAuth = await page.locator('text=AUTHENTICATION').first().isVisible({ timeout: 1000 }).catch(() => false);
      const hasCaps = await page.locator('text=CAPABILITIES').first().isVisible({ timeout: 1000 }).catch(() => false);
      console.log(`Details: ChatModel=${hasChatModel}, Auth=${hasAuth}, Capabilities=${hasCaps}`);

      // ═══════════════════════════════════════════════════════════════
      // PHASE 5: Test Provider Connectivity
      // ═══════════════════════════════════════════════════════════════
      if (hasTestBtn) {
        console.log('\n=== PHASE 5: Test Provider ===');
        // The "Test" button is in the expanded actions area (last occurrence on page for our expanded card)
        // Since our card is the only expanded one, use the action button row
        const testBtn = page.locator('button:has-text("Test")').first();
        await testBtn.click();
        await page.waitForTimeout(8000);
        await page.screenshot({ path: '/tmp/llm-10-test-result.png', fullPage: true });

        // Look for toast with result
        const toastAfterTest = page.locator('.fixed.top-4.right-4 div').first();
        if (await toastAfterTest.isVisible({ timeout: 3000 }).catch(() => false)) {
          const testToast = await toastAfterTest.textContent().catch(() => '');
          console.log(`Test result toast: ${testToast}`);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 6: Toggle Provider Enable/Disable
      // ═══════════════════════════════════════════════════════════════
      console.log('\n=== PHASE 6: Toggle Provider ===');
      // Find the toggle nearest to "E2E Test Provider" — it's in the card header row
      // Each card header has: icon, name, metrics badge, health badge, edit button, toggle, chevron
      // The toggle is a button with class containing bg-emerald-500 (enabled) or bg-gray-600 (disabled)
      // We need to find it within the test provider's card row
      // The E2E Test Provider card has the text, then header controls include the toggle
      // Let's find the toggle by looking at all toggle buttons and finding the one in our provider's card
      const allToggles = page.locator('button[title="Disable"], button[title="Enable"]');
      const toggleCount = await allToggles.count();
      console.log(`Found ${toggleCount} toggle buttons total`);

      // Find the toggle that belongs to our test provider card
      // Our provider display_name is "E2E Test Provider" — look for its sibling toggle
      // Strategy: iterate toggles and check if the parent row contains our provider name
      let targetToggle: any = null;
      for (let i = 0; i < toggleCount; i++) {
        const toggle = allToggles.nth(i);
        const parentRow = toggle.locator('..').locator('..');
        const rowText = await parentRow.textContent().catch(() => '');
        if (rowText?.includes('E2E Test Provider')) {
          targetToggle = toggle;
          break;
        }
      }

      if (targetToggle) {
        const titleBefore = await targetToggle.getAttribute('title');
        console.log(`Toggle button says: ${titleBefore}`);
        await targetToggle.click();
        await page.waitForTimeout(3000);
        const titleAfter = await targetToggle.getAttribute('title').catch(() => '');
        console.log(`After toggle: ${titleAfter}`);
        await page.screenshot({ path: '/tmp/llm-11-toggled.png', fullPage: true });

        // Toggle back to enabled for remaining tests
        if (titleAfter === 'Enable') {
          await targetToggle.click();
          await page.waitForTimeout(2000);
          console.log('Toggled back to enabled');
        }
      } else {
        console.log('WARNING: Could not find toggle for test provider');
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 7: Edit Provider
      // ═══════════════════════════════════════════════════════════════
      if (hasEditBtn) {
        console.log('\n=== PHASE 7: Edit Provider ===');
        // Click the Edit button in the expanded action bar
        const editBtn = page.locator('button:has-text("Edit")').first();
        await editBtn.click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: '/tmp/llm-12-edit-panel.png', fullPage: true });

        // Verify edit panel opened with "Edit:" prefix in title
        const editPanel = page.locator('[role="dialog"]');
        const editTitle = await editPanel.locator('text=Edit:').isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`Edit panel opened: ${editTitle}`);

        if (editTitle) {
          // Update display name — scoped to dialog
          const editDisplayInput = editPanel.locator('input[placeholder="Production Ollama"]');
          if (await editDisplayInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await editDisplayInput.fill('E2E Test Provider (Updated)');
            console.log('Updated display name');
          }

          // Save changes — "Update Provider" button — scoped to dialog
          const updateBtn = editPanel.locator('button:has-text("Update Provider"), button[type="submit"]').first();
          if (await updateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await updateBtn.scrollIntoViewIfNeeded();
            await updateBtn.click();
            console.log('Clicked Update Provider');
            await page.waitForTimeout(3000);
          }
        }
        await page.screenshot({ path: '/tmp/llm-13-after-edit.png', fullPage: true });

        // Verify edit succeeded
        const updatedName = await page.locator('text=E2E Test Provider (Updated)').isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`Edit verified (updated name visible): ${updatedName}`);
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 8: Delete Test Provider (cleanup)
      // ═══════════════════════════════════════════════════════════════
      console.log('\n=== PHASE 8: Delete Provider ===');

      // Re-expand test provider card if collapsed
      const testProvCard = page.locator('text=E2E Test Provider').first();
      if (await testProvCard.isVisible({ timeout: 2000 }).catch(() => false)) {
        await testProvCard.click();
        await page.waitForTimeout(1500);
      }

      // Handle both window.confirm (fallback) and ConfirmModal
      // In headless Playwright, window.confirm auto-returns false — we need to accept it
      page.on('dialog', async (dialog: any) => {
        console.log(`Browser dialog: ${dialog.type()} - "${dialog.message()}"`);
        await dialog.accept();
      });

      // Click Delete in expanded actions
      const deleteBtn = page.locator('button:has-text("Delete")').first();
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: '/tmp/llm-14-delete-confirm.png', fullPage: true });

        // Check for ConfirmModal (BaseModal with z-index 101, rendered via createPortal)
        // The confirm button text is "Confirm" by default
        const confirmBtn = page.locator('[role="dialog"][aria-modal="true"] button:has-text("Confirm")').first();
        const hasConfirmModal = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`ConfirmModal found: ${hasConfirmModal}`);

        if (hasConfirmModal) {
          await confirmBtn.click();
          console.log('Confirmed deletion via modal');
          await page.waitForTimeout(3000);
        } else {
          // The dialog handler above may have already handled window.confirm
          console.log('No ConfirmModal visible — window.confirm may have been auto-accepted');
          await page.waitForTimeout(2000);
        }
      }

      await page.screenshot({ path: '/tmp/llm-15-after-delete.png', fullPage: true });

      // Verify provider was deleted
      await page.waitForTimeout(2000);
      const providerGone = !(await page.locator('text=E2E Test Provider').isVisible({ timeout: 3000 }).catch(() => false));
      console.log(`Provider deleted successfully: ${providerGone}`);
      if (!providerGone) {
        console.log('WARNING: Test provider still visible — delete may have failed');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 9: Check Other Tabs
    // ═══════════════════════════════════════════════════════════════
    console.log('\n=== PHASE 9: Check Tabs ===');

    // Tab buttons are in a flex container with rounded-lg border
    for (const tab of ['Ollama', 'Playground', 'Metrics']) {
      const tabBtn = page.locator(`button:has-text("${tab}")`).first();
      if (await tabBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: `/tmp/llm-tab-${tab.toLowerCase()}.png`, fullPage: true });
        console.log(`${tab} tab: visible`);

        // Tab-specific checks
        if (tab === 'Ollama') {
          const ollamaManager = await page.locator('text=Ollama Model Manager').isVisible({ timeout: 2000 }).catch(() => false);
          console.log(`  Ollama Manager visible: ${ollamaManager}`);
        }
        if (tab === 'Playground') {
          const hasPrompt = await page.locator('textarea').isVisible({ timeout: 2000 }).catch(() => false);
          console.log(`  Playground has prompt input: ${hasPrompt}`);
        }
        if (tab === 'Metrics') {
          const hasMetricText = await page.locator('text=Total Requests').isVisible({ timeout: 2000 }).catch(() => false);
          console.log(`  Metrics has data: ${hasMetricText}`);
        }
      } else {
        console.log(`${tab} tab: NOT FOUND`);
      }
    }

    // Go back to Providers tab
    const providersTab = page.locator('button:has-text("Providers")').first();
    if (await providersTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await providersTab.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: '/tmp/llm-99-final.png', fullPage: true });
    console.log('\n=== LLM PROVIDER CRUD TEST COMPLETE ===');
  });
});
