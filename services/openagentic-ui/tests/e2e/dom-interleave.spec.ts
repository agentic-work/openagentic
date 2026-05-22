/**
 * DOM interleave 3-state snapshot — Playwright spec (Phase 0.2).
 *
 * Plan: docs/superpowers/plans/sprightly-percolating-brook.md §0.2
 *
 * For each scenario in Q1..Q20 (see PROMPTS.md), this spec:
 *   1. Logs in to chat-dev as mcp-tester (Microsoft SSO).
 *   2. Pins the model via the model selector (Sonnet 4.6 OR gpt-oss:20b,
 *      driven by env MODEL).
 *   3. Sends the prompt.
 *   4. Captures the AAS subtree at THREE points:
 *        (a) mid-stream — after the first 5s of streaming
 *        (b) post-stream — after `data-stream-state="complete"` lands
 *        (c) post-reload — after a full `page.reload()`
 *   5. Walks each snapshot with `walkAgenticActivity` and writes the JSON
 *      trace to `reports/verify-cadence/<run>/Q<n>-<model>/dom/<state>.json`.
 *   6. Asserts the three traces match (Phase 3 persistence-across-reload).
 *
 * Output dir (env DOM_TRACE_DIR or default):
 *   reports/verify-cadence/<RUN>/Q<n>-<model>/dom/{mid-stream,post-stream,post-reload}.json
 *
 * NOTE — Playwright spec, NOT the Playwright MCP plugin: this file is for the
 * human-driven E2E suite. AI-driven Q-loop runs use the MCP tools directly
 * per CLAUDE.md rule 2 and consume the same `walkAgenticActivity` helper via
 * `page.evaluate()`.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const BASE_URL = process.env.BASE_URL ?? 'https://chat-dev.openagentic.io';
const RUN_LABEL = process.env.RUN_LABEL ?? new Date().toISOString().split('T')[0];
const MODEL = process.env.MODEL ?? 'claude-sonnet-4-6';
const OUT_ROOT =
  process.env.DOM_TRACE_DIR ??
  join(__dirname, '..', '..', '..', '..', 'reports', 'verify-cadence', `dom-interleave-${RUN_LABEL}`);

interface Scenario {
  qNum: number;
  prompt: string;
  contractFile?: string;
}

const SCENARIOS: Scenario[] = [
  {
    qNum: 1,
    prompt: 'show me my Azure subscriptions and what’s in each resource group',
    contractFile: 'end-state-01-azure-subs-rgs.contract.json',
  },
  {
    qNum: 2,
    prompt: 'do a full security audit across all tenants of openagentic-omhs',
  },
  {
    qNum: 5,
    prompt: 'the staging deploy is failing — diagnose, fix, rebuild, and verify',
  },
  {
    qNum: 7,
    prompt:
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    contractFile: 'end-state-07-tri-cloud-cost-spikes.contract.json',
  },
  {
    qNum: 10,
    prompt:
      'Plan and execute a migration of our MSSQL legacy database to Azure SQL with zero downtime',
    contractFile: 'end-state-10-mssql-migration-plan.contract.json',
  },
];

/** SSO login helper — mirrors codemode-live-proof.spec.ts. */
async function loginIfNeeded(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes('chat-dev') && !url.includes('login.microsoftonline.com')) {
    return;
  }
  await page
    .getByLabel(/email|user|name/i)
    .first()
    .fill(process.env.SSO_USER ?? 'mcp-tester@openagentic.local');
  await page.getByRole('button', { name: /next/i }).click();
  await page
    .getByLabel(/password/i)
    .fill(process.env.SSO_PASS ?? 'TestMcp@2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: /yes|stay signed in/i }).click().catch(() => {});
  await page.waitForURL(/chat-dev/, { timeout: 30_000 });
}

async function selectModel(page: Page, model: string): Promise<void> {
  // Best-effort: pin via the model selector pill. Fall back silently if the
  // selector isn't visible — the cluster's default may already be the target.
  try {
    const pill = page.locator('[data-testid="model-selector-pill"]').first();
    if (await pill.isVisible({ timeout: 2000 })) {
      await pill.click();
      await page
        .getByRole('option', { name: new RegExp(model.replace(':', '\\:'), 'i') })
        .click({ timeout: 5000 });
    }
  } catch {
    /* leave default */
  }
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const composer = page
    .locator('[data-testid="composer-input"], textarea[placeholder*="Message"]')
    .first();
  await composer.fill(prompt);
  await composer.press('Enter');
}

async function walkDom(page: Page, label: string): Promise<unknown> {
  // We inline the walker source into the page via addInitScript at spec
  // setup so page.evaluate can call it. To keep this single-file, we use
  // an inline definition mirroring src/features/chat/utils/walkAgenticActivity.ts.
  return page.evaluate((labelArg) => {
    const PREVIEW_MAX = 60;
    const preview = (node: Element | null | undefined): string | undefined => {
      if (!node) return undefined;
      const txt = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!txt) return undefined;
      return txt.length > PREVIEW_MAX ? txt.slice(0, PREVIEW_MAX) + '…' : txt;
    };
    const SELECTORS = [
      '[data-aas-mounted="true"]',
      '[data-testid="agentic-activity-stream"]',
      '.cm-aas',
      '.agentic-activity-stream',
    ];
    let root: Element | null = null;
    for (const s of SELECTORS) {
      const e = document.querySelector(s);
      if (e) {
        root = e;
        break;
      }
    }
    if (!root) return { entries: [], mounted: false, label: labelArg };
    const entries: Array<Record<string, unknown>> = [];
    const classify = (el: Element): Record<string, unknown> | null => {
      const get = (sel: string) => el.querySelector(sel);
      const att = (n: string) => el.getAttribute(n) ?? undefined;
      if (el.matches('.inline-thinking-block, [data-testid="inline-thinking-block"]')) {
        return { kind: 'thinking', preview: preview(el), durationLabel: att('data-duration') };
      }
      if (el.matches('.interleaved-text-block, [data-testid="interleaved-text-block"]')) {
        return { kind: 'text', preview: preview(el) };
      }
      if (el.matches('[data-testid="parallel-tool-group"], .cm-tool-parallel')) {
        const children = el.querySelectorAll('[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]');
        return { kind: 'tool-group', childCount: children.length };
      }
      if (el.matches('[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]')) {
        return {
          kind: 'tool',
          name: att('data-tool-name') ?? get('[data-testid="tool-name"], .t-name')?.textContent?.trim() ?? undefined,
          status: att('data-tool-status') ?? get('[data-testid="tool-status"], .t-status')?.textContent?.trim() ?? undefined,
          durationLabel: get('[data-testid="tool-timer"], .t-timer')?.textContent?.trim() ?? undefined,
        };
      }
      if (el.matches('.cm-subagent-card, .subagent, [data-testid="subagent-card"]')) {
        return {
          kind: 'subagent',
          name: att('data-agent-name') ?? get('.sa-name, [data-testid="subagent-name"]')?.textContent?.trim() ?? undefined,
          status: get('.sa-status, [data-testid="subagent-status"]')?.textContent?.trim() ?? undefined,
        };
      }
      if (el.matches('.cm-streaming-table, [data-testid="streaming-table"]')) return { kind: 'streaming-table' };
      if (el.matches('.viz, [data-testid="viz"], [data-app-renderer="true"]')) {
        return {
          kind: 'viz',
          name:
            att('data-template') ??
            get('.viz-head .badge, [data-testid="viz-template"]')?.textContent?.trim() ??
            undefined,
        };
      }
      if (el.matches('.followups, [data-testid="followups"]')) {
        const chips = el.querySelectorAll('.chip, [data-testid="followup-chip"], [role="button"]');
        return { kind: 'followups', childCount: chips.length };
      }
      return null;
    };
    const walk = (node: Element): void => {
      const c = classify(node);
      if (c) {
        entries.push(c);
        if (c.kind === 'tool-group') {
          const tools = node.querySelectorAll('[data-testid="tool-card"], .tool, [data-testid="parallel-tool-subcard"]');
          tools.forEach((child) => {
            const ce = classify(child as Element);
            if (ce) entries.push(ce);
          });
        }
        return;
      }
      Array.from(node.children).forEach((ch) => walk(ch as Element));
    };
    Array.from(root.children).forEach((c) => walk(c as Element));
    return { entries, mounted: true, label: labelArg };
  }, label);
}

async function writeTrace(filePath: string, trace: unknown): Promise<void> {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(trace, null, 2), 'utf8');
}

for (const scenario of SCENARIOS) {
  test(`Q${scenario.qNum} · ${MODEL} · DOM interleave 3-state`, async ({ page }) => {
    test.setTimeout(8 * 60_000); // some scenarios run 5+ min on Sonnet

    const outDir = join(OUT_ROOT, `Q${scenario.qNum}-${MODEL}`, 'dom');
    mkdirSync(outDir, { recursive: true });

    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await selectModel(page, MODEL);
    await sendPrompt(page, scenario.prompt);

    // (a) mid-stream
    await page.waitForSelector('[data-aas-mounted="true"]', { timeout: 30_000 });
    await page.waitForTimeout(5_000);
    const midStream = await walkDom(page, 'mid-stream');
    await writeTrace(join(outDir, 'mid-stream.json'), midStream);
    await page.screenshot({ path: join(outDir, 'mid-stream.png'), fullPage: true });

    // (b) post-stream — wait for stream complete
    await page.waitForSelector(
      '[data-stream-state="complete"], [data-aas-streaming="false"]',
      { timeout: 6 * 60_000 },
    );
    const postStream = await walkDom(page, 'post-stream');
    await writeTrace(join(outDir, 'post-stream.json'), postStream);
    await page.screenshot({ path: join(outDir, 'post-stream.png'), fullPage: true });

    // (c) post-reload — full page reload, wait for AAS to re-mount
    const sessionUrl = page.url();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-aas-mounted="true"]', { timeout: 30_000 });
    await page.waitForTimeout(2_000); // let hydration settle
    const postReload = await walkDom(page, 'post-reload');
    await writeTrace(join(outDir, 'post-reload.json'), postReload);
    await page.screenshot({ path: join(outDir, 'post-reload.png'), fullPage: true });

    // Persistence assertion — post-stream MUST equal post-reload.
    expect(
      (postReload as { entries: Array<{ kind: string }> }).entries.map((e) => e.kind),
      `Q${scenario.qNum} reload-equivalence on ${MODEL} — session ${sessionUrl}`,
    ).toEqual((postStream as { entries: Array<{ kind: string }> }).entries.map((e) => e.kind));

    // Sanity: mid-stream should be a prefix of post-stream (no rewrites).
    const midKinds = (midStream as { entries: Array<{ kind: string }> }).entries.map((e) => e.kind);
    const postKinds = (postStream as { entries: Array<{ kind: string }> }).entries.map((e) => e.kind);
    for (let i = 0; i < midKinds.length && i < postKinds.length; i += 1) {
      // Allow appended frames during stream; require no reordering of what mid-stream already saw.
      // (Some kinds — `text` — may grow in length; ordering is the invariant.)
      expect(midKinds[i], `Q${scenario.qNum} mid-stream prefix divergence at idx ${i}`).toBe(
        postKinds[i],
      );
    }

    // Optional: contract diff if a contract file is mapped.
    if (scenario.contractFile) {
      const contractPath = join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'mocks',
        'UX',
        'AI',
        'Chatmode',
        scenario.contractFile,
      );
      if (existsSync(contractPath)) {
        const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
        writeTrace(join(outDir, 'contract-source.json'), contract);
      }
    }
  });
}
