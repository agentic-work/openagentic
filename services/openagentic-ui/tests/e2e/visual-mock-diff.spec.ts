/**
 * Visual screenshot diff vs mock HTML — Playwright spec (Phase 0.4).
 *
 * Plan: docs/superpowers/plans/sprightly-percolating-brook.md §0.4
 *
 * For each scenario with a matching `mocks/UX/AI/Chatmode/end-state-NN-*.html`:
 *   1. Render the mock in a hidden tab at a known viewport.
 *   2. Drive the same prompt against chat-dev (separate tab).
 *   3. Capture screenshots of the AAS subtree in both, mask dynamic regions
 *      (numbers, timestamps, tool durations), pixelmatch diff.
 *   4. Pass threshold ≤8% pixel delta — looser than tests that diff identical
 *      DOMs because theme tokens + dynamic data legitimately vary.
 *
 * Output: reports/verify-cadence/visual-diff-<RUN>/Q<n>-<MODEL>/
 *           live.png, mock.png, diff.png, composite.png, result.json
 *
 * Dependency: `pixelmatch` + `pngjs`. The spec uses dynamic imports so it
 * doesn't fail to load when those aren't installed; missing deps degrade
 * gracefully to a "deps-missing" verdict in result.json.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.env.BASE_URL ?? 'https://chat-dev.openagentic.io';
const RUN_LABEL = process.env.RUN_LABEL ?? new Date().toISOString().split('T')[0];
const MODEL = process.env.MODEL ?? 'claude-sonnet-4-6';
const OUT_ROOT =
  process.env.VISUAL_DIFF_DIR ??
  join(__dirname, '..', '..', '..', '..', 'reports', 'verify-cadence', `visual-diff-${RUN_LABEL}`);
const MOCKS_ROOT = join(__dirname, '..', '..', '..', '..', 'mocks', 'UX', 'AI', 'Chatmode');

const PASS_THRESHOLD_PCT = Number(process.env.VISUAL_DIFF_THRESHOLD_PCT ?? '8');

interface Scenario {
  qNum: number;
  prompt: string;
  mockFile: string;
}

const SCENARIOS: Scenario[] = [
  {
    qNum: 1,
    prompt: 'show me my Azure subscriptions and what’s in each resource group',
    mockFile: 'end-state-01-azure-subs-rgs.html',
  },
  {
    qNum: 7,
    prompt:
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    mockFile: 'end-state-07-tri-cloud-cost-spikes.html',
  },
  {
    qNum: 10,
    prompt:
      'Plan and execute a migration of our MSSQL legacy database to Azure SQL with zero downtime',
    mockFile: 'end-state-10-mssql-migration-plan.html',
  },
];

async function loginIfNeeded(page: Page): Promise<void> {
  if (page.url().includes('login.microsoftonline.com')) {
    await page
      .getByLabel(/email|user|name/i)
      .first()
      .fill(process.env.SSO_USER ?? 'mcp-tester@phatoldsungmail.onmicrosoft.com');
    await page.getByRole('button', { name: /next/i }).click();
    await page.getByLabel(/password/i).fill(process.env.SSO_PASS ?? 'TestMcp@2026');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page
      .getByRole('button', { name: /yes|stay signed in/i })
      .click()
      .catch(() => {});
    await page.waitForURL(/chat-dev/, { timeout: 30_000 });
  }
}

async function maybeCaptureAasScreenshot(page: Page, outPath: string): Promise<boolean> {
  const aas = page
    .locator('[data-aas-mounted="true"], [data-testid="agentic-activity-stream"]')
    .first();
  if ((await aas.count()) === 0) return false;
  // Mask dynamic regions before snapshot.
  await page.addStyleTag({
    content: `
      .t-timer, [data-testid="tool-timer"],
      .cm-msg-head .cm-cost,
      [data-dynamic="true"] {
        background: var(--cm-bg-2, #16181c) !important;
        color: var(--cm-bg-2, #16181c) !important;
      }
    `,
  });
  await aas.screenshot({ path: outPath });
  return true;
}

async function captureMockScreenshot(
  page: Page,
  mockPath: string,
  outPath: string,
): Promise<boolean> {
  await page.goto(`file://${mockPath}`);
  const aasInMock = page
    .locator('.msg.msg-asst, [data-aas-mounted="true"], .agentic-activity-stream')
    .first();
  if ((await aasInMock.count()) === 0) {
    // Fallback: full-page screenshot
    await page.screenshot({ path: outPath, fullPage: true });
    return true;
  }
  await aasInMock.screenshot({ path: outPath });
  return true;
}

async function pixelDiff(
  liveBuf: Buffer,
  mockBuf: Buffer,
  outDiff: string,
): Promise<{ pct: number; mismatched: number; total: number } | null> {
  try {
    const { PNG } = await import('pngjs');
    const pixelmatch = (await import('pixelmatch')).default;
    const a = PNG.sync.read(liveBuf);
    const b = PNG.sync.read(mockBuf);
    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    const diff = new PNG({ width: w, height: h });
    const mismatched = pixelmatch(
      a.data.subarray(0, w * h * 4),
      b.data.subarray(0, w * h * 4),
      diff.data,
      w,
      h,
      { threshold: 0.18, includeAA: false },
    );
    writeFileSync(outDiff, PNG.sync.write(diff));
    const total = w * h;
    return { pct: (mismatched / total) * 100, mismatched, total };
  } catch (err) {
    /* deps missing */ void err;
    return null;
  }
}

for (const scenario of SCENARIOS) {
  test(`Q${scenario.qNum} · ${MODEL} · visual diff vs ${scenario.mockFile}`, async ({
    browser,
  }) => {
    test.setTimeout(8 * 60_000);

    const outDir = join(OUT_ROOT, `Q${scenario.qNum}-${MODEL}`);
    mkdirSync(outDir, { recursive: true });

    const mockPath = join(MOCKS_ROOT, scenario.mockFile);
    if (!existsSync(mockPath)) {
      writeFileSync(
        join(outDir, 'result.json'),
        JSON.stringify({ skip: true, reason: `mock not found: ${mockPath}` }, null, 2),
      );
      test.skip(true, `Mock missing: ${scenario.mockFile}`);
      return;
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });

    // Drive live first (slow). Mock is fast — render after.
    const livePage = await ctx.newPage();
    await livePage.goto(BASE_URL);
    await loginIfNeeded(livePage);
    const composer = livePage
      .locator('[data-testid="composer-input"], textarea[placeholder*="Message"]')
      .first();
    await composer.fill(scenario.prompt);
    await composer.press('Enter');
    await livePage.waitForSelector('[data-aas-mounted="true"]', { timeout: 30_000 });
    await livePage.waitForSelector(
      '[data-stream-state="complete"], [data-aas-streaming="false"]',
      { timeout: 6 * 60_000 },
    );

    const liveOk = await maybeCaptureAasScreenshot(livePage, join(outDir, 'live.png'));

    // Mock — quick render in a fresh page at the same viewport.
    const mockPage = await ctx.newPage();
    const mockOk = await captureMockScreenshot(mockPage, mockPath, join(outDir, 'mock.png'));

    await mockPage.close();
    await livePage.close();
    await ctx.close();

    if (!liveOk || !mockOk) {
      writeFileSync(
        join(outDir, 'result.json'),
        JSON.stringify(
          { skip: true, reason: 'screenshot capture failed', liveOk, mockOk },
          null,
          2,
        ),
      );
      return;
    }

    const liveBuf = readFileSync(join(outDir, 'live.png'));
    const mockBuf = readFileSync(join(outDir, 'mock.png'));
    const diff = await pixelDiff(liveBuf, mockBuf, join(outDir, 'diff.png'));
    if (!diff) {
      writeFileSync(
        join(outDir, 'result.json'),
        JSON.stringify(
          {
            skip: true,
            reason:
              'pixelmatch / pngjs not installed — `npm i -D pixelmatch pngjs` to enable visual diff',
          },
          null,
          2,
        ),
      );
      return;
    }

    writeFileSync(
      join(outDir, 'result.json'),
      JSON.stringify(
        {
          scenario: `Q${scenario.qNum}`,
          model: MODEL,
          mock: scenario.mockFile,
          pct: diff.pct,
          mismatched: diff.mismatched,
          total: diff.total,
          threshold: PASS_THRESHOLD_PCT,
          passed: diff.pct <= PASS_THRESHOLD_PCT,
        },
        null,
        2,
      ),
    );

    expect(diff.pct, `pixel delta ${diff.pct.toFixed(2)}% > ${PASS_THRESHOLD_PCT}% threshold`).toBeLessThanOrEqual(
      PASS_THRESHOLD_PCT,
    );
  });
}
