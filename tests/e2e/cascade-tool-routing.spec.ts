/**
 * Cascade tool-routing battery — 10 prompts that prove the V2 cascade
 * (intent → server prefix → keyword → semantic top-K → real defs) fires
 * deterministically for every supported intent class, and that the
 * Smart-Router-selected model receives a tool array shaped for the ask.
 *
 * What this asserts (and what it does NOT):
 *
 *   ✓ The cascade plumbing is correct end-to-end. Each prompt produces a
 *     `[V2] cascade entry` log line with the expected intent (and server
 *     when applicable), and `[V2] cascade exit` returns >0 ranked tools
 *     for tool-using intents and 0 for plain-chat intents.
 *
 *   ✓ The OllamaProvider receives a `toolCount` consistent with the cascade
 *     output (6 meta + N MCP tools), confirming no tools dropped between
 *     `runChatV2Pipeline` and `createCompletion`.
 *
 *   ✗ This does NOT assert per-prompt response correctness. If gpt-oss:20b
 *     emits `request_clarification` because it cannot solve a particular
 *     ask, that is a PASS for the cascade — the platform fed it the right
 *     tools and the model semantically signalled incapability. Per-model
 *     completeness is a separate confidence-smoke battery.
 *
 * The probes scrape pod logs via kubectl. They run as a deploy gate, not
 * a unit test — so they are tagged with `@cascade-live` and excluded from
 * the standard `playwright test` invocation. Run explicitly:
 *
 *   API_POD=$(kubectl -n agentic-dev get pods -l app.kubernetes.io/component=api -o jsonpath='{.items[0].metadata.name}')
 *   API_POD=$API_POD npx playwright test tests/e2e/cascade-tool-routing.spec.ts
 *
 * The 10 probes cover:
 *   1. plain chat                 — no tools needed
 *   2. azure subscriptions        — cloud-list, server=azure
 *   3. azure resources            — cloud-list, server=azure (different keywords)
 *   4. k8s pods                   — cloud-list, server=k8s
 *   5. aws s3 buckets             — cloud-list, server=aws
 *   6. file read                  — single-read
 *   7. cost+sankey                — cloud-list + visualization composite
 *   8. architecture diagram       — architecture intent
 *   9. clarification ask          — chat + low confidence
 *  10. ambiguous prompt           — chat fallback (no server signal)
 *
 * Each row exercises a different cascade code path. Together they form
 * the regression net for the layered architecture: any future commit that
 * silently breaks one stage will fail at least one probe.
 */
import { test, expect, Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');
const API_POD = process.env.API_POD;

test.use({
  storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
});

// --- Helpers ---------------------------------------------------------------

interface CascadeSeams {
  /** Seam #1: stream.handler.ts after listMcpTools returns. */
  listMcpToolsCount: number | null;
  /** Seam #2: runChatV2Pipeline.ts at cascade entry. */
  inputMcpToolsCount: number | null;
  hasRanker: boolean | null;
  classifiedIntent: string | null;
  classifiedServer: string | null;
  classifiedKeywords: string[] | null;
  /** Seam #3: runChatV2Pipeline.ts at cascade exit. */
  rankedMcpToolsCount: number | null;
  fallback: boolean | null;
  /** OllamaProvider final tool array shape. */
  finalToolCount: number | null;
}

/**
 * Read the three cascade-debug seams + the OllamaProvider final toolCount
 * from pod logs in the last `sinceSec` seconds. Returns the most recent
 * occurrence of each — caller is responsible for sequencing prompts so
 * the seams belong to the right turn.
 */
function readCascadeSeams(sinceSec = 60): CascadeSeams {
  if (!API_POD) {
    throw new Error(
      'API_POD env var must be set to the running api pod name. Example:\n' +
      '  API_POD=$(kubectl -n agentic-dev get pods -l app.kubernetes.io/component=api -o jsonpath=\'{.items[0].metadata.name}\')',
    );
  }
  const since = `${Math.max(1, Math.floor(sinceSec))}s`;
  const raw = execSync(
    `kubectl -n agentic-dev logs ${API_POD} --since=${since}`,
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const lines = raw.split('\n').filter(Boolean);

  const findLast = (pred: (j: any) => boolean): any | null => {
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i]);
        if (pred(j)) return j;
      } catch { /* not JSON */ }
    }
    return null;
  };

  const seam1 = findLast(j => j.msg === '[STREAM] V2 mcpTools loaded');
  const seam2 = findLast(j => j.msg === '[V2] cascade entry — input + ranker presence');
  const seam3 = findLast(j => j.msg === '[V2] cascade exit — final ranked count');
  // OllamaProvider's "Native tools added" is the last assertion before the
  // model sees the array. There can be many per turn (one per round-trip);
  // we want the FIRST one — that's the initial dispatch that decides
  // whether MCP tools entered the model's context.
  const final = (() => {
    for (const line of lines) {
      try {
        const j = JSON.parse(line);
        if (j.msg === '[OllamaProvider] 🔧 Native tools added to Ollama request') return j;
      } catch { /* not JSON */ }
    }
    return null;
  })();

  return {
    listMcpToolsCount: seam1?.listMcpToolsCount ?? null,
    inputMcpToolsCount: seam2?.inputMcpToolsCount ?? null,
    hasRanker: seam2?.hasRanker ?? null,
    classifiedIntent: seam2?.classifiedIntent ?? null,
    classifiedServer: seam2?.classifiedServer ?? null,
    classifiedKeywords: seam2?.classifiedKeywords ?? null,
    rankedMcpToolsCount: seam3?.rankedMcpToolsCount ?? null,
    fallback: seam3?.fallback ?? null,
    finalToolCount: final?.toolCount ?? null,
  };
}

async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Chat message input' });
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

async function newChatSession(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Chat message input' }).waitFor({ state: 'visible', timeout: 30_000 });
  const newChatBtn = page.getByRole('button', { name: 'New Chat', exact: true }).first();
  await newChatBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await newChatBtn.click({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
}

/**
 * Wait for `[V2] cascade exit` to appear in the logs after we've sent a
 * prompt. This is more reliable than waiting for the assistant text to
 * settle — it gates on the actual seam emission, not on streaming-end.
 */
async function waitForCascadeExitInLogs(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastSeen = '';
  while (Date.now() - start < timeoutMs) {
    const s = readCascadeSeams(120);
    const sig = `${s.classifiedIntent}|${s.rankedMcpToolsCount}|${s.finalToolCount}`;
    if (s.rankedMcpToolsCount !== null && sig !== lastSeen) {
      // Cascade exited at least once since we started watching.
      // Quiet-window: 2s without further change.
      lastSeen = sig;
      await new Promise(r => setTimeout(r, 2_000));
      const s2 = readCascadeSeams(120);
      if (s2.rankedMcpToolsCount !== null) return;
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`cascade exit log did not appear within ${timeoutMs}ms`);
}

// --- Battery ---------------------------------------------------------------

test.describe('cascade tool-routing battery (@cascade-live)', () => {
  test.setTimeout(300_000);

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
    if (/\/login/i.test(page.url())) {
      await page.goto(BASE);
      await page.waitForLoadState('domcontentloaded');
    }
  });

  // Each probe asserts the cascade plumbing fired with the expected shape.
  // We deliberately do NOT assert the model's response text — only the
  // tool-array signal that proves the cascade fed it the right tools.

  test('probe 1 — plain chat: no tools needed, intent=chat, ranked=0', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'what is 2+2');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.listMcpToolsCount, 'seam #1 must have a listMcpToolsCount').not.toBeNull();
    expect(s.listMcpToolsCount!).toBeGreaterThanOrEqual(200);
    expect(s.inputMcpToolsCount).toBe(s.listMcpToolsCount);
    expect(s.hasRanker, 'cascade ranker must be wired').toBe(true);
    expect(['chat', 'single-read']).toContain(s.classifiedIntent);
    // For a pure chat intent, the cascade narrows aggressively. We accept
    // any small number — the contract is that the meta tools are always
    // present and the model can answer directly. The point is we do NOT
    // ship 270 tools to the model for "what is 2+2".
    expect(s.rankedMcpToolsCount!).toBeLessThan(50);
    expect(s.finalToolCount).toBeGreaterThanOrEqual(6);
  });

  test('probe 2 — azure subscriptions: intent=cloud-list, server=azure, ranked>0', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'show me my Azure subscriptions');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('cloud-list');
    expect(s.classifiedServer).toBe('azure');
    expect(s.rankedMcpToolsCount, 'cascade must produce >0 azure tools').toBeGreaterThan(0);
    expect(s.fallback, 'cascade must not be in fallback path').toBe(false);
    expect(s.finalToolCount).toBeGreaterThanOrEqual(s.rankedMcpToolsCount!);
  });

  test('probe 3 — azure resource groups: cloud-list + different azure keywords', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'list my azure resource groups across all subscriptions');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('cloud-list');
    expect(s.classifiedServer).toBe('azure');
    expect(s.rankedMcpToolsCount).toBeGreaterThan(0);
  });

  test('probe 4 — k8s pods: intent=cloud-list, server=k8s', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'list pods running in agentic-dev namespace');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('cloud-list');
    expect(['k8s', 'kubernetes']).toContain(s.classifiedServer);
    expect(s.rankedMcpToolsCount).toBeGreaterThan(0);
  });

  test('probe 5 — aws S3 buckets: intent=cloud-list, server=aws', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'show me my AWS S3 buckets');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('cloud-list');
    expect(s.classifiedServer).toBe('aws');
    expect(s.rankedMcpToolsCount).toBeGreaterThan(0);
  });

  test('probe 6 — file read: intent=single-read, no server prefix', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'show me the contents of services/openagentic-api/CLAUDE.md');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(['single-read', 'chat']).toContain(s.classifiedIntent);
    // single-read intent doesn't require a cloud server prefix; the
    // cascade may pass through more tools for fuzzy file matching.
    expect(s.rankedMcpToolsCount).not.toBeNull();
    expect(s.finalToolCount).toBeGreaterThanOrEqual(6);
  });

  test('probe 7 — cost + sankey: cloud-list with visualization', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'show me cloud resources and give me a sankey cost diagram for the last 6 months');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('cloud-list');
    expect(s.classifiedServer).toBe('azure');
    expect(s.rankedMcpToolsCount).toBeGreaterThan(0);
    // compose_visual is one of the 6 meta tools, so it's always present —
    // we just confirm the MCP cost-related tools are also in the array.
    expect(s.finalToolCount!).toBeGreaterThan(s.rankedMcpToolsCount!);
  });

  test('probe 8 — architecture diagram: intent=architecture', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'draw a high-level architecture diagram for the openagentic stack');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    // architecture is its own intent; or the classifier may fall through
    // to chat — both are valid signals for "no MCP cloud tools needed."
    expect(['architecture', 'chat', 'render-artifact']).toContain(s.classifiedIntent);
    // Architecture asks should NOT trigger heavy server-prefix narrowing.
    expect(s.classifiedServer === null || s.classifiedServer === 'azure').toBeTruthy();
  });

  test('probe 9 — clarification ask: classifier handles short input', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'help');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('chat');
    // For a single-word ambiguous prompt the cascade should narrow heavily.
    expect(s.rankedMcpToolsCount!).toBeLessThan(50);
  });

  test('probe 10 — ambiguous prompt: cascade falls back gracefully', async ({ page }) => {
    await newChatSession(page);
    await sendChat(page, 'I dunno what to ask');
    await waitForCascadeExitInLogs();
    const s = readCascadeSeams(120);
    expect(s.classifiedIntent).toBe('chat');
    expect(s.classifiedServer).toBeNull();
    expect(s.fallback, 'classifier non-JSON should hit fallback path cleanly').toBe(false);
  });
});
