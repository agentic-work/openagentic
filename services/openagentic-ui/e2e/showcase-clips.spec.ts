/**
 * Showcase Video Clips for openagentic.io
 *
 * Records polished demo clips showing platform capabilities.
 * Each test produces a video clip suitable for the website.
 *
 * Run: HEADLESS=true BASE_URL=https://chat-dev.openagentic.io npx playwright test e2e/showcase-clips.spec.ts --reporter=list
 * Videos saved to: /tmp/playwright-showcase/
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';
const SHOWCASE_DIR = '/tmp/playwright-showcase';

// Override config for showcase recordings
test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 1920, height: 1080 },  // Full HD for showcase
  actionTimeout: 30000,
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  trace: 'off',
  screenshot: 'off',
  launchOptions: {
    slowMo: 100,  // Slightly slower for watchable demos
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [
        `${process.env.HOME}/playwright-deps/extracted/usr/lib/x86_64-linux-gnu`,
        process.env.LD_LIBRARY_PATH || '',
      ].filter(Boolean).join(':'),
    },
  },
});

// 3 minutes per test (login + demo actions + video finalization)
test.setTimeout(180000);

/** Dismiss all overlay modals and onboarding elements */
async function dismissModals(page: Page) {
  // Set localStorage to prevent onboarding tour from appearing
  await page.evaluate(() => {
    localStorage.setItem('onboarding_completed', 'true');
    localStorage.setItem('welcome_dismissed', 'true');
  });

  for (let i = 0; i < 8; i++) {
    // 1. Dismiss onboarding tour tooltip (z-[10000])
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.first().isVisible({ timeout: 500 }).catch(() => false)) {
      await skipBtn.first().click({ force: true });
      await page.waitForTimeout(400);
      continue;
    }

    // 2. Check for full-screen overlays
    const overlay = await page.locator('.fixed.inset-0').first().isVisible({ timeout: 500 }).catch(() => false);
    if (!overlay) break;

    // Try close button (catch element detachment)
    const closeBtn = page.locator('.fixed.inset-0 button:has(svg)');
    if (await closeBtn.first().isVisible({ timeout: 400 }).catch(() => false)) {
      await closeBtn.first().click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    // Try Get Started
    const getStarted = page.locator('button:has-text("Get Started")');
    if (await getStarted.isVisible({ timeout: 400 }).catch(() => false)) {
      await getStarted.click({ force: true });
      await page.waitForTimeout(400);
      continue;
    }
    // Try backdrop click
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/70, .fixed.inset-0.bg-black\\/60');
    if (await backdrop.first().isVisible({ timeout: 400 }).catch(() => false)) {
      await backdrop.first().click({ position: { x: 10, y: 10 }, force: true });
      await page.waitForTimeout(400);
      continue;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/** Login via Azure AD */
async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Pre-emptively mark onboarding/welcome as completed
  await page.evaluate(() => {
    localStorage.setItem('onboarding_completed', 'true');
    localStorage.setItem('welcome_dismissed', 'true');
  });

  const loggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (loggedIn) {
    await dismissModals(page);
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await emailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const passwordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await passwordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await passwordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const stayBtn = page.locator('button:has-text("No"), input[value="No"]');
    if (await stayBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await stayBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');

    // Re-set localStorage after redirect (domain may have changed during Azure AD flow)
    await page.evaluate(() => {
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('welcome_dismissed', 'true');
    });
  }

  await page.waitForSelector('textarea', { timeout: 60000 });
  await dismissModals(page);
}

// ─── SHOWCASE CLIPS ──────────────────────────────────────────────────

test.describe('Showcase Clips', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Save video to showcase dir
    const video = page.video();
    if (video) {
      const slug = testInfo.title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
      const destPath = `${SHOWCASE_DIR}/${slug}.webm`;
      try {
        // Get temp path while page is still open (before NFS cleanup)
        const tempPath = await video.path();
        // Copy temp file to local disk first (avoids NFS race condition)
        const localTempPath = `/tmp/playwright-showcase/.tmp-${slug}.webm`;
        if (tempPath && fs.existsSync(tempPath)) {
          fs.copyFileSync(tempPath, localTempPath);
        }
        await page.close(); // Finalize video recording
        // Try saveAs (works for most clips), fallback to pre-copied temp
        try {
          await video.saveAs(destPath);
        } catch {
          if (fs.existsSync(localTempPath)) {
            fs.renameSync(localTempPath, destPath);
          }
        }
        // Clean up temp
        if (fs.existsSync(localTempPath)) fs.unlinkSync(localTempPath);
        console.log(`Saved showcase clip: ${destPath}`);
      } catch (e) {
        console.log(`Could not save video for ${testInfo.title}: ${e}`);
      }
    }
  });

  /**
   * CLIP 1: AI Chat with Streaming Response
   * Shows: User asks a question, Claude responds with streaming text
   */
  test('Clip 1: AI Chat Streaming', async ({ page }) => {
    // Start with clean chat view - pause for establishing shot
    await page.waitForTimeout(1500);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    // Type slowly for visual effect
    await textarea.click();
    await page.keyboard.type('Explain the key benefits of multi-agent AI orchestration for enterprise applications in 3 bullet points.', { delay: 30 });

    await page.waitForTimeout(500);
    await textarea.press('Enter');

    // Wait for response to stream
    await page.waitForTimeout(15000);

    // Scroll to see full response
    const messages = page.locator('[class*="message"], [class*="bubble"]');
    if (await messages.last().isVisible({ timeout: 3000 }).catch(() => false)) {
      await messages.last().scrollIntoViewIfNeeded();
    }

    await page.waitForTimeout(2000); // Hold on final frame
  });

  /**
   * CLIP 2: Model Selection & Smart Router
   * Shows: User switching between AI models
   */
  test('Clip 2: Model Selection', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Click model selector button
    const modelBtn = page.locator('[class*="model-selector"], button[title*="Select Model"]');
    if (await modelBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await modelBtn.first().click({ force: true });
      await page.waitForTimeout(2000); // Show the dropdown

      // Scroll through models if there's a list
      const listbox = page.locator('[role="listbox"], [class*="model-list"]');
      if (await listbox.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.waitForTimeout(3000); // Show available models
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
  });

  /**
   * CLIP 3: Flows / Workflow Builder
   * Shows: The visual workflow builder with node types and sidebar
   */
  test('Clip 3: Workflow Builder', async ({ page }) => {
    await page.waitForTimeout(500);

    // Navigate to Flows
    const flowsTab = page.locator('text="Flows"').first();
    if (await flowsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await flowsTab.click({ force: true });
      await page.waitForTimeout(2000);
    }

    await dismissModals(page);
    await page.waitForTimeout(1500); // Establishing shot of flows page

    // Expand sidebar sections
    const sections = ['NODES', 'TEMPLATES', 'MARKETPLACE', 'AGENTS'];
    for (const section of sections) {
      const sectionEl = page.locator(`text="${section}"`).first();
      if (await sectionEl.isVisible({ timeout: 1500 }).catch(() => false)) {
        await sectionEl.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }

    // Click "Create Workflow"
    const createBtn = page.locator('button:has-text("Create Workflow"), text="+ Create Workflow"');
    if (await createBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await createBtn.first().click({ force: true });
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(2000); // Hold
  });

  /**
   * CLIP 4: AI Flow Builder (Natural Language to Workflow)
   * Shows: User describes a workflow in NL, AI generates it
   */
  test('Clip 4: AI Flow Builder', async ({ page }) => {
    // Navigate to Flows
    const flowsTab = page.locator('text="Flows"').first();
    if (await flowsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await flowsTab.click({ force: true });
      await page.waitForTimeout(2000);
    }
    await dismissModals(page);

    // Look for AI builder button
    const aiBtn = page.locator('button:has-text("AI"), button[title*="AI"]');
    if (await aiBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await aiBtn.first().click({ force: true });
      await page.waitForTimeout(1500);

      // Type a workflow description
      const aiInput = page.locator('textarea').last();
      if (await aiInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await aiInput.click();
        await page.keyboard.type('Build a research pipeline that searches the web for AI trends, analyzes the results, and creates a summary report with key insights', { delay: 25 });
        await page.waitForTimeout(1000);
        await aiInput.press('Enter');
        await page.waitForTimeout(15000); // Wait for AI to generate
      }

      await page.waitForTimeout(2000); // Hold on result
    }
  });

  /**
   * CLIP 5: Code Mode
   * Shows: Switching to code mode with VS Code integration
   */
  test('Clip 5: Code Mode', async ({ page }) => {
    await page.waitForTimeout(500);

    const codeTab = page.locator('text="Code"').first();
    if (await codeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await codeTab.click({ force: true });
      await page.waitForTimeout(3000);
    }

    await dismissModals(page);
    await page.waitForTimeout(3000); // Show code mode UI

    // Take in the full layout
    await page.waitForTimeout(2000); // Hold
  });

  /**
   * CLIP 6: Admin Console - Full Platform Management
   * Shows: Admin portal with all management sections
   */
  test('Clip 6: Admin Console', async ({ page }) => {
    // Open admin portal
    const settingsBtn = page.locator('text="Settings & more"').first();
    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click({ force: true });
      await page.waitForTimeout(800);
    }

    const adminBtn = page.locator('span:has-text("Admin Panel"), button:has-text("Admin Panel")').first();
    if (await adminBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await adminBtn.click({ force: true });
      await page.waitForTimeout(3000);
    }

    await dismissModals(page);
    await page.waitForTimeout(2000); // Show admin portal

    // Click through key sections
    const adminSections = [
      'LLM Providers',
      'MCP Management',
      'Agent Management',
      'Security & Access',
    ];

    for (const section of adminSections) {
      const sectionEl = page.locator(`text="${section}"`).first();
      if (await sectionEl.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sectionEl.click({ force: true });
        await page.waitForTimeout(1500);
      }
    }

    // Click a child item to show detail view
    const providerMgmt = page.locator('text="Provider Management"').first();
    if (await providerMgmt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await providerMgmt.click({ force: true });
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(2000); // Hold
  });

  /**
   * CLIP 7: MCP Tool Integration
   * Shows: The 200+ MCP tools available, tool usage panel
   */
  test('Clip 7: MCP Tools', async ({ page }) => {
    await page.waitForTimeout(500);

    // Click TOOL USAGE section in sidebar
    const toolUsage = page.locator('text="TOOL USAGE"').first();
    if (await toolUsage.isVisible({ timeout: 3000 }).catch(() => false)) {
      await toolUsage.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // Show the tool count and list
    await page.waitForTimeout(3000);

    // Now ask a question that will use tools
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textarea.click();
      await page.keyboard.type('Search the web for the latest news about AI agents in 2026', { delay: 30 });
      await page.waitForTimeout(500);
      await textarea.press('Enter');
      await page.waitForTimeout(15000); // Wait for tool calls and response
    }

    await page.waitForTimeout(2000); // Hold
  });

  /**
   * CLIP 8: Multi-Mode Navigation
   * Shows: Seamless switching between Chat, Code, and Flows
   */
  test('Clip 8: Multi-Mode Navigation', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Start on Chat
    await page.waitForTimeout(1500);

    // Switch to Code
    const codeTab = page.locator('text="Code"').first();
    if (await codeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await codeTab.click({ force: true });
      await page.waitForTimeout(2000);
      await dismissModals(page);
      await page.waitForTimeout(1500);
    }

    // Switch to Flows
    const flowsTab = page.locator('text="Flows"').first();
    if (await flowsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await flowsTab.click({ force: true });
      await page.waitForTimeout(2000);
      await dismissModals(page);
      await page.waitForTimeout(1500);
    }

    // Back to Chat
    const chatTab = page.locator('text="Chat"').first();
    if (await chatTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatTab.click({ force: true });
      await page.waitForTimeout(2000);
      await dismissModals(page);
    }

    await page.waitForTimeout(1000); // Final hold
  });

  /**
   * CLIP 9: Memory & Context
   * Shows: The memory/knowledge panel in the sidebar
   */
  test('Clip 9: Memory Panel', async ({ page }) => {
    await page.waitForTimeout(500);

    // Click MEMORY section
    const memorySection = page.locator('text="MEMORY"').first();
    if (await memorySection.isVisible({ timeout: 3000 }).catch(() => false)) {
      await memorySection.click({ force: true });
      await page.waitForTimeout(3000); // Show memory content
    }

    await page.waitForTimeout(2000); // Hold
  });

  /**
   * CLIP 10: Enterprise Security (Azure AD SSO)
   * Shows: The Azure AD login flow (recorded during login)
   */
  test('Clip 10: Enterprise SSO Login', async ({ page, context }) => {
    // Clear cookies to force re-login
    await context.clearCookies();

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500); // Show login page

    // Click Microsoft sign-in
    const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
    if (await msButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await msButton.first().click();
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');

      // Fill email (slowly for demo)
      const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
      if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await emailInput.type(ADMIN_EMAIL, { delay: 40 });
        await page.waitForTimeout(500);
        await page.locator('input[type="submit"], button:has-text("Next")').click();
        await page.waitForTimeout(3000);
      }

      // Fill password (masked, just show typing)
      const passwordInput = page.locator('input[type="password"], input[name="passwd"]');
      if (await passwordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await passwordInput.type(ADMIN_PASSWORD, { delay: 30 });
        await page.waitForTimeout(500);
        await page.locator('input[type="submit"], button:has-text("Sign in")').click();
        await page.waitForTimeout(4000);
      }

      // Stay signed in?
      const stayBtn = page.locator('button:has-text("No"), input[value="No"]');
      if (await stayBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await stayBtn.click();
        await page.waitForTimeout(3000);
      }

      await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('networkidle');
    }

    // Show the authenticated interface
    await page.waitForSelector('textarea', { timeout: 60000 });
    await dismissModals(page);
    await page.waitForTimeout(3000); // Hold on authenticated view
  });
});
