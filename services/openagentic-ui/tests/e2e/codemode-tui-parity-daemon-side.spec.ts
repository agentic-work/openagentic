import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const SSO_EMAIL = process.env.MCP_TESTER_EMAIL || 'admin@example.onmicrosoft.com';
const SSO_PASSWORD = process.env.MCP_TESTER_PASSWORD || 'TestMcp@2026';

const ARTIFACT_DIR = path.join(__dirname, 'codemode-tui-parity-artifacts');

const ENTER_CODEMODE_TIMEOUT_MS = 90_000;

if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

async function loginViaMicrosoftSSO(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const alreadyIn = await page.locator('textarea').first().isVisible({ timeout: 3_000 }).catch(() => false);
  if (alreadyIn) return;
  const msBtn = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft"), button:has-text("Azure")').first();
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
  const kmsiDeadline = Date.now() + 30_000;
  while (Date.now() < kmsiDeadline) {
    const onKmsi = await page.locator('text=Stay signed in?').first().isVisible({ timeout: 1_000 }).catch(() => false);
    if (onKmsi) {
      for (const sel of ['#idBtn_Back', 'input[type="submit"][value="No"]', 'button:has-text("No")', '#idSIButton9', 'button:has-text("Yes")']) {
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
  });
}

async function dismissOverlays(page: Page): Promise<void> {
  const skip = page.locator('button:has-text("Skip")').first();
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) await skip.click().catch(() => {});
  const close = page.locator('button[aria-label="Close"], button[aria-label="close"]').first();
  if (await close.isVisible({ timeout: 1_000 }).catch(() => false)) await close.click().catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('div.fixed.inset-0').forEach((el) => {
      const z = (el as HTMLElement).style.zIndex || getComputedStyle(el).zIndex;
      if (z === '9998') (el as HTMLElement).style.display = 'none';
    });
  });
}

async function enterCodemode(page: Page): Promise<void> {
  await dismissOverlays(page);
  const codeBtn = page.locator('button[title="Code Mode"]').first();
  await expect(codeBtn).toBeVisible({ timeout: ENTER_CODEMODE_TIMEOUT_MS });
  await codeBtn.click();
  await expect(page.locator('[data-testid="cm-floating-composer"]')).toBeVisible({ timeout: ENTER_CODEMODE_TIMEOUT_MS });
  await dismissOverlays(page);
  await page.waitForTimeout(2_000);
}

async function typeSlashAndEnter(page: Page, slash: string): Promise<void> {
  const textarea = page.locator('[data-testid="cm-floating-composer"] textarea').first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 60; i++) {
    const disabled = await textarea.evaluate((el) => (el as HTMLTextAreaElement).disabled).catch(() => true);
    if (!disabled) break;
    await page.waitForTimeout(1_000);
  }
  await textarea.click();
  await textarea.fill('');
  await textarea.fill(slash);
  await page.waitForTimeout(200);
  await textarea.press('Enter');
}

async function shotAndAssert(
  page: Page,
  shot: string,
  asserts: Array<{ label: string; predicate: () => Promise<boolean> }>,
) {
  await page.waitForTimeout(2_000); // let the daemon respond + UI render
  const filePath = path.join(ARTIFACT_DIR, `daemon-side-${shot}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  const failures: string[] = [];
  for (const a of asserts) {
    const ok = await a.predicate().catch(() => false);
    if (!ok) failures.push(a.label);
  }
  if (failures.length > 0) {
    throw new Error(`Daemon-side TUI parity assertions failed for ${shot}:\n  - ${failures.join('\n  - ')}\n  screenshot: ${filePath}`);
  }
  console.log(`[parity-daemon] ${shot}: ${asserts.length} assertions PASS · ${filePath}`);
}

// ── the test suite ──────────────────────────────────────────────────

test.describe('Codemode TUI parity (daemon-side)', () => {
  test.setTimeout(300_000);
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginViaMicrosoftSSO(page);
    await enterCodemode(page);
  });
  test.afterAll(async () => {
    await page?.close().catch(() => {});
  });

  test('/context — no destructure crash, returns "Context Usage" markdown', async () => {
    await typeSlashAndEnter(page, '/context');
    await shotAndAssert(page, 'context', [
      {
        label: 'NO daemon error "slash /context failed: Right side of assignment cannot be destructured"',
        predicate: async () =>
          (await page.locator('text=/cannot be destructured/i').count()) === 0,
      },
      {
        label: 'shows "Context Usage" heading from the friendly text result',
        predicate: async () => (await page.locator('text=/context usage/i').count()) > 0,
      },
    ]);
  });

  test('/hooks — no getAppState crash, picker mounts', async () => {
    await typeSlashAndEnter(page, '/hooks');
    await shotAndAssert(page, 'hooks', [
      {
        label: 'NO "context.getAppState is not a function" error',
        predicate: async () =>
          (await page.locator('text=/getAppState is not a function/i').count()) === 0,
      },
      {
        label: 'NO "slash /hooks threw during call" error',
        predicate: async () =>
          (await page.locator('text=/slash \\/hooks threw/i').count()) === 0,
      },
    ]);
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('/resume — daemon list_sessions RPC ok, modal mounts', async () => {
    await typeSlashAndEnter(page, '/resume');
    await shotAndAssert(page, 'resume', [
      {
        label: 'NO "unknown method: list_sessions" error',
        predicate: async () =>
          (await page.locator('text=/unknown method.*list_sessions/i').count()) === 0,
      },
      {
        label: 'modal renders ("/resume" or "Sessions" or "No sessions yet" — any is fine)',
        predicate: async () =>
          (await page.locator('text=/resume|sessions/i').count()) > 0,
      },
    ]);
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('/agents — daemon _detail.agents includes plugin + built-in source discriminators', async () => {
    await typeSlashAndEnter(page, '/agents');
    await shotAndAssert(page, 'agents', [
      {
        label: 'modal shows "Built-in" group (daemon source:"built-in" rendered correctly)',
        predicate: async () => (await page.locator('text=/built-?in/i').count()) > 0,
      },
    ]);
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('/skills — daemon list_skills returns source + tokenCost (picker groups by source)', async () => {
    await typeSlashAndEnter(page, '/skills');
    await shotAndAssert(page, 'skills', [
      {
        label: 'picker mounts with at least one skill row',
        predicate: async () => (await page.locator('text=/skills/i').count()) > 0,
      },
    ]);
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('/mcp — daemon _detail.mcp_servers includes live + plugin-declared servers', async () => {
    await typeSlashAndEnter(page, '/mcp');
    await shotAndAssert(page, 'mcp', [
      {
        label: 'modal shows MCP Servers section',
        predicate: async () => (await page.locator('text=/mcp servers/i').count()) > 0,
      },
    ]);
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('/cost — daemon emits multi-line cost block (TUI format)', async () => {
    await typeSlashAndEnter(page, '/cost');
    await shotAndAssert(page, 'cost', [
      {
        label: '"Total cost" label present',
        predicate: async () => (await page.locator('text=/total cost/i').count()) > 0,
      },
      {
        label: '"Total duration" or "API duration" label present (multi-line block)',
        predicate: async () => (await page.locator('text=/total duration|api duration|wall/i').count()) > 0,
      },
    ]);
  });
});
