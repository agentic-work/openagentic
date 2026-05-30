/**
 * Chatmode V2 architecture — live validation against the failing prompt.
 *
 * This is the spec the user demanded: the exact failing prompt
 *   "show me cloud resources and give me a sankey cost diagram for the
 *    last 6 months"
 * blew up THREE times in a row before the V2 architectural rewrite. Today
 * it must produce a clean assistant turn with NO sub-agent confabulation
 * slide-out + NO regex log lines on the api side.
 *
 * Auth: same `.auth/user.json` as release-readiness.spec.ts — JWT in
 * localStorage `auth_token` and `openagentic_token` cookie.
 *
 * Plan reference: <internal-plan>
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

const FAILING_PROMPT =
  'show me cloud resources and give me a sankey cost diagram for the last 6 months';

const CONFABULATION_PHRASES = [
  /I don'?t have (?:any |the )?(?:azure|aws|gcp|cloud) tools? available/i,
  /I (?:cannot|can'?t) (?:access|reach|see) (?:your |any )?(?:azure|aws|gcp|cloud)/i,
  /no .* tools? (?:are )?(?:available|configured|enabled)/i,
];

/**
 * Hardcoded-bias phrases — these were the user's smoking gun. The legacy
 * mcp.stage.ts had `cloudKeywords` containing the literal `'s3'`,
 * `ESSENTIAL_TYPED_TOOLS` listed `aws_s3_list`/`aws_ec2_list`, and the
 * `aws-ops` prompt module told the model "aws_s3_* for S3 operations".
 * The combo trained the model to talk about S3 when asked about "cloud
 * resources" generically. Post-rip, the assistant must NOT introduce
 * specific service names (S3, EC2, RDS, Lambda, DynamoDB) without the
 * user mentioning them first.
 */
const UNSOLICITED_SERVICE_BIAS = [
  /\bS3\b/,
  /\bEC2\b/,
  /\bLambda\b/,
  /\bDynamoDB\b/,
  /\bRDS\b/,
];

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Chat message input' });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

async function waitForAssistantSettled(
  page: Page,
  opts: { totalTimeoutMs?: number; quietMs?: number } = {},
): Promise<string> {
  const total = opts.totalTimeoutMs ?? 240_000;
  const quiet = opts.quietMs ?? 5_000;
  const start = Date.now();
  let lastText = '';
  let lastChange = Date.now();
  while (Date.now() - start < total) {
    const text = await page.evaluate(() => {
      const blocks = document.querySelectorAll('[data-message-role="assistant"]');
      const last = blocks[blocks.length - 1];
      return last ? (last as HTMLElement).innerText : '';
    });
    if (text !== lastText) {
      lastText = text;
      lastChange = Date.now();
    } else if (text && Date.now() - lastChange > quiet) {
      return text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `assistant turn did not settle within ${total}ms; lastText=${lastText.slice(0, 200)}`,
  );
}

async function newChatSession(page: Page): Promise<void> {
  await page
    .getByRole('textbox', { name: 'Chat message input' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  const newChatBtn = page.getByRole('button', { name: 'New Chat', exact: true }).first();
  await newChatBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await newChatBtn.click({ timeout: 15_000 });
  await page.waitForTimeout(1500);
}

test.describe('Chatmode V2 — RIP regex intent routing', () => {
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

  test('failing prompt produces a real assistant response, not confabulation', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, FAILING_PROMPT);
    const reply = await waitForAssistantSettled(page);
    expect(reply.length, 'assistant must produce non-empty text').toBeGreaterThan(50);
    for (const re of CONFABULATION_PHRASES) {
      expect(
        reply,
        `assistant must not confabulate "I don't have cloud tools" — got: ${reply.slice(0, 240)}`,
      ).not.toMatch(re);
    }
  });

  test('failing prompt: assistant does NOT introduce S3 / EC2 / etc. unsolicited (rip ESSENTIAL_TYPED_TOOLS + cloudKeywords + aws-ops bias)', async ({
    page,
  }) => {
    await newChatSession(page);
    await sendChat(page, FAILING_PROMPT);
    const reply = await waitForAssistantSettled(page);
    for (const re of UNSOLICITED_SERVICE_BIAS) {
      expect(
        reply,
        `assistant must NOT introduce a specific AWS service the user did not ask for; the user said "cloud resources" generically. Got: ${reply.slice(0, 360)}`,
      ).not.toMatch(re);
    }
  });

  test('failing prompt does not auto-spawn artifact_creation sub-agent before any tool runs', async ({
    page,
  }) => {
    await newChatSession(page);
    await sendChat(page, FAILING_PROMPT);

    // The legacy bug: agents.stage's isSimpleQuery() classified this as
    // "simple", bypassed the gate, and the LLM (with delegate_to_agents
    // injected) called artifact_creation FIRST — burning 23k tokens to
    // confabulate. With V2 deletion, this bypass cannot happen.
    //
    // We don't ban sub-agent cards entirely (the model can still pick
    // Task → artifact_creation as a deliberate step). What we ban is
    // an artifact_creation card appearing as the FIRST visible action
    // without any tool call preceding it.
    const firstSubagentBeforeTool = await page.evaluate(async () => {
      const POLL_MS = 60_000;
      const start = Date.now();
      while (Date.now() - start < POLL_MS) {
        const sub = document.querySelector('[data-subagent-type="artifact_creation"], .subagent.agent-c');
        const tool = document.querySelector('.tool, [data-tool-card]');
        if (sub && !tool) return true; // bug shape
        if (tool) return false; // healthy
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    });
    expect(
      firstSubagentBeforeTool,
      'artifact_creation sub-agent must not appear before any tool call (regex-bypass legacy bug)',
    ).toBe(false);

    // And the assistant DOES eventually settle.
    await waitForAssistantSettled(page);
  });
});
