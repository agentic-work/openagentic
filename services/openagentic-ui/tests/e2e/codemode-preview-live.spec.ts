import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const SSO_EMAIL = process.env.MCP_TESTER_EMAIL || 'admin@example.onmicrosoft.com';
const SSO_PASSWORD = process.env.MCP_TESTER_PASSWORD || 'TestMcp@2026';

// __dirname isn't defined under ESM-style spec runs; derive from import.meta
// when available, fall back to process.cwd() for CJS contexts.
const SPEC_DIR = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const SCREENSHOT_PATH = path.join(SPEC_DIR, 'codemode-preview-live.png');

const ENTER_CODEMODE_TIMEOUT_MS = 90_000;
const PREVIEW_APPEAR_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// SSO + codemode-entry helpers — mirror codemode-live-proof.spec.ts.
// ---------------------------------------------------------------------------

async function loginViaMicrosoftSSO(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const alreadyIn = await page.locator('textarea').first().isVisible({ timeout: 3_000 }).catch(() => false);
  if (alreadyIn) return;

  const msBtn = page
    .locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft"), button:has-text("Azure")')
    .first();
  if (await msBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await msBtn.click();
    await page.waitForLoadState('networkidle');
  }

  const emailInput = page.locator('input[type="email"], input[name="loginfmt"]').first();
  if (await emailInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await emailInput.fill(SSO_EMAIL);
    await page.locator('input[type="submit"], button:has-text("Next")').first().click();
  }

  const pwInput = page.locator('input[type="password"], input[name="passwd"]').first();
  if (await pwInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await pwInput.fill(SSO_PASSWORD);
    await page.locator('input[type="submit"], button:has-text("Sign in")').first().click();
  }

  // KMSI page handling.
  const kmsiDeadline = Date.now() + 30_000;
  while (Date.now() < kmsiDeadline) {
    const onKmsi = await page.locator('text=Stay signed in?').first().isVisible({ timeout: 1_000 }).catch(() => false);
    if (onKmsi) {
      const candidates = ['#idBtn_Back', '#idSIButton9', 'input[type="submit"][value="No"]', 'input[type="submit"][value="Yes"]'];
      for (const sel of candidates) {
        const c = page.locator(sel).first();
        if (await c.isVisible({ timeout: 500 }).catch(() => false)) {
          await c.click().catch(() => {});
          break;
        }
      }
      break;
    }
    if (page.url().startsWith(BASE_URL)) break;
    await page.waitForTimeout(500);
  }

  await page.waitForURL(`${BASE_URL}/**`, { timeout: 60_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  await page.evaluate(() => {
    localStorage.setItem('onboarding_completed', 'true');
    localStorage.setItem('ac-welcome-shown', 'true');
  });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});

  await page.waitForSelector('textarea', { timeout: 30_000 });
}

async function dismissOverlays(page: Page): Promise<void> {
  const skipBtn = page.locator('button:has-text("Skip")').first();
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click().catch(() => {});
  }
  await page.evaluate(() => {
    document.querySelectorAll('div.fixed.inset-0').forEach((el) => {
      const z = (el as HTMLElement).style.zIndex || getComputedStyle(el).zIndex;
      if (z === '9998' || (el as HTMLElement).className.includes('z-[9998]')) {
        (el as HTMLElement).style.display = 'none';
      }
    });
  });
}

async function enterCodemode(page: Page): Promise<void> {
  await dismissOverlays(page);

  const codeBtn = page.locator('button[title="Code Mode"]').first();
  await expect(codeBtn).toBeVisible({ timeout: ENTER_CODEMODE_TIMEOUT_MS });
  await codeBtn.click();

  await expect(page.locator('[data-testid="cm-floating-composer"]')).toBeVisible({
    timeout: ENTER_CODEMODE_TIMEOUT_MS,
  });
  await dismissOverlays(page);
  await page.waitForTimeout(2_000);
}

async function submitPrompt(page: Page, prompt: string): Promise<void> {
  const textarea = page.locator('[data-testid="cm-floating-composer"] textarea').first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  // Wait for daemon-socket connect — placeholder flips to "Describe …".
  for (let i = 0; i < 60; i++) {
    const disabled = await textarea.evaluate((el) => (el as HTMLTextAreaElement).disabled).catch(() => true);
    const placeholder = await textarea.getAttribute('placeholder').catch(() => null);
    if (!disabled && placeholder?.toLowerCase().includes('describe')) break;
    await page.waitForTimeout(1_000);
  }
  await textarea.click();
  await textarea.fill(prompt);
  const value = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value).catch(() => '');
  if (value !== prompt) {
    await textarea.fill('');
    await textarea.fill(prompt);
  }
  await page.waitForTimeout(300);
  await textarea.press('Enter');
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('codemode inline preview — live proof', () => {
  test.setTimeout(360_000);

  test('agent prompt that starts a server triggers an inline iframe pointed at /api/code/preview/...', async ({ page }) => {
    await loginViaMicrosoftSSO(page);
    await enterCodemode(page);

    // The detection scans the daemon's progress-frame stream + the
    // final tool_result content. Bash tools that auto-background only
    // give us the "Command running in background with ID: …" line
    // (no boot banner). To force the boot banner into a tool_result
    // we wrap the server in `timeout` so it runs synchronously, prints
    // its banner, and exits cleanly — the result text will contain
    // "Serving HTTP on 0.0.0.0 port <PORT>" which the daemon detects.
    //
    // Background after exit: the `nohup … &` tail spawns a long-lived
    // server backgrounded BEFORE the timeout-bound foreground process
    // exits, so port stays open for the proxy probe. The 2s sleep gives
    // it time to bind. Process keeps living because nohup detaches it
    // from the bash session that bash tool spawned.
    // Use a unique port per test run so a prior session's chat history
    // (which the agent remembers within the same chat) doesn't bias the
    // next attempt with "port already in use" anchoring.
    const TEST_PORT = 9000 + Math.floor(Math.random() * 500);
    const PROMPT =
      `Run this exact command in the foreground (single Bash tool call, no run_in_background): ` +
      `\`echo test-preview-$(date +%s) > index.html && nohup python3 -u -m http.server ${TEST_PORT} > /tmp/srv.log 2>&1 & sleep 2 && cat /tmp/srv.log\`. ` +
      `Then reply with the URL when you see the "Serving HTTP" banner.`;
    await submitPrompt(page, PROMPT);

    // Wait for either the preview block to mount OR the agent to give up.
    const previewLocator = page.locator('[data-part="preview"]').first();
    await previewLocator.waitFor({ state: 'attached', timeout: PREVIEW_APPEAR_TIMEOUT_MS });

    // Iframe contract.
    const iframe = previewLocator.locator('[data-testid="cm-preview-iframe"]').first();
    await expect(iframe).toBeAttached({ timeout: 30_000 });
    const src = await iframe.getAttribute('src');
    expect(src, 'iframe src must be the openagentic-api path-proxy URL').toMatch(/\/api\/code\/preview\/[^/]+\/\d+\//);
    expect(src, 'iframe src must NOT point at the raw pod-local URL').not.toMatch(/localhost:\d+/);

    // Direct proxy probe — server-side fetch via page.request to confirm
    // the proxy actually forwards through to the pod and returns the
    // served body. Cookies are reused from the page context so the auth
    // gate passes.
    const absoluteSrc = new URL(src!, BASE_URL).toString();
    const probe = await page.request.get(absoluteSrc);
    const probeStatus = probe.status();
    const probeBody = await probe.text();
    expect(
      probeStatus,
      `proxy probe ${absoluteSrc} returned ${probeStatus} — expected 200`,
    ).toBe(200);
    expect(
      probeBody,
      'proxy body should contain the served file (test-preview-…)',
    ).toContain('test-preview-');

    // Capture screenshot evidence.
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    // eslint-disable-next-line no-console
    console.log(
      `[preview-e2e] PASS — iframe src=${src}, probe HTTP ${probeStatus}, ` +
        `screenshot=${SCREENSHOT_PATH}`,
    );
  });
});
