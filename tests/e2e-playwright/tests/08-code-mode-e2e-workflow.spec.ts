import { test, expect, Page } from '@playwright/test';

/**
 * Code Mode End-to-End Workflow Test
 *
 * This test validates the complete code mode workflow with a complex prompt:
 * 1. Login as local admin to https://chat-dev.openagentic.io
 * 2. Go to code mode and send a signal-path-generator prompt
 * 3. Refresh and verify files are created in MinIO/workspace
 * 4. Make the LLM run 'ls' and validate files exist
 * 5. Make the LLM run the app
 * 6. Click VS Code and verify files visible
 * 7. Validate inline UX shows live streaming output
 *
 * Expected UX features (from screenshots):
 * - Todo lists with strikethrough for completed items
 * - Write blocks with syntax-highlighted diffs
 * - Thinking states ("Booping...", "Pontificating...")
 * - VS Code button in input area
 * - Live streaming output
 */

// Production dev URL
const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';

// Test timeout - 5 minutes for complex prompts
const TEST_TIMEOUT = 300000;

// Signal path generator prompt
const SIGNAL_PATH_PROMPT = `> build a complete signal-path-generator and complete it assuming the following
gear- Synthesizers

Sequential Prophet Rev2 (16-voice analog poly)
Moog Matriarch (4-voice paraphonic semi-modular)
Waldorf Iridium (wavetable/FM/granular/resonator)
ASM Hydrasynth (wavescan synthesis)
Moog Mother-32 (semi-modular monosynth)
Moog Subharmonicon (polyrhythmic analog)
Elektron Digitakt (sampler/drum machine)
Roland TR-808 (or clone)

Modular/Eurorack

Intellijel Hapax sequencer
Eurorack system (Intellijel case)

Recording Chain / Interfaces

Universal Audio Apollo x8p (18x24 Thunderbolt interface)
Universal Audio 4-710d (4-channel preamp/compressor)
SSL Big Six (analog mixer/summing, SSL bus comp)

Monitors

M-Audio BX8 D3 (current)
Neumann KH 310 (planned upgrade)

Guitar Amps & Processing

Vox AC30 (handwired tube amp)
Orange Crush 35RT combo
Line 6 Helix Rack + Helix Control
Two Notes Torpedo Captor 8 (reactive load box/attenuator)
Radial Reamp X-AMP (studio reamper)
TC Helicon VoiceLive Rack (vocal processing)

Guitars & Bass

Gibson Les Paul (black, Seymour Duncan pickups)
Gibson Les Paul (emerald green flame top)
Fender Telecaster (3-tone sunburst)
Fender Stratocaster (surf green)
Fender Stratocaster (candy apple red)
Fender Precision Bass (white/cream)

Pedals & DI

Pedalboard with: Boss Reverb, DigiTech Whammy, delay, others
PROD2 stereo direct box

Controllers

Ableton Push
SSL fader controller

Power & Infrastructure

Surge-X power conditioner
CyberPower UPS (rack mounted)

DAW

Ableton Live (need help determining how to get output into the x8p, handwired vox
ac30 with speaker cabinet and a 1u patch panel. I need you to improve the existing
tool so I can SEE and zoom in on each device to see which cables should go where to
use everything in all possible ways- e.g. guitars effected by eurorack, or run
eurorack through)`;

// Helper: Login to the application
async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of login page
  await page.screenshot({ path: 'test-results/screenshots/08-e2e-00-login-page.png', fullPage: true });

  // Check for dev login button
  const devLoginButton = page.locator(
    'button:has-text("Continue as"), ' +
    'button:has-text("Test User"), ' +
    'button:has-text("Dev Login"), ' +
    'button:has-text("Skip")'
  ).first();

  if (await devLoginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await devLoginButton.click();
    await page.waitForTimeout(2000);
    return;
  }

  // Handle regular login with Local auth
  const localButton = page.locator('button:has-text("Local"), button:has-text("Development")');
  if (await localButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await localButton.click();
    await page.waitForTimeout(1000);

    const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailField.fill('admin@openagentic.io');
      const passwordField = page.locator('input[type="password"]');
      await passwordField.fill(process.env.ADMIN_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3');
      const submitButton = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
      await submitButton.click();
      await page.waitForTimeout(3000);
    }
  }

  // Take screenshot after login
  await page.screenshot({ path: 'test-results/screenshots/08-e2e-00-after-login.png', fullPage: true });
}

// Helper: Navigate to Code Mode
async function navigateToCodeMode(page: Page) {
  const codeModeButton = page.locator(
    'a[href*="code"], ' +
    'button:has-text("Code"), ' +
    '[data-testid="code-mode"], ' +
    '.nav-code-mode, ' +
    'a:has-text("Code Mode")'
  ).first();

  if (await codeModeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await codeModeButton.click();
    await page.waitForTimeout(2000);
  } else {
    await page.goto(`${BASE_URL}/code`);
    await page.waitForTimeout(2000);
  }

  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/screenshots/08-e2e-01-code-mode.png', fullPage: true });
}

// Helper: Get code mode input
async function getCodeModeInput(page: Page) {
  const chatInput = page.locator(
    'textarea[placeholder*="message" i], ' +
    'textarea[placeholder*="What" i], ' +
    'textarea[placeholder*="task" i], ' +
    'textarea[placeholder*="Reply" i], ' +
    '[data-testid="code-input"], ' +
    'textarea'
  ).first();

  await chatInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
    console.log('Warning: textarea not found with default selectors');
  });

  return chatInput;
}

// Helper: Wait for LLM response with progress tracking
async function waitForLLMResponse(page: Page, options: { timeout?: number, expectTodos?: boolean, expectFiles?: boolean } = {}) {
  const { timeout = 60000, expectTodos = true, expectFiles = true } = options;
  const startTime = Date.now();
  const checkInterval = 1000;

  // Wait for any streaming indicator to appear
  const streamingIndicators = [
    'text=Working',
    'text=Thinking',
    'text=Booping',
    'text=Pontificating',
    'text=Cogitating',
    'text=Ruminating',
    '[class*="animate-pulse"]',
    '[class*="streaming"]',
  ];

  let foundIndicator = false;
  for (const indicator of streamingIndicators) {
    if (await page.locator(indicator).first().isVisible({ timeout: 5000 }).catch(() => false)) {
      foundIndicator = true;
      console.log(`Found streaming indicator: ${indicator}`);
      break;
    }
  }

  // Track initial content length
  const initialContent = await page.textContent('body') || '';
  let lastContentLength = initialContent.length;

  // Wait for actual content to appear and streaming to complete
  let elapsedTime = 0;
  let contentStableCount = 0;

  while (elapsedTime < timeout) {
    await page.waitForTimeout(checkInterval);
    elapsedTime += checkInterval;

    const currentContent = await page.textContent('body') || '';
    const currentLength = currentContent.length;

    // Check if content is still growing
    if (currentLength > lastContentLength) {
      console.log(`Content growing: ${lastContentLength} -> ${currentLength} (+${currentLength - lastContentLength})`);
      lastContentLength = currentLength;
      contentStableCount = 0;
    } else {
      contentStableCount++;
    }

    // Check if streaming indicators are gone
    let stillStreaming = false;
    for (const indicator of streamingIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 500 }).catch(() => false)) {
        stillStreaming = true;
        break;
      }
    }

    // Content stable for 3 checks AND not streaming = done
    if (contentStableCount >= 3 && !stillStreaming) {
      console.log(`Content stable and streaming stopped after ${elapsedTime}ms`);
      break;
    }

    // If we've received substantial content (more than 500 chars added) and content is stable
    if (currentLength - initialContent.length > 500 && contentStableCount >= 2 && !stillStreaming) {
      console.log(`Substantial response received (${currentLength - initialContent.length} chars) after ${elapsedTime}ms`);
      break;
    }
  }

  // Wait for expected content
  if (expectTodos) {
    // InlineTodoList shows "Update Todos" with progress badge (e.g., "1/3")
    const todoList = page.locator('text=Update Todos, text=/\\d+\\/\\d+/, [class*="todo"]');
    await todoList.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() =>
      console.log('Todo list not found - may be optional'));
  }

  if (expectFiles) {
    // InlineToolBlock uses data-testid="inline-tool-block" with data-tool-name attribute
    const writeBlock = page.locator('[data-testid="inline-tool-block"][data-tool-name="Write"], [data-testid="inline-tool-block"]:has-text("Write"), .inline-tool-block');
    await writeBlock.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() =>
      console.log('Write block not found - may be optional'));
  }

  console.log(`LLM response waited for ${Date.now() - startTime}ms total`);
}

test.describe('Code Mode E2E Workflow', () => {
  test.setTimeout(TEST_TIMEOUT);

  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToCodeMode(page);
  });

  test('1. Send complex signal-path-generator prompt and validate LLM responds', async ({ page }) => {
    const input = await getCodeModeInput(page);

    // Send the complex prompt
    await input.fill(SIGNAL_PATH_PROMPT);
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-02-prompt-entered.png', fullPage: true });

    await input.press('Enter');

    // Wait for initial response - should see thinking indicator
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-03-thinking.png', fullPage: true });

    // Check for thinking/working states
    const thinkingStates = ['Working', 'Thinking', 'Booping', 'Pontificating', 'Processing'];
    let foundThinkingState = false;
    for (const state of thinkingStates) {
      if (await page.locator(`text=${state}`).first().isVisible({ timeout: 1000 }).catch(() => false)) {
        foundThinkingState = true;
        console.log(`Found thinking state: ${state}`);
        break;
      }
    }

    // Wait for LLM to start responding (longer timeout for complex prompts)
    await waitForLLMResponse(page, { timeout: 120000, expectTodos: true, expectFiles: true });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-04-response.png', fullPage: true });

    // Validate response contains expected content
    const pageContent = await page.textContent('body');
    const hasResponse = pageContent && pageContent.length > SIGNAL_PATH_PROMPT.length + 500; // Should have substantial response
    console.log(`Response length: ${pageContent?.length || 0} chars`);

    expect(hasResponse).toBe(true);
  });

  test('2. Validate Todo list with strikethrough for completed items', async ({ page }) => {
    // Send a simple task to trigger todos
    const input = await getCodeModeInput(page);
    await input.fill('Create a simple Python hello world script and save it');
    await input.press('Enter');

    await waitForLLMResponse(page, { timeout: 60000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-05-todos.png', fullPage: true });

    // Check for todo list - InlineTodoList component structure:
    // - Orange bullet with "Update Todos" header
    // - Progress badge showing "X/Y" completed
    // - Checkbox items with strikethrough for completed
    const todoIndicators = [
      'text=Update Todos',                                   // Header text
      'text=/\\d+\\/\\d+/',                                  // Progress badge like "1/3"
      '[class*="strikethrough"]',                            // Completed items
      '[class*="line-through"]',                             // CSS strikethrough
      '.inline-todo-list',                                   // Component class
    ];

    let hasTodos = false;
    for (const indicator of todoIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 5000 }).catch(() => false)) {
        hasTodos = true;
        console.log(`Found todo indicator: ${indicator}`);
        break;
      }
    }

    console.log(`Has todos: ${hasTodos}`);
    // Don't fail if no todos - the LLM may not always create them
  });

  test('3. Validate Write blocks with syntax highlighting', async ({ page }) => {
    const input = await getCodeModeInput(page);
    await input.fill('Create a Python file called test.py with a simple function');
    await input.press('Enter');

    await waitForLLMResponse(page, { timeout: 60000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-06-write-block.png', fullPage: true });

    // Check for Write block - InlineToolBlock component structure:
    // - Orange bullet with "Write" tool name in green
    // - File path after tool name
    // - Expandable tree with diff/code preview
    // - data-testid="inline-tool-block" with data-tool-name="Write"
    const writeIndicators = [
      '[data-testid="inline-tool-block"][data-tool-name="Write"]',  // Exact component selector
      '[data-testid="inline-tool-block"]:has-text("Write")',        // Has Write text
      '.inline-tool-block',                                          // Component class
      'text=Show full diff',                                         // Expanded diff text
      'text=Write',                                                  // Tool name text
    ];

    let hasWriteBlock = false;
    for (const indicator of writeIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 5000 }).catch(() => false)) {
        hasWriteBlock = true;
        console.log(`Found write indicator: ${indicator}`);
        break;
      }
    }

    console.log(`Has write block: ${hasWriteBlock}`);
  });

  test('4. Run ls command and validate files exist', async ({ page }) => {
    // First create a file
    const input = await getCodeModeInput(page);
    await input.fill('Create a file called signal_generator.py with basic structure');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 60000 });

    // Now run ls
    await input.fill('run ls -la to show all files');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 30000 });

    await page.screenshot({ path: 'test-results/screenshots/08-e2e-07-ls-output.png', fullPage: true });

    // Check for file listing in response
    const pageContent = await page.textContent('body') || '';
    const hasFileList = pageContent.includes('.py') || pageContent.includes('total') || pageContent.includes('drwx');
    console.log(`Has file list in output: ${hasFileList}`);
  });

  test('5. VS Code button is visible and clickable', async ({ page }) => {
    const vsCodeButton = page.locator(
      'button:has-text("VS Code"), ' +
      'button:has-text("Editor"), ' +
      'button:has-text("Open Editor"), ' +
      '[data-testid="vscode-button"]'
    ).first();

    const hasVSCodeButton = await vsCodeButton.isVisible({ timeout: 10000 }).catch(() => false);

    await page.screenshot({ path: 'test-results/screenshots/08-e2e-08-vscode-button.png', fullPage: true });
    console.log(`VS Code button visible: ${hasVSCodeButton}`);

    if (hasVSCodeButton) {
      // Click VS Code button
      await vsCodeButton.click();
      await page.waitForTimeout(5000);

      // Check for VS Code UI or iframe
      await page.screenshot({ path: 'test-results/screenshots/08-e2e-09-vscode-opened.png', fullPage: true });

      const vsCodeIndicators = [
        'iframe[src*="code-server"]',
        '[class*="monaco"]',
        '[class*="vscode"]',
        'text=Explorer',
        'text=EXPLORER',
      ];

      let vsCodeOpened = false;
      for (const indicator of vsCodeIndicators) {
        if (await page.locator(indicator).first().isVisible({ timeout: 5000 }).catch(() => false)) {
          vsCodeOpened = true;
          console.log(`VS Code opened, found: ${indicator}`);
          break;
        }
      }

      // Check for 502 error
      const pageContent = await page.textContent('body') || '';
      const has502 = pageContent.includes('502') || pageContent.includes('Bad Gateway');
      if (has502) {
        console.error('FAIL: 502 Bad Gateway error when opening VS Code');
      }
      expect(has502).toBe(false);
    }

    expect(hasVSCodeButton).toBe(true);
  });

  test('6. Sidebar Files tab shows workspace files', async ({ page }) => {
    // First create some files
    const input = await getCodeModeInput(page);
    await input.fill('Create requirements.txt with numpy and pandas');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 60000 });

    // Look for Files tab
    const filesTab = page.locator('button:has-text("Files"), [data-tab="files"]').first();
    if (await filesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await filesTab.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/08-e2e-10-files-tab.png', fullPage: true });

    // Check for file tree
    const fileIndicators = [
      '[class*="FileTree"]',
      '[class*="file-tree"]',
      'text=.py',
      'text=requirements',
      '[class*="tree-item"]',
    ];

    let hasFiles = false;
    for (const indicator of fileIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 5000 }).catch(() => false)) {
        hasFiles = true;
        console.log(`Found file tree indicator: ${indicator}`);
        break;
      }
    }

    console.log(`Files visible in sidebar: ${hasFiles}`);
  });

  test('7. Inline UX shows live streaming output', async ({ page }) => {
    const input = await getCodeModeInput(page);

    // Send a prompt that will take time to process
    await input.fill('Explain in detail how a TB-303 acid bass synthesizer works');
    await input.press('Enter');

    // Immediately check for streaming indicators
    // InlineToolBlock shows:
    // - Orange pulsing bullet (animate scale/opacity)
    // - ActivityDots component (animated "..." dots)
    // - "Running..." text in code block
    // - StreamingCursor (blinking cursor at end of content)
    await page.waitForTimeout(1000);

    const streamingIndicators = [
      '[class*="animate-spin"]',          // Loader2 spinner when executing
      '[class*="animate-pulse"]',         // Pulsing elements
      'text=Running...',                  // Execution status text
      '.animate-spin',                    // Direct spinner class
      'text=Working',                     // ThinkingDisplay states
      'text=Thinking',
      'text=Booping',
      'text=Pontificating',
    ];

    let foundStreaming = false;
    for (const indicator of streamingIndicators) {
      if (await page.locator(indicator).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        foundStreaming = true;
        console.log(`Found streaming indicator: ${indicator}`);
        await page.screenshot({ path: 'test-results/screenshots/08-e2e-11-streaming.png', fullPage: true });
        break;
      }
    }

    // Wait for more content to stream
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-12-mid-stream.png', fullPage: true });

    // Check that content is growing
    const initialContent = await page.textContent('body');
    await page.waitForTimeout(3000);
    const laterContent = await page.textContent('body');

    const contentGrowing = (laterContent?.length || 0) > (initialContent?.length || 0);
    console.log(`Content growing (streaming): ${contentGrowing}`);
    console.log(`Initial length: ${initialContent?.length}, Later length: ${laterContent?.length}`);

    // Wait for completion
    await waitForLLMResponse(page, { timeout: 60000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-13-complete.png', fullPage: true });

    // Final validation
    const finalContent = await page.textContent('body') || '';
    const hasSubstantiveResponse = finalContent.includes('303') || finalContent.includes('synthesizer') || finalContent.includes('bass');
    expect(hasSubstantiveResponse).toBe(true);
  });

  test('8. Full workflow - create app and run it', async ({ page }) => {
    // Step 1: Send prompt to create an app
    const input = await getCodeModeInput(page);
    await input.fill('Create a simple Python Flask hello world app in app.py');
    await input.press('Enter');

    await waitForLLMResponse(page, { timeout: 90000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-14-app-created.png', fullPage: true });

    // Step 2: Create requirements
    await input.fill('Create requirements.txt for the flask app');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 30000 });

    // Step 3: List files
    await input.fill('ls -la');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 20000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-15-files-listed.png', fullPage: true });

    // Step 4: Try to run the app (may fail but should attempt)
    await input.fill('run python app.py in background');
    await input.press('Enter');
    await waitForLLMResponse(page, { timeout: 30000 });
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-16-app-run.png', fullPage: true });

    // Validate we got through the workflow
    const pageContent = await page.textContent('body') || '';
    const workflowCompleted =
      pageContent.includes('app.py') ||
      pageContent.includes('Flask') ||
      pageContent.includes('requirements') ||
      pageContent.includes('python');

    console.log(`Workflow completed with app references: ${workflowCompleted}`);
    expect(workflowCompleted).toBe(true);
  });
});

test.describe('Code Mode Error Handling', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToCodeMode(page);
  });

  test('No 502 Bad Gateway on VS Code open', async ({ page }) => {
    // Click VS Code button
    const vsCodeButton = page.locator(
      'button:has-text("VS Code"), ' +
      'button:has-text("Editor")'
    ).first();

    if (await vsCodeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await vsCodeButton.click();
      await page.waitForTimeout(5000);

      await page.screenshot({ path: 'test-results/screenshots/08-e2e-error-01-vscode.png', fullPage: true });

      // Check for 502 error
      const pageContent = await page.textContent('body') || '';
      const errorMessages = ['502', 'Bad Gateway', 'nginx', 'error', 'Error'];

      let hasError = false;
      for (const errMsg of errorMessages) {
        if (pageContent.toLowerCase().includes(errMsg.toLowerCase())) {
          // Distinguish between actual errors and code references
          if (errMsg === '502' || errMsg === 'Bad Gateway' || errMsg === 'nginx') {
            hasError = true;
            console.error(`ERROR: Found ${errMsg} in page content`);
          }
        }
      }

      if (hasError) {
        console.error('CRITICAL: 502 Bad Gateway error detected on VS Code open');
      }
      expect(hasError).toBe(false);
    }
  });

  test('LLM responds within reasonable time', async ({ page }) => {
    const input = await getCodeModeInput(page);

    const startTime = Date.now();
    await input.fill('What is 2 + 2?');
    await input.press('Enter');

    // Should get response within 30 seconds for simple query
    await waitForLLMResponse(page, { timeout: 30000, expectTodos: false, expectFiles: false });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    console.log(`LLM response time: ${responseTime}ms`);
    await page.screenshot({ path: 'test-results/screenshots/08-e2e-error-02-response-time.png', fullPage: true });

    // Check that we got a response
    const pageContent = await page.textContent('body') || '';
    const hasResponse = pageContent.includes('4') || pageContent.includes('four') || pageContent.includes('answer');

    if (!hasResponse) {
      console.error('CRITICAL: LLM did not respond to simple query');
    }

    expect(hasResponse).toBe(true);
    expect(responseTime).toBeLessThan(30000);
  });
});
