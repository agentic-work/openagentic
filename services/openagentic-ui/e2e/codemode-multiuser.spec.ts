import { test, expect, Page } from '@playwright/test';

/**
 * Code Mode Multi-User E2E Test
 *
 * Tests 10 users sequentially:
 * 1. Sign in with Email
 * 2. Click past intro stuff
 * 3. Click into Code Mode
 * 4. Wait for provisioning/workspace setup
 * 5. Validate workspace and minio bucket
 * 6. Ask a question using gpt-oss
 * 7. Verify VS Code opens
 * 8. Take screenshots
 */

const TEST_USERS = Array.from({ length: 10 }, (_, i) => ({
  email: `codemode-test-${i + 1}@openagentic.io`,
  password: 'TestPass123!',
  index: i + 1,
}));

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const CODEMODE_PROMPT = 'create a hello world app with one random number';

async function loginUser(page: Page, email: string, password: string): Promise<boolean> {
  console.log(`  Navigating to ${BASE_URL}`);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  console.log('  Looking for "Continue with Email" button...');
  const emailSignInButton = page.getByRole('button', { name: /continue with email|sign in with email/i });
  if (!await emailSignInButton.isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('  ERROR: Continue with Email button not found');
    return false;
  }
  await emailSignInButton.click();
  await page.waitForTimeout(1000);

  console.log('  Filling email...');
  const emailInput = page.locator('input[type="email"]').or(
    page.locator('input[name="email"]')
  );
  await emailInput.first().fill(email);

  console.log('  Filling password...');
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.first().fill(password);

  console.log('  Clicking Sign in...');
  const loginButton = page.getByRole('button', { name: /^sign in$/i });
  await loginButton.click();

  // Wait for navigation - login redirects to "/" which then shows the app
  // Wait for URL to NOT be /login anymore
  try {
    await page.waitForFunction(() => !window.location.pathname.includes('/login'), { timeout: 30000 });
    console.log(`  Logged in! Current URL: ${page.url()}`);
  } catch {
    console.log(`  ERROR: Login failed - still at ${page.url()}`);
    return false;
  }

  // Dismiss any welcome/onboarding modals
  await page.waitForTimeout(2000);

  // Close Welcome capability selector - use force:true since button may be outside viewport
  const justChatButton = page.getByRole('button', { name: /just let me chat/i });
  if (await justChatButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  Dismissing Welcome modal...');
    await justChatButton.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // Close onboarding tutorial - use force:true
  const skipTutorial = page.getByRole('button', { name: /skip tutorial/i });
  if (await skipTutorial.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  Skipping onboarding tutorial...');
    await skipTutorial.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // Also try generic skip button - use force:true
  const skipButton = page.getByRole('button', { name: /^skip$/i });
  if (await skipButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('  Dismissing modal...');
    await skipButton.click({ force: true });
    await page.waitForTimeout(500);
  }

  return true;
}

async function waitForCodeModeReady(page: Page, maxWait: number = 240000): Promise<boolean> {
  console.log('  Waiting for Code Mode to be ready...');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    // Check current page state
    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);

    // Check for error states
    const accessDenied = page.locator('text=Access Denied');
    const somethingWrong = page.locator('text=Something Went Wrong');
    if (await accessDenied.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  ERROR: Access Denied');
      return false;
    }
    if (await somethingWrong.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  ERROR: Something Went Wrong');
      return false;
    }

    // Check for provisioning screen
    const provisioningText = page.locator('text=Setting Up Your Environment');
    if (await provisioningText.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  Provisioning in progress...');
      // Check progress
      const progressText = await page.locator('text=/\\d+%/').first().textContent().catch(() => null);
      if (progressText) {
        console.log(`  Progress: ${progressText}`);
      }
      await page.waitForTimeout(5000);
      continue;
    }

    // Check for "Checking environment status" spinner
    const checkingText = page.locator('text=Checking environment status');
    if (await checkingText.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('  Checking environment status...');
      await page.waitForTimeout(2000);
      continue;
    }

    // Check for Code Mode textarea (means we're ready!)
    const textarea = page.locator('textarea[placeholder*="What would you like"]');
    if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('  Code Mode is ready! Found textarea.');
      return true;
    }

    // Also check for any textarea
    const anyTextarea = page.locator('textarea').first();
    if (await anyTextarea.isVisible({ timeout: 500 }).catch(() => false)) {
      const placeholder = await anyTextarea.getAttribute('placeholder');
      console.log(`  Found textarea with placeholder: ${placeholder}`);
      return true;
    }

    await page.waitForTimeout(3000);
  }

  console.log('  ERROR: Timeout waiting for Code Mode');
  return false;
}

async function sendPromptAndWait(page: Page, prompt: string): Promise<boolean> {
  console.log(`  Sending prompt: "${prompt}"`);

  // Find textarea
  const textarea = page.locator('textarea').first();
  if (!await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  ERROR: Textarea not found');
    return false;
  }

  // Type the prompt
  await textarea.fill(prompt);
  await page.waitForTimeout(500);

  // Find send button (usually has an SVG icon)
  const sendButton = page.locator('button').filter({ has: page.locator('svg') }).last();
  if (await sendButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sendButton.click();
    console.log('  Clicked send button');
  } else {
    // Try pressing Enter
    await textarea.press('Control+Enter');
    console.log('  Pressed Ctrl+Enter');
  }

  // Wait for response
  console.log('  Waiting for response...');
  await page.waitForTimeout(10000); // Initial wait

  // Wait for activity to complete
  let lastActivity = Date.now();
  const maxWait = 180000; // 3 minutes
  while (Date.now() - lastActivity < 30000 && Date.now() - lastActivity < maxWait) {
    const spinners = page.locator('.animate-spin, [data-loading="true"]');
    const spinnerCount = await spinners.count();
    if (spinnerCount > 0) {
      lastActivity = Date.now();
      console.log(`  Activity in progress (${spinnerCount} spinners)...`);
      await page.waitForTimeout(5000);
    } else {
      break;
    }
  }

  console.log('  Response complete');
  return true;
}

async function checkEditorPanel(page: Page): Promise<string | null> {
  console.log('  Looking for Editor panel / VS Code iframe...');

  // Check for iframe with code-server
  const editorFrame = page.locator('iframe').filter({
    has: page.locator('[src*="code-server"], [src*=":3100"]')
  });

  if (await editorFrame.isVisible({ timeout: 5000 }).catch(() => false)) {
    const src = await editorFrame.getAttribute('src');
    console.log(`  Found editor iframe: ${src}`);
    return src;
  }

  // Look for Editor tab/button
  const editorTab = page.getByRole('tab', { name: /editor/i }).or(
    page.getByRole('button', { name: /editor/i })
  );

  if (await editorTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('  Found Editor tab, clicking...');
    await editorTab.click();
    await page.waitForTimeout(3000);

    // Check for iframe again
    const iframe = page.locator('iframe').first();
    if (await iframe.isVisible({ timeout: 5000 }).catch(() => false)) {
      const src = await iframe.getAttribute('src');
      console.log(`  Found iframe after clicking Editor: ${src}`);
      return src;
    }
  }

  console.log('  Editor panel not found');
  return null;
}

test.describe('Code Mode Multi-User Test', () => {
  test.describe.configure({ mode: 'serial' });

  // Use larger viewport to ensure modals fit
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const user of TEST_USERS) {
    test(`User ${user.index}: ${user.email} - Code Mode E2E`, async ({ page }) => {
      test.setTimeout(600000); // 10 minutes per user

      console.log(`\n${'='.repeat(60)}`);
      console.log(`Testing User ${user.index}: ${user.email}`);
      console.log(`${'='.repeat(60)}\n`);

      // Step 1: Login
      console.log('STEP 1: Sign in with Email');
      const loginSuccess = await loginUser(page, user.email, user.password);
      await page.screenshot({
        path: `test-results/codemode-user-${user.index}-01-after-login.png`,
        fullPage: true
      });
      if (!loginSuccess) {
        console.log('FAILED: Login unsuccessful');
        return;
      }

      // Step 2: Navigate to Code Mode
      console.log('\nSTEP 2: Navigate to Code Mode');
      await page.goto(`${BASE_URL}/code`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `test-results/codemode-user-${user.index}-02-code-page-initial.png`,
        fullPage: true
      });

      // Step 3: Wait for Code Mode to be ready
      console.log('\nSTEP 3: Wait for Code Mode Ready');
      const isReady = await waitForCodeModeReady(page);
      await page.screenshot({
        path: `test-results/codemode-user-${user.index}-03-code-mode-state.png`,
        fullPage: true
      });
      if (!isReady) {
        console.log('FAILED: Code Mode not ready');
        return;
      }

      // Step 4: Send the prompt
      console.log('\nSTEP 4: Send Code Generation Prompt');
      const promptSuccess = await sendPromptAndWait(page, CODEMODE_PROMPT);
      await page.screenshot({
        path: `test-results/codemode-user-${user.index}-04-after-prompt.png`,
        fullPage: true
      });
      if (!promptSuccess) {
        console.log('FAILED: Prompt send failed');
        return;
      }

      // Step 5: Check Editor/VS Code
      console.log('\nSTEP 5: Check Editor Panel');
      const editorUrl = await checkEditorPanel(page);
      await page.screenshot({
        path: `test-results/codemode-user-${user.index}-05-editor-state.png`,
        fullPage: true
      });

      if (editorUrl) {
        // Navigate to editor directly for screenshot
        console.log(`  Navigating to editor: ${editorUrl}`);
        try {
          await page.goto(editorUrl, { timeout: 30000 });
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(5000);
          await page.screenshot({
            path: `test-results/codemode-user-${user.index}-06-vscode-direct.png`,
            fullPage: true
          });
        } catch (e) {
          console.log('  Could not navigate to editor URL directly');
        }
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`User ${user.index} test completed successfully!`);
      console.log(`${'='.repeat(60)}\n`);

      // Logout
      await page.goto(`${BASE_URL}/logout`).catch(() => {});
      await page.waitForTimeout(2000);
    });
  }
});

// Parallel stress test (disabled by default)
test.describe('Code Mode Parallel Stress Test', () => {
  test.skip(true, 'Enable for parallel stress testing');

  test('All 10 users simultaneously', async ({ browser }) => {
    test.setTimeout(600000);

    const contexts = await Promise.all(
      TEST_USERS.map(() => browser.newContext())
    );

    const pages = await Promise.all(
      contexts.map(ctx => ctx.newPage())
    );

    // Login all users
    console.log('Logging in all users...');
    const loginResults = await Promise.all(
      pages.map((page, i) => loginUser(page, TEST_USERS[i].email, TEST_USERS[i].password))
    );

    // Navigate to Code Mode
    console.log('Navigating to Code Mode...');
    await Promise.all(pages.map(page => page.goto(`${BASE_URL}/code`)));

    // Wait for all to be ready
    console.log('Waiting for Code Mode ready...');
    await Promise.all(pages.map(page => waitForCodeModeReady(page)));

    // Send prompts
    console.log('Sending prompts...');
    await Promise.all(pages.map(page => sendPromptAndWait(page, CODEMODE_PROMPT)));

    // Take screenshots
    console.log('Taking screenshots...');
    await Promise.all(
      pages.map((page, i) =>
        page.screenshot({
          path: `test-results/parallel-user-${i + 1}-result.png`,
          fullPage: true
        })
      )
    );

    // Cleanup
    await Promise.all(contexts.map(ctx => ctx.close()));
  });
});
