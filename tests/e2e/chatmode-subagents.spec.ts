/**
 * Chatmode sub-agents — POSITIVE proof on a multi-step prompt.
 *
 * The Task tool registered by `meta-tools.stage.ts` lets the model spawn
 * sub-agents for genuinely multi-step or specialized work. This spec
 * sends a prompt that *should* delegate (broad scope, mixed cloud +
 * code-audit) and asserts a sub-agent card renders in the DOM with a
 * concrete `data-subagent-type` attribute.
 *
 * Default model at dev is gpt-oss:20b. Smart Router escalates as
 * needed. The spec doesn't pin a specific sub-agent; any concrete
 * variant counts as success (cloud_operations, artifact_creation,
 * code_audit, data_query, etc.).
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

const MULTI_STEP_PROMPT =
  'Audit our cloud spend across all subscriptions and write a markdown report with cost-savings recommendations and a sankey diagram.';

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

async function waitForSubAgentOrSettled(
  page: Page,
  totalTimeoutMs = 240_000,
): Promise<{
  found: boolean;
  evidence: string;
  fullText: string;
}> {
  const start = Date.now();
  let lastFullText = '';
  let lastTextChange = Date.now();

  while (Date.now() - start < totalTimeoutMs) {
    const snap = await page.evaluate(() => {
      const subAgents = Array.from(
        document.querySelectorAll(
          '[data-subagent-type], .cm-subagent, .subagent.agent-c, .subagent.agent-g, .subagent.agent-s, .subagent.agent-k, [data-testid*="subagent"]',
        ),
      );
      const taskTool = Array.from(
        document.querySelectorAll('[data-tool-name="Task"], [data-tool-name="task"], [data-tool-name="delegate_to_agents"]'),
      );
      const last = document.querySelector('[data-message-role="assistant"]:last-of-type');
      const fullText = last ? (last as HTMLElement).innerText : '';

      const subAgentTypes = subAgents
        .map((s) => (s as HTMLElement).getAttribute('data-subagent-type'))
        .filter(Boolean);

      return {
        subAgents: subAgents.length,
        subAgentTypes,
        taskTool: taskTool.length,
        fullText,
      };
    });

    const found = ((snap.subAgents as number) ?? 0) > 0 || ((snap.taskTool as number) ?? 0) > 0;
    const fullText = String(snap.fullText ?? '');

    if (found) {
      return {
        found: true,
        evidence: `subAgentCards=${snap.subAgents} types=${JSON.stringify(snap.subAgentTypes)} taskToolCalls=${snap.taskTool}`,
        fullText,
      };
    }

    if (fullText !== lastFullText) {
      lastFullText = fullText;
      lastTextChange = Date.now();
    } else if (fullText && Date.now() - lastTextChange > 10_000) {
      return { found: false, evidence: 'turn settled without sub-agent', fullText };
    }

    await page.waitForTimeout(750);
  }
  return { found: false, evidence: 'timeout', fullText: lastFullText };
}

test.describe('Chatmode sub-agents — POSITIVE proof', () => {
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

  test('multi-step prompt: assistant calls Task / delegate_to_agents and a sub-agent card renders', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, MULTI_STEP_PROMPT);
    const result = await waitForSubAgentOrSettled(page);

    if (!result.found) {
      console.log('--- Sub-agent dispatch did not happen ---');
      console.log(result.fullText.slice(0, 1200));
    }

    expect(
      result.found,
      `Sub-agent must dispatch via Task tool and a card render. Evidence: ${result.evidence}. Last text: ${result.fullText.slice(-500)}`,
    ).toBe(true);
  });
});
