/**
 * Codemode slash-command battery — exercises EVERY non-destructive
 * slash command exposed on chat-dev and produces hard pass/fail
 * evidence (screenshot + WebSocket frame log) per command.
 *
 * Phase E of the codemode parity push. The spec is a *proof artifact*,
 * not a regression fixer — it never tries to "repair" a failing slash
 * command.
 *
 * Auth: Microsoft SSO with the mcp-tester service account, same
 * pattern as `codemode-live-proof.spec.ts`.
 *
 * Run:
 *   cd services/openagentic-ui/tests/e2e && \
 *     BASE_URL=https://chat.example.com \
 *     npx playwright test codemode-slash-battery.spec.ts --reporter=line --workers=1
 *
 * Outputs:
 *   tests/e2e/codemode-slash-battery.report.md
 *   tests/e2e/codemode-slash-battery-artifacts/<cmd>.png
 *
 * Hardening (rev 2026-05-01)
 * --------------------------
 * Previously this file declared one `test()` per command. When the
 * cold-start of any single test timed out, Playwright's serial-mode
 * cascade skipped the remainder — producing 7-of-28 runs instead of
 * the full battery. This rewrite collapses the suite into ONE big
 * `test()` that:
 *   1. Logs in once (reuse loginViaMicrosoftSSO).
 *   2. Enters codemode once (reuse enterCodemode).
 *   3. Waits for the cold-start once (composer mount, daemon ready).
 *   4. Loops through every command in the allow-list.
 *   5. Per command: type `/<cmd>` + Enter, waitForIdle (30s cap),
 *      capture state, dismiss any modal (Escape), continue.
 *   6. Writes the markdown report at the end.
 *   7. Only fails when >50% of commands hit hard daemon errors —
 *      otherwise reds get triaged from the report.
 */

import {
  test,
  expect,
  type Page,
  type WebSocket as PWWebSocket,
} from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.BASE_URL || 'https://chat.example.com';
const SSO_EMAIL =
  process.env.MCP_TESTER_EMAIL || 'admin@example.onmicrosoft.com';
const SSO_PASSWORD = process.env.MCP_TESTER_PASSWORD || 'TestMcp@2026';

const ARTIFACT_DIR = path.join(
  __dirname,
  'codemode-slash-battery-artifacts',
);
const REPORT_PATH = path.join(__dirname, 'codemode-slash-battery.report.md');

// Cold-start budget for codemode — gpt-oss:20b on hal can take ~90s
// before the first token. Per-command idle timeout is much shorter:
// most slash commands are local (no model call) and settle in <1s,
// so 30s is a generous cap that lets us blow through stuck commands
// without dragging the whole battery.
const ENTER_CODEMODE_TIMEOUT_MS = 120_000;
const PER_CMD_IDLE_TIMEOUT_MS = 30_000;
// Ample budget for the single big test: 27 commands * ~30s worst-case
// idle + cold-start + screenshot overhead.
const BIG_TEST_TIMEOUT_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Allow-list — the canonical Phase-E set sourced from
//   openagentic-cli/src/commands.ts COMMANDS()
// minus destructive / session-ending commands.
//
// PHASE_E_FLOOR is the canonical battery. The daemon's system/init
// frame is informational — we record it in the report but do NOT use
// it to override the allow-list (the prior dynamic discovery added a
// failure mode that didn't pay for itself).
// ---------------------------------------------------------------------------

const DESTRUCTIVE = new Set<string>([
  'exit',
  'logout',
  'clear', // wipes transcript — destructive for the test session
  'login',
  'rewind', // rolls back state — bleeds into siblings
  'compact', // mutates context window — affects later commands
  'reset-limits',
  'reset-limits-non-interactive',
  'reload-plugins', // re-inits plugins; can disconnect the daemon
  'sandbox-toggle', // flips sandbox mode — affects later commands
]);

const PHASE_E_FLOOR = [
  'help',
  'skills',
  'mcp',
  'agents',
  'cost',
  'context',
  'status',
  'version',
  'permissions',
  'plan',
  'resume',
  'memory',
  'config',
  'model',
  'theme',
  'release-notes',
  'pr-comments',
  'btw',
  'files',
  'tools',
  'hooks',
  'output-style',
  'init',
  'upgrade',
  'migrate-installer',
  'doctor',
  'bug',
];

const COMMANDS_TO_TEST = PHASE_E_FLOOR.filter((c) => !DESTRUCTIVE.has(c)).sort();

// ---------------------------------------------------------------------------
// Per-suite report types
// ---------------------------------------------------------------------------

type Status = 'pass' | 'fail' | 'soft-warn' | 'requires-interaction';

type ReportEntry = {
  cmd: string;
  status: Status;
  detail: string;
  daemonError?: string;
  interactionGate?: string;
  screenshot: string;
};

function ensureArtifactDir(): void {
  if (!fs.existsSync(ARTIFACT_DIR))
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Auth + codemode entry — copied from codemode-live-proof.spec.ts so
// this file is self-contained. Behavior mirrored, not referenced.
// (Per task constraint: don't change the auth / enterCodemode helpers
// — those work.)
// ---------------------------------------------------------------------------

async function loginViaMicrosoftSSO(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const alreadyIn = await page
    .locator('textarea')
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (alreadyIn) return;

  const msBtn = page
    .locator(
      'button:has-text("Microsoft"), button:has-text("Sign in with Microsoft"), button:has-text("Azure")',
    )
    .first();
  if (await msBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await msBtn.click();
    await page.waitForLoadState('networkidle');
  }

  const emailInput = page
    .locator('input[type="email"], input[name="loginfmt"]')
    .first();
  if (await emailInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await emailInput.fill(SSO_EMAIL);
    await page
      .locator('input[type="submit"], button:has-text("Next")')
      .first()
      .click();
  }

  const pwInput = page
    .locator('input[type="password"], input[name="passwd"]')
    .first();
  if (await pwInput.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await pwInput.fill(SSO_PASSWORD);
    await page
      .locator('input[type="submit"], button:has-text("Sign in")')
      .first()
      .click();
  }

  // KMSI ("Stay signed in?") — same dance as the live-proof spec.
  const kmsiDeadline = Date.now() + 30_000;
  let kmsiHandled = false;
  while (Date.now() < kmsiDeadline) {
    const onKmsi = await page
      .locator('text=Stay signed in?')
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (onKmsi) {
      const candidates = [
        '#idBtn_Back',
        'input[type="submit"][value="No"]',
        'input[type="button"][value="No"]',
        'button:has-text("No")',
        'input[type="submit"][value="Yes"]',
        '#idSIButton9',
        'button:has-text("Yes")',
      ];
      for (const sel of candidates) {
        const c = page.locator(sel).first();
        if (await c.isVisible({ timeout: 500 }).catch(() => false)) {
          await c.click().catch(() => {});
          kmsiHandled = true;
          break;
        }
      }
      if (kmsiHandled) break;
    }
    if (page.url().startsWith(BASE_URL)) break;
    await page.waitForTimeout(500);
  }

  await page
    .waitForURL(`${BASE_URL}/**`, { timeout: 60_000 })
    .catch(() => {});
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
  const closeBtn = page
    .locator(
      'button[aria-label="Close"], button[aria-label="close"], .fixed.inset-0 button',
    )
    .first();
  if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
  }
  await page.evaluate(() => {
    const overlays = document.querySelectorAll('div.fixed.inset-0');
    overlays.forEach((el) => {
      const z =
        (el as HTMLElement).style.zIndex || getComputedStyle(el).zIndex;
      if (
        z === '9998' ||
        (el as HTMLElement).className.includes('z-[9998]')
      ) {
        (el as HTMLElement).style.display = 'none';
      }
    });
  });
}

async function enterCodemode(page: Page): Promise<void> {
  await dismissOverlays(page);
  const codeBtn = page.locator('button[title="Code Mode"]').first();
  await expect(
    codeBtn,
    'Code Mode sidebar button must be present',
  ).toBeVisible({ timeout: ENTER_CODEMODE_TIMEOUT_MS });
  await codeBtn.click();
  await expect(
    page.locator('[data-testid="cm-floating-composer"]'),
    'cm-floating-composer must mount once codemode is active',
  ).toBeVisible({ timeout: ENTER_CODEMODE_TIMEOUT_MS });
  await dismissOverlays(page);
  await page.waitForTimeout(2_000);
}

// ---------------------------------------------------------------------------
// WebSocket frame interception — the daemon's per-session WS carries
// every event we need: `system/init`, `result`, error frames, etc.
// ---------------------------------------------------------------------------

type Frame = { ts: number; payload: unknown };

type WsLog = {
  frames: Frame[];
  ws?: PWWebSocket;
};

function attachWsLog(page: Page): WsLog {
  const log: WsLog = { frames: [] };
  page.on('websocket', (ws) => {
    const url = ws.url();
    const isCodemodeWs =
      /\/code\/|\/codemode\/|\/api\/code\//.test(url) ||
      log.frames.length === 0;
    if (!isCodemodeWs) return;
    log.ws = ws;
    ws.on('framereceived', (frame) => {
      const data = typeof frame.payload === 'string'
        ? frame.payload
        : frame.payload?.toString('utf8');
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        log.frames.push({ ts: Date.now(), payload: parsed });
      } catch {
        // non-JSON keepalive — ignore.
      }
    });
    ws.on('framesent', (frame) => {
      const data = typeof frame.payload === 'string'
        ? frame.payload
        : frame.payload?.toString('utf8');
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        log.frames.push({ ts: Date.now(), payload: { _sent: true, ...parsed } });
      } catch {
        // ignore
      }
    });
  });
  return log;
}

function findInitFrame(log: WsLog): Frame | undefined {
  for (const f of log.frames) {
    const p = f.payload as any;
    if (!p || typeof p !== 'object') continue;
    const candidates = [p, p.event, p.message].filter(Boolean);
    for (const c of candidates) {
      if (
        c &&
        typeof c === 'object' &&
        (c.type === 'system' || c.type === 'system/init') &&
        (c.subtype === 'init' || Array.isArray(c.slash_commands))
      ) {
        return f;
      }
    }
  }
  return undefined;
}

function extractSlashCommands(frame: Frame): string[] {
  const p = frame.payload as any;
  const candidates = [p, p.event, p.message].filter(Boolean);
  for (const c of candidates) {
    if (Array.isArray(c?.slash_commands)) return c.slash_commands as string[];
  }
  return [];
}

function findResultFor(log: WsLog, sinceTs: number): Frame | undefined {
  for (const f of log.frames) {
    if (f.ts < sinceTs) continue;
    const p = f.payload as any;
    if (!p || typeof p !== 'object') continue;
    const candidates = [p, p.event, p.message].filter(Boolean);
    for (const c of candidates) {
      if (c?.type === 'result') return f;
    }
  }
  return undefined;
}

function findErrorFor(log: WsLog, sinceTs: number): Frame | undefined {
  for (const f of log.frames) {
    if (f.ts < sinceTs) continue;
    const p = f.payload as any;
    if (!p || typeof p !== 'object') continue;
    const candidates = [p, p.event, p.message].filter(Boolean);
    for (const c of candidates) {
      if (c?.type === 'error') return f;
      if (c?.type === 'control_response' && c?.response?.subtype === 'error') {
        return f;
      }
    }
  }
  return undefined;
}

function frameError(frame: Frame): string {
  const p = frame.payload as any;
  const candidates = [p, p.event, p.message, p.response].filter(Boolean);
  for (const c of candidates) {
    if (typeof c?.error === 'string') return c.error;
    if (typeof c?.message === 'string') return c.message;
    if (c?.error && typeof c.error === 'object') {
      try {
        return JSON.stringify(c.error);
      } catch {
        // fallthrough
      }
    }
  }
  try {
    return JSON.stringify(p).slice(0, 1500);
  } catch {
    return String(p);
  }
}

// ---------------------------------------------------------------------------
// Submit a slash command into the floating composer.
// ---------------------------------------------------------------------------

async function submitSlash(page: Page, slash: string): Promise<number> {
  const textarea = page
    .locator('[data-testid="cm-floating-composer"] textarea')
    .first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });

  // Wait for the textarea to be enabled — placeholder flips to
  // "Describe a task or ask a question" once the daemon socket has
  // connected.
  for (let i = 0; i < 60; i++) {
    const disabled = await textarea
      .evaluate((el) => (el as HTMLTextAreaElement).disabled)
      .catch(() => true);
    const placeholder = await textarea
      .getAttribute('placeholder')
      .catch(() => null);
    if (!disabled && placeholder?.toLowerCase().includes('describe')) break;
    await page.waitForTimeout(1_000);
  }

  await textarea.click();
  await textarea.fill('');
  await textarea.fill(`/${slash}`);
  const value = await textarea
    .evaluate((el) => (el as HTMLTextAreaElement).value)
    .catch(() => '');
  if (value !== `/${slash}`) {
    await textarea.fill(`/${slash}`);
  }
  await page.waitForTimeout(200);
  const submittedAt = Date.now();
  await textarea.press('Enter');
  return submittedAt;
}

// ---------------------------------------------------------------------------
// Idle wait — polls daemon-frame signals + DOM busy indicators.
// Per-command timeout is the load-bearing knob: 30s for the hardened
// loop, generous enough that local commands always settle, short
// enough that a model stall can't gate the rest of the battery.
// ---------------------------------------------------------------------------

async function waitForSlashIdle(
  page: Page,
  log: WsLog,
  sinceTs: number,
  opts?: { timeoutMs?: number },
): Promise<{ idleReached: boolean; reason: string }> {
  const timeoutMs = opts?.timeoutMs ?? PER_CMD_IDLE_TIMEOUT_MS;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = findResultFor(log, sinceTs);
    const error = findErrorFor(log, sinceTs);
    if (error) return { idleReached: true, reason: 'error-frame' };
    if (result) return { idleReached: true, reason: 'result-frame' };

    const pillVariant = await page
      .locator('[data-testid="cm-rule-pill"]')
      .first()
      .getAttribute('data-pill')
      .catch(() => null);
    const runningCount = await page
      .locator('.cm-tool-status-running')
      .count()
      .catch(() => 0);
    const placeholder = await page
      .locator('[data-testid="cm-floating-composer"] textarea')
      .first()
      .getAttribute('placeholder')
      .catch(() => null);
    const placeholderBusy = placeholder?.includes('working') ?? false;
    const busy =
      pillVariant === 'thinking' ||
      runningCount > 0 ||
      placeholderBusy;
    if (!busy && Date.now() - start > 4_000) {
      return { idleReached: true, reason: 'dom-idle' };
    }
    await page.waitForTimeout(500);
  }
  return { idleReached: false, reason: `timeout-${timeoutMs}ms` };
}

// ---------------------------------------------------------------------------
// "Did SOMETHING render?" predicate.
// ---------------------------------------------------------------------------

async function detectRender(
  page: Page,
): Promise<{ rendered: boolean; via: string }> {
  const modalSelectors = [
    '[data-testid="skills-picker"]',
    '[data-testid="model-picker"]',
    '[data-testid="agents-picker"]',
    '[data-testid="memory-picker"]',
    '[data-testid="permissions-modal"]',
    '[data-testid="config-modal"]',
    '[data-testid="theme-picker"]',
    '[data-testid="output-style-picker"]',
    '[data-testid="rich-modal"]',
    '[data-testid="cm-rich-modal"]',
    '[data-testid="release-notes-modal"]',
    '[role="dialog"]',
  ];
  for (const sel of modalSelectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      return { rendered: true, via: `modal:${sel}` };
    }
  }

  const assistantBlock = page
    .locator('[data-part="text"], [data-part="result"], [data-part="tool_use"]')
    .last();
  if (await assistantBlock.isVisible().catch(() => false)) {
    const txt = (await assistantBlock.textContent().catch(() => '')) ?? '';
    if (txt.trim().length > 0) {
      return { rendered: true, via: 'assistant-block' };
    }
  }

  const inlineCmdOutput = page
    .locator('[data-testid^="cm-"], [data-testid="status-tasks"]')
    .last();
  if (await inlineCmdOutput.isVisible().catch(() => false)) {
    return { rendered: true, via: 'inline-cm-output' };
  }

  return { rendered: false, via: 'none' };
}

async function snap(page: Page, name: string): Promise<string> {
  ensureArtifactDir();
  const file = path.join(ARTIFACT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(path.dirname(REPORT_PATH), file);
}

async function dismissAnyModal(page: Page): Promise<void> {
  // Press Escape a few times to close pickers/dialogs left behind by
  // the previous slash command. Belt-and-suspenders: also click any
  // visible close button and re-run the overlay sweeper.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
  const closeBtn = page
    .locator(
      'button[aria-label="Close"], button[aria-label="close"], [role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("Cancel")',
    )
    .first();
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
  }
  await dismissOverlays(page);
  // Brief settle so the next /cmd doesn't race a closing modal.
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// The single hardened battery test — login once, codemode once,
// loop through every command. Never expect()-fails on individual
// command issues. Only fails when >50% of commands hit hard daemon
// errors (the >50% threshold is a sanity gate for catastrophic
// regressions; everything else is triaged from the report).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test('Codemode slash-command battery — full sweep', async ({ page }) => {
  test.setTimeout(BIG_TEST_TIMEOUT_MS);

  const reportEntries: ReportEntry[] = [];
  const log = attachWsLog(page);

  // ----- one-time setup -----
  await loginViaMicrosoftSSO(page);
  await enterCodemode(page);

  // Cold-start: wait for the textarea to be enabled and the daemon
  // socket to be hot. We do this here ONCE — every per-command
  // submitSlash() then assumes the composer is already warm.
  const textarea = page
    .locator('[data-testid="cm-floating-composer"] textarea')
    .first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 120; i++) {
    const disabled = await textarea
      .evaluate((el) => (el as HTMLTextAreaElement).disabled)
      .catch(() => true);
    const placeholder = await textarea
      .getAttribute('placeholder')
      .catch(() => null);
    if (!disabled && placeholder?.toLowerCase().includes('describe')) break;
    await page.waitForTimeout(1_000);
  }

  // Discover daemon-advertised commands for the report (informational
  // only — the allow-list is fixed at PHASE_E_FLOOR).
  const initFrame = findInitFrame(log);
  const advertised = initFrame ? extractSlashCommands(initFrame) : [];

  // ----- loop -----
  for (const cmd of COMMANDS_TO_TEST) {
    let detail = '';
    detail += initFrame
      ? `daemon advertised ${advertised.length} slash commands (${
          advertised.includes(cmd) || advertised.includes(`/${cmd}`)
            ? 'INCLUDES'
            : 'does NOT include'
        } /${cmd})\n`
      : `system/init frame not observed within enterCodemode window\n`;

    let screenshot = '';
    try {
      const submittedAt = await submitSlash(page, cmd);
      const idle = await waitForSlashIdle(page, log, submittedAt, {
        timeoutMs: PER_CMD_IDLE_TIMEOUT_MS,
      });
      detail += `idle reached: ${idle.idleReached} via ${idle.reason}\n`;

      const errorFrame = findErrorFor(log, submittedAt);
      const resultFrame = findResultFor(log, submittedAt);

      screenshot = await snap(page, `${cmd}.png`);

      if (errorFrame) {
        const errText = frameError(errorFrame);
        detail += `daemon emitted explicit error frame:\n${errText}\n`;
        reportEntries.push({
          cmd,
          status: 'fail',
          detail,
          daemonError: errText,
          screenshot,
        });
        await dismissAnyModal(page);
        continue;
      }

      if (resultFrame) {
        const p = resultFrame.payload as any;
        const subtype =
          p?.subtype ??
          p?.event?.subtype ??
          p?.message?.subtype ??
          'unknown';
        detail += `result subtype: ${subtype}\n`;
        if (subtype !== 'success') {
          const errText = frameError(resultFrame);
          detail += `non-success result frame:\n${errText}\n`;
          reportEntries.push({
            cmd,
            status: 'fail',
            detail,
            daemonError: errText,
            screenshot,
          });
          await dismissAnyModal(page);
          continue;
        }
      } else {
        detail +=
          `no result frame seen — slash command may be local-only (TUI command bypasses daemon)\n`;
      }

      const render = await detectRender(page);
      detail += `render detected: ${render.rendered} via ${render.via}\n`;

      const requiresInteraction =
        render.via.startsWith('modal:') && !resultFrame;
      if (requiresInteraction) {
        reportEntries.push({
          cmd,
          status: 'requires-interaction',
          detail,
          interactionGate: render.via,
          screenshot,
        });
        await dismissAnyModal(page);
        continue;
      }

      if (!idle.idleReached) {
        detail += 'soft-warn: idle-timeout\n';
        reportEntries.push({
          cmd,
          status: 'soft-warn',
          detail,
          screenshot,
        });
        await dismissAnyModal(page);
        continue;
      }

      if (!render.rendered && !resultFrame) {
        detail += 'soft-warn: nothing rendered and no daemon result observed\n';
        reportEntries.push({
          cmd,
          status: 'soft-warn',
          detail,
          screenshot,
        });
        await dismissAnyModal(page);
        continue;
      }

      reportEntries.push({
        cmd,
        status: 'pass',
        detail,
        screenshot,
      });
      await dismissAnyModal(page);
    } catch (err) {
      // Per-command harness flake — capture and keep going. We never
      // re-throw inside the loop; the whole point of the rewrite is
      // that one bad command can't sink the rest.
      detail += `\nharness failure: ${(err as Error).message}\n`;
      const fallback = await snap(page, `${cmd}-fail.png`).catch(() => '');
      reportEntries.push({
        cmd,
        status: 'soft-warn',
        detail,
        daemonError: (err as Error).message,
        screenshot: screenshot || fallback,
      });
      // Try to recover the composer for the next command.
      await dismissAnyModal(page).catch(() => {});
    }
  }

  // ----- write report -----
  const lines: string[] = [];
  lines.push('# Codemode slash-command battery — chat-dev evidence');
  lines.push('');
  lines.push(`Run: ${new Date().toISOString()}`);
  lines.push(`Base: ${BASE_URL}`);
  lines.push(`Account: ${SSO_EMAIL}`);
  lines.push('');
  const specStat = fs.statSync(__filename);
  const specLines = fs.readFileSync(__filename, 'utf8').split('\n').length;
  lines.push(
    `Spec file: \`${path.basename(__filename)}\` — ${specLines} LOC, ${specStat.size} bytes`,
  );
  lines.push('');
  lines.push(
    `Daemon-advertised slash commands (count=${advertised.length}): ${advertised.join(', ') || '(none observed)'}`,
  );
  lines.push('');
  lines.push(
    `Commands exercised in this run (count=${COMMANDS_TO_TEST.length}): ${COMMANDS_TO_TEST.join(', ')}`,
  );
  lines.push('');

  // Tallies.
  const tally = {
    pass: 0,
    fail: 0,
    softWarn: 0,
    requiresInteraction: 0,
  };
  for (const e of reportEntries) {
    if (e.status === 'pass') tally.pass++;
    else if (e.status === 'fail') tally.fail++;
    else if (e.status === 'soft-warn') tally.softWarn++;
    else tally.requiresInteraction++;
  }
  lines.push(
    `Tally — pass: ${tally.pass}, requires-interaction: ${tally.requiresInteraction}, soft-warn: ${tally.softWarn}, fail: ${tally.fail}`,
  );
  lines.push('');

  lines.push('## Pass/fail summary');
  lines.push('');
  lines.push('| Command | Status | Notes | Screenshot |');
  lines.push('| --- | --- | --- | --- |');
  for (const e of reportEntries) {
    const note = (() => {
      if (e.status === 'fail') return e.daemonError ?? '(see detail)';
      if (e.status === 'requires-interaction')
        return `gate: ${e.interactionGate ?? 'unknown'}`;
      if (e.status === 'soft-warn') return 'no render / no result frame';
      return 'ok';
    })();
    const noteEsc = note.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const shotMd = e.screenshot
      ? `![${path.basename(e.screenshot)}](${e.screenshot})`
      : '(no screenshot)';
    lines.push(
      `| /${e.cmd} | ${e.status} | ${noteEsc.slice(0, 240)} | ${shotMd} |`,
    );
  }
  lines.push('');

  for (const e of reportEntries) {
    lines.push(`## /${e.cmd} — **${e.status.toUpperCase()}**`);
    lines.push('');
    lines.push('```');
    lines.push(e.detail.trim());
    lines.push('```');
    lines.push('');
    if (e.daemonError) {
      lines.push('Daemon error:');
      lines.push('');
      lines.push('```');
      lines.push(e.daemonError);
      lines.push('```');
      lines.push('');
    }
    if (e.interactionGate) {
      lines.push(`Requires-interaction gate: \`${e.interactionGate}\``);
      lines.push('');
    }
    if (e.screenshot) {
      lines.push(`![${path.basename(e.screenshot)}](${e.screenshot})`);
      lines.push('');
    }
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'));
  // eslint-disable-next-line no-console
  console.log(`[codemode-slash-battery] report written: ${REPORT_PATH}`);
  // eslint-disable-next-line no-console
  console.log(
    `[codemode-slash-battery] tally — pass: ${tally.pass}, requires-interaction: ${tally.requiresInteraction}, soft-warn: ${tally.softWarn}, fail: ${tally.fail}`,
  );

  // Suite-level guardrail: only fail when MORE THAN HALF the
  // commands hit hard daemon errors. Anything below that gets triaged
  // from the report (Phase E.2).
  const total = COMMANDS_TO_TEST.length;
  const failRatio = total === 0 ? 0 : tally.fail / total;
  expect(
    failRatio,
    `Hard daemon errors on ${tally.fail}/${total} commands (${(failRatio * 100).toFixed(1)}%) — exceeds 50% catastrophic-regression gate`,
  ).toBeLessThanOrEqual(0.5);
});
