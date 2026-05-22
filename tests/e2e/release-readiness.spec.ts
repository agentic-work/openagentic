/**
 * Release-readiness smoke battery — 8 probes that gate every release.
 *
 * Auth: uses `.auth/user.json` written by `tests/e2e/helpers/saveAuthState.ts`.
 * The file holds a valid JWT in both `localStorage.auth_token` and the
 * `openagentic_token` cookie. Tenant doesn't actually require Azure-AD
 * MFA — when the SSO token is fresh the UI mounts as authenticated.
 *
 * To regenerate auth (e.g. after JWT expires ~24h):
 *   1. Open chat-dev.openagentic.io in a browser, log in via SSO
 *   2. Devtools console: copy(localStorage.getItem('auth_token'))
 *   3. AUTH_JWT=<paste> npx tsx tests/e2e/helpers/saveAuthState.ts
 *
 * Run:
 *   npx playwright test tests/e2e/release-readiness.spec.ts
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

// Re-use the SSO-authenticated browser context from `.auth/user.json`.
// Without this, every probe gets a fresh empty cookie jar and the SPA
// redirects to the login wall before the chat input ever mounts.
test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

// --- Helpers ---------------------------------------------------------------

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Chat message input' });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

/**
 * Wait until the latest assistant message stops growing for `quietMs`.
 * Selectors come from the actual DOM: every chat message is a wrapper
 * with `data-message-id` + `data-message-role="assistant"|"user"`.
 */
async function waitForAssistantSettled(
  page: Page,
  opts: { totalTimeoutMs?: number; quietMs?: number } = {},
): Promise<string> {
  const total = opts.totalTimeoutMs ?? 90_000;
  const quiet = opts.quietMs ?? 4_000;
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
  throw new Error(`assistant turn did not settle within ${total}ms; lastText=${lastText.slice(0, 200)}`);
}

async function newChatSession(page: Page): Promise<void> {
  // Wait for chat shell to be ready before trying to click New Chat —
  // the button can briefly be obscured by overlays during cold mount.
  await page.getByRole('textbox', { name: 'Chat message input' }).waitFor({ state: 'visible', timeout: 30_000 });
  // There can be multiple "New Chat" buttons (sidebar + composer-empty);
  // any of them creates a fresh session. .first() avoids strict-mode error.
  const newChatBtn = page.getByRole('button', { name: 'New Chat', exact: true }).first();
  await newChatBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await newChatBtn.click({ timeout: 15_000 });
  // Allow the SPA to swap session state before we send the next prompt.
  await page.waitForTimeout(1500);
}

async function clickWorkspaceTab(page: Page, name: 'Chat' | 'Code' | 'Flows'): Promise<void> {
  // The workspace tabs in the left rail are <button name="Chat|Code|Flows">.
  // Use exact match to disambiguate from "New Chat".
  await page.getByRole('button', { name, exact: true }).click();
}

async function authedApi(request: APIRequestContext, jwt: string) {
  return {
    get: (path: string) =>
      request.get(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      }),
  };
}

function readJwt(): string {
  // The .auth/user.json carries the JWT. We re-read so probes that hit
  // the api directly can authenticate without re-walking SSO.
  const fs = require('fs');
  const path = require('path');
  const p = path.join(__dirname, '..', '..', '.auth', 'user.json');
  const state = JSON.parse(fs.readFileSync(p, 'utf8'));
  const ls = state.origins?.[0]?.localStorage?.find((e: any) => e.name === 'auth_token');
  if (!ls?.value) throw new Error(`no auth_token in ${p}`);
  return ls.value;
}

// --- Probes ---------------------------------------------------------------

test.describe('release readiness', () => {
  // Each probe uses page.goto + a new chat session, so they're independent.
  // Long upper bound matches LLM cold-start + codemode boot worst-case.
  test.setTimeout(300_000);
  // Retry once locally — guards against transient SPA auth-flicker on
  // first paint that is unrelated to the deployment under test.
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    // Suppress the OnboardingTour modal (storage key from
    // services/openagentic-ui/src/features/chat/components/OnboardingTour.tsx).
    // Without this, a `fixed z-[10000]` overlay intercepts clicks on the
    // chat input on every fresh test context.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('onboarding_completed', 'true');
        localStorage.setItem('ac-welcome-shown', 'true');
        localStorage.setItem('ac-onboarding-completed', 'true');
      } catch {}
    });
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    // Auth flicker recovery: occasionally `storageState` cookies don't
    // hydrate fast enough and the SPA redirects to /login. Reload once
    // if we land on the login screen — the cookie IS present in the
    // browser context, the SPA just raced its first auth-check.
    if (/\/login/i.test(page.url()) || await page.getByText(/Continue with Microsoft/i).isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.goto(BASE);
      await page.waitForLoadState('domcontentloaded');
    }
  });

  test('probe 1 — login + chat input visible + workspace tabs', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Chat message input' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Code', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flows', exact: true })).toBeVisible();
  });

  test('probe 2 — chat plain listing prompt produces NO unsolicited artifact', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'show me my azure subscriptions and resource groups (just text, no charts)');
    await waitForAssistantSettled(page, { totalTimeoutMs: 120_000 });
    const artifactCount = await page.locator('button.artifact-canvas-tag').count();
    expect(artifactCount, 'plain-text prompt must not produce an artifact card (#417)').toBe(0);
  });

  test('probe 3 — chat visualization prompt produces an artifact (inline tag or right-panel)', async ({ page }) => {
    await newChatSession(page);
    await sendChat(
      page,
      'Visualize this as a small interactive HTML chart. Wrap the entire html document inside one triple-backtick fenced block tagged `artifact:html`. The chart should have three bars labeled A, B, C with heights 1, 2, 3.',
    );
    // The artifact path is one of two surfaces depending on routing:
    //   a) inline ArtifactTag — `button.artifact-canvas-tag`
    //   b) artifact_creation sub-agent → right-side artifact panel,
    //      identified by a tab whose label ends in `.html` and a
    //      rendered `<!DOCTYPE html>` snippet in the panel.
    // Pass when any artifact surface appears within 240s.
    await expect.poll(
      async () => {
        return await page.evaluate(() => {
          const inline = document.querySelectorAll('button.artifact-canvas-tag').length;
          const panelTabs = document.querySelectorAll('[role="tab"]');
          let panelHit = 0;
          panelTabs.forEach((t) => { if (/\.html$/i.test((t.textContent || '').trim())) panelHit++; });
          const docDeclared = /<!DOCTYPE\s+html/i.test(document.body.innerText || '');
          return inline + panelHit + (docDeclared ? 1 : 0);
        });
      },
      { timeout: 240_000, intervals: [2_000], message: 'visualization prompt must produce an artifact (tag, panel, or html doc)' },
    ).toBeGreaterThan(0);
  });

  test('probe 4 — chat code-gen prompt produces a code block, not an artifact', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'write a python function add(a, b) that returns a + b. respond with ONLY the code in a triple-backtick python fence, no other text.');
    const text = await waitForAssistantSettled(page, { totalTimeoutMs: 180_000 });
    // No unsolicited artifact card (#417 — `python` is not a promotable lang).
    const artifactCount = await page.locator('button.artifact-canvas-tag').count();
    expect(artifactCount, 'code-gen output must not become an artifact card').toBe(0);
    // The code itself made it to the rendered turn — function signature and body present.
    expect(text, `expected python def add() in response; got: ${text.slice(0, 200)}`).toMatch(/def\s+add\s*\(/);
  });

  test('probe 5 — codemode boots cleanly and is ready for input', async ({ page }) => {
    // Codemode infra-health check. We deliberately don't send an LLM prompt
    // here because the default code model (gpt-oss:20b on Ollama HAL) can
    // take 100-200s for a single turn — that's a model-perf issue tracked
    // separately, not a release blocker. The release blocker is "did the
    // pod boot and is the daemon healthy". That's what we assert.
    await clickWorkspaceTab(page, 'Code');
    // Wait for either READY or input-enabled — boot can take 30-90s on cold pods.
    const input = page.locator('textarea[placeholder*="explain this codebase"]');
    await expect(input).toBeVisible({ timeout: 150_000 });
    await expect(input).toBeEnabled({ timeout: 150_000 });
    // The daemon banner shows "[openagentic]" + "cwd /workspace" once the
    // session_info frame arrives. If it didn't, we'd see only "loading…".
    await expect(page.getByText(/\[openagentic\]/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/cwd\s+\/workspace/i)).toBeVisible({ timeout: 30_000 });
    // No error banner.
    const errorBanner = await page.locator('[role="alert"]').filter({ hasText: /error|failed|unable/i }).count();
    expect(errorBanner, 'codemode should not surface an error banner on boot').toBe(0);
  });

  test('probe 6 — flows page shows ≥3 templates', async ({ page }) => {
    await clickWorkspaceTab(page, 'Flows');
    // Templates render as direct children of a Tailwind grid wrapper —
    // `div[class*="grid-cols"] > div`. The actual class chain in this UI
    // version is `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`.
    // Wait for the grid to populate (templates load from API).
    const grid = page.locator('div[class*="grid-cols"]').first();
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // Poll until at least 3 children appear — gives the API time to respond.
    await expect.poll(
      async () => grid.locator(':scope > div').count(),
      { timeout: 15_000, message: 'flows template grid did not populate' },
    ).toBeGreaterThanOrEqual(3);
  });

  test('probe 7 — admin/llm-providers reports ≥4 providers', async ({ request }) => {
    const jwt = readJwt();
    const api = await authedApi(request, jwt);
    const res = await api.get('/api/admin/llm-providers');
    expect(res.status(), `GET /api/admin/llm-providers status`).toBe(200);
    const body = await res.json();
    const list: any[] = Array.isArray(body) ? body : (body.providers || body.data || []);
    expect(list.length, `expected ≥4 providers, got ${list.length}`).toBeGreaterThanOrEqual(4);
  });

  test('probe 8 — code-model registry resolves a default', async ({ request }) => {
    // The openagentic/v1/models endpoint exposes the live code-role
    // registry. A healthy deployment must surface ≥1 model and have
    // `currentEffective` set — this is what codemode boots against.
    const jwt = readJwt();
    const api = await authedApi(request, jwt);
    const res = await api.get('/api/openagentic/v1/models');
    expect(res.status(), `GET /api/openagentic/v1/models status`).toBe(200);
    const body = await res.json();
    const data: any[] = Array.isArray(body.data) ? body.data : [];
    expect(data.length, `expected ≥1 model in registry, got ${data.length}`).toBeGreaterThanOrEqual(1);
    expect(typeof body.currentEffective === 'string' && body.currentEffective.length > 0,
      `currentEffective should be a non-empty string, got ${JSON.stringify(body.currentEffective)}`).toBe(true);
    expect(typeof body.defaultFromAdmin === 'string' && body.defaultFromAdmin.length > 0,
      `defaultFromAdmin should be a non-empty string, got ${JSON.stringify(body.defaultFromAdmin)}`).toBe(true);
  });
});
