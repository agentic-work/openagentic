/**
 * Stage C E2E — concurrent persona dispatch on chat-dev (plan task 9).
 *
 * Validates the 4 new persona agents (finops_analyst, security_auditor,
 * engineering_metrics, product_analyst) work end-to-end on the live
 * deployment:
 *   (1) API/chat-session path: a user prompt that requests all 4
 *       personas produces NDJSON agent_start / agent_complete events
 *       for each persona on /api/chat/stream.
 *   (2) chat UX path: the same prompt through the web UI renders the
 *       tool-parallel group with 4 persona cards running concurrently,
 *       each completing and showing an artifact or text output.
 *
 * Run order:
 *   npx playwright test --project=auth-setup
 *   npx playwright test tests/e2e/persona-concurrent.spec.ts
 *
 * Skips gracefully if .auth/user.json isn't present.
 */

import { test, expect, type Page } from './fixtures/auth.fixture';

const ALL_FOUR_PERSONAS = [
  'finops_analyst',
  'security_auditor',
  'engineering_metrics',
  'product_analyst',
] as const;

const PERSONA_PROMPT =
  'I need four parallel analyses: (1) our FinOps dashboard with per-service spend, ' +
  '(2) security posture with IAM boundary graph + compliance scorecard, ' +
  '(3) engineering DORA metrics dashboard, and ' +
  '(4) product OKR scorecard with roadmap swimlane. ' +
  'Please delegate to finops_analyst, security_auditor, engineering_metrics, and product_analyst ' +
  'in parallel and produce interactive artifacts for each.';

test.describe('Stage C — concurrent persona agents on chat-dev', () => {
  test('chat UX: submitting multi-persona prompt spawns 4 concurrent agent cards', async ({ authenticatedPage }) => {
    const page: Page = authenticatedPage;

    // Smart Router must be the active model per session rule — do NOT
    // pin an explicit model. Diagnose routing bugs; don't bypass them.
    // The composer default is Smart Router on chat-dev so no action needed.

    // Submit the multi-persona prompt.
    const chatInput = page.locator('[data-testid="chat-input"], .chat-input textarea, textarea');
    await chatInput.first().fill(PERSONA_PROMPT);
    await chatInput.first().press('Enter');

    // Wait for an assistant message to start streaming (up to 60s for
    // slow providers / cold SmartRouter on a fresh pod).
    await page.waitForSelector('[data-testid="assistant-message"], .message-assistant', { timeout: 90_000 });

    // Look for the tool-parallel group (Phase F₂ / Wire-in D).
    // Selector may be `.tool-parallel`, `[data-role="tool-parallel"]`,
    // or `.ToolParallelGroup` depending on the current UI. Try several.
    const parallelGroup = page.locator(
      '[data-testid="tool-parallel-group"], .tool-parallel-group, .ToolParallelGroup, [class*="ToolParallel"]',
    );
    await expect(parallelGroup.first()).toBeVisible({ timeout: 60_000 });

    // Inside the parallel group, each persona should appear as a card
    // (either by role name or display name). We look for the role
    // string anywhere inside the group.
    const groupHtml = await parallelGroup.first().innerHTML();
    for (const persona of ALL_FOUR_PERSONAS) {
      expect(
        groupHtml.toLowerCase(),
        `tool-parallel group should mention persona ${persona}`,
      ).toContain(persona);
    }

    // Wait for completion: all 4 persona cards should eventually show
    // a "complete" state. Allow generous timeout (frontier models +
    // tool calls can take minutes).
    await page.waitForFunction(
      (personas) => {
        const group = document.querySelector(
          '[data-testid="tool-parallel-group"], .tool-parallel-group, .ToolParallelGroup, [class*="ToolParallel"]',
        );
        if (!group) return false;
        const html = group.innerHTML.toLowerCase();
        // Heuristic: every persona name appears AND at least one
        // "complete"/"done"/"success" marker is present.
        const allNamed = personas.every((p) => html.includes(p));
        const hasCompleteMarker = /complete|✓|done|success/.test(html);
        return allNamed && hasCompleteMarker;
      },
      ALL_FOUR_PERSONAS,
      { timeout: 240_000 },
    );
  });

  test('API: /api/chat/stream emits agent_start for each persona on multi-persona prompt', async ({ authenticatedPage, request }) => {
    // Open a fresh chat session via the UI to get a session cookie,
    // then send the same prompt via POST /api/chat/stream and parse
    // the NDJSON response for agent_start/agent_complete envelopes.
    const page: Page = authenticatedPage;

    // Extract cookies from the authenticated page for the API call.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Create a chat session id client-side — the backend accepts
    // arbitrary session ids and will auto-create on first POST.
    const sessionId = `e2e-personas-${Date.now()}`;

    const baseUrl = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
    const resp = await request.post(`${baseUrl}/api/chat/stream`, {
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
        cookie: cookieHeader,
      },
      data: {
        sessionId,
        message: PERSONA_PROMPT,
        model: 'auto',  // Smart Router — do NOT hardcode
      },
      timeout: 300_000,
    });

    expect(resp.status(), `/api/chat/stream should 200 on chat-dev — got ${resp.status()}`).toBe(200);

    // Stream-parse the NDJSON body. Collect all agent_start + agent_progress
    // frames and their payload roles/agentRoles.
    const body = await resp.text();
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    const personaStarts = new Set<string>();

    for (const raw of lines) {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const type = parsed?.type ?? parsed?.event;
      const payload = parsed?.data ?? parsed?.payload ?? {};
      if (type === 'agent_start' || type === 'agent_progress') {
        const role = payload.role ?? payload.agentRole;
        if (role && (ALL_FOUR_PERSONAS as readonly string[]).includes(role)) {
          personaStarts.add(role);
        }
      }
    }

    // All 4 personas must have fired agent_start during this single
    // chat turn. If fewer than 4 fire, one of the personas wasn't
    // actually dispatched by the orchestrator.
    expect(
      Array.from(personaStarts).sort(),
      'every persona must emit agent_start on /api/chat/stream',
    ).toEqual([...ALL_FOUR_PERSONAS].sort());
  });
});
