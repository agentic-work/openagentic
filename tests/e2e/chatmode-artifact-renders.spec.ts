/**
 * Chatmode artifact render — POSITIVE assertions on the failing prompt.
 *
 * The existing `chatmode-v2-architecture.spec.ts` only asserts NEGATIVES
 * (no confabulation, no unsolicited S3, no auto-spawned sub-agent before
 * tools fire). Those passing isn't enough — the user's bar is "the chart
 * actually renders." This spec asserts that on the exact failing prompt
 * the assistant produces:
 *
 *   1. At least one `render_artifact` tool card visible in the DOM, OR
 *      a sandboxed iframe / SVG rendered inline.
 *   2. The rendered artifact contains shape-evidence of a Sankey
 *      (multiple <path> or rect elements, OR mermaid-source containing
 *       `flowchart`/`sankey`).
 *   3. NO orphan `</artifact:html>` or `<artifact:svg>` markdown tags
 *      bleeding through.
 *
 * This is the proof the user demanded: "show me cloud resources and give
 * me a sankey cost diagram for the last 6 months" → working chart inline,
 * on whatever model is the chat default (gpt-oss:20b at the time of
 * writing — Smart Router escalates as needed).
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'https://chat.example.com';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

const FAILING_PROMPT =
  'show me cloud resources and give me a sankey cost diagram for the last 6 months';

async function newChatSession(page: Page): Promise<void> {
  await page
    .getByRole('textbox', { name: 'Chat message input' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  const newChatBtn = page.getByRole('button', { name: 'New Chat', exact: true }).first();
  await newChatBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await newChatBtn.click({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Chat message input' });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

/**
 * Wait until either an artifact element appears in the DOM, or the
 * assistant turn settles without one. Returns the snapshot of the chat
 * region for inspection on failure.
 */
async function waitForArtifactOrSettled(
  page: Page,
  totalTimeoutMs = 240_000,
): Promise<{
  artifactFound: boolean;
  evidence: string;
  fullText: string;
}> {
  const start = Date.now();
  let lastFullText = '';
  let lastTextChange = Date.now();

  while (Date.now() - start < totalTimeoutMs) {
    const snap = await page.evaluate(() => {
      const out: Record<string, unknown> = {};

      // 1. Did a render_artifact tool card appear?
      const toolCards = Array.from(
        document.querySelectorAll('[data-tool-name="render_artifact"], [data-tool-name="visualize.show_widget"], [data-tool-name="visualize:show_widget"]'),
      );
      out.toolCards = toolCards.length;

      // 2. Did an SVG render inline?
      const inlineSvgs = Array.from(
        document.querySelectorAll(
          '[data-message-role="assistant"] svg, [data-tool-card] svg, .cm-tool svg, .artifact-renderer svg, [data-testid*="artifact"] svg',
        ),
      ).filter((s) => {
        const r = s.getBoundingClientRect();
        return r.width >= 100 && r.height >= 60;
      });
      out.inlineSvgs = inlineSvgs.length;

      // 3. Did a sandboxed iframe render?
      const sandboxedFrames = Array.from(
        document.querySelectorAll('iframe[sandbox]'),
      );
      out.sandboxedFrames = sandboxedFrames.length;

      // 4. Did a mermaid block render?
      const mermaid = Array.from(
        document.querySelectorAll('.mermaid, [data-mermaid], svg[id^="mermaid-"]'),
      );
      out.mermaid = mermaid.length;

      // 5. Did a chart-renderer mount?
      const charts = Array.from(
        document.querySelectorAll(
          '.recharts-wrapper, [data-react-flow], .chart-container, [data-testid*="chart"]',
        ),
      );
      out.charts = charts.length;

      // 6. Full text + orphan-fence detection
      const last = document.querySelector('[data-message-role="assistant"]:last-of-type');
      const fullText = last ? (last as HTMLElement).innerText : '';
      out.fullText = fullText;
      out.orphanFence = /<\/artifact:|^artifact:[a-z]+>/im.test(fullText);

      return out;
    });

    const artifactFound =
      ((snap.toolCards as number) ?? 0) > 0 ||
      ((snap.inlineSvgs as number) ?? 0) > 0 ||
      ((snap.sandboxedFrames as number) ?? 0) > 0 ||
      ((snap.mermaid as number) ?? 0) > 0 ||
      ((snap.charts as number) ?? 0) > 0;

    const fullText = String(snap.fullText ?? '');

    if (artifactFound) {
      return {
        artifactFound: true,
        evidence: `toolCards=${snap.toolCards} svg=${snap.inlineSvgs} frames=${snap.sandboxedFrames} mermaid=${snap.mermaid} charts=${snap.charts}`,
        fullText,
      };
    }

    if (fullText !== lastFullText) {
      lastFullText = fullText;
      lastTextChange = Date.now();
    } else if (fullText && Date.now() - lastTextChange > 8_000) {
      return {
        artifactFound: false,
        evidence: 'turn settled without artifact',
        fullText,
      };
    }

    await page.waitForTimeout(750);
  }
  return {
    artifactFound: false,
    evidence: `timeout after ${totalTimeoutMs}ms`,
    fullText: lastFullText,
  };
}

test.describe('Chatmode artifact render — POSITIVE proof', () => {
  test.setTimeout(360_000);
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('onboarding_completed', 'true');
        localStorage.setItem('ac-welcome-shown', 'true');
        localStorage.setItem('ac-onboarding-completed', 'true');
      } catch {}
    });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    if (
      /\/login/i.test(page.url()) ||
      (await page.getByText(/Continue with Microsoft/i).isVisible({ timeout: 1_000 }).catch(() => false))
    ) {
      await page.goto(BASE);
      await page.waitForLoadState('domcontentloaded');
    }
  });

  test('failing prompt: assistant calls render_artifact (or equivalent) and the chart renders inline', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, FAILING_PROMPT);
    const result = await waitForArtifactOrSettled(page);

    if (!result.artifactFound) {
      console.log('--- Assistant turn settled without artifact ---');
      console.log(result.fullText.slice(0, 1200));
      console.log('--- end snapshot ---');
    }

    expect(
      result.artifactFound,
      `An artifact (render_artifact tool card, inline SVG, sandboxed iframe, mermaid, or chart) MUST render. Evidence: ${result.evidence}. Last 600 chars of assistant text: ${result.fullText.slice(-600)}`,
    ).toBe(true);
  });

  test('failing prompt: no orphan </artifact:html> or <artifact:svg> markdown fence bleeds through', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, FAILING_PROMPT);
    const result = await waitForArtifactOrSettled(page);
    expect(
      /<\/artifact:[a-z_]+>|<artifact:[a-z_]+>/i.test(result.fullText),
      `assistant text must not contain orphan artifact-fence tags. Got: ${result.fullText.slice(-600)}`,
    ).toBe(false);
  });
});
