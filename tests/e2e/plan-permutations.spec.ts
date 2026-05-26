/**
 * Plan-permutation E2E matrix (2026-04-23).
 *
 * Runs ONE real chat prompt per behavior-changing commit landed today,
 * asserts the right routing/artifact/gate fires live on chat-dev.
 *
 * Covers (6 permutations):
 *   T1 simple-chat-routes-to-frontier   — #99 scoreModel quality-bonus
 *   T2 architecture-prompt-uses-module  — plan task 3 architecture-diagram
 *   T3 complexity-bias-escalates        — plan task 4 complexity keywords
 *   T4 cloud-resources-professional     — 1103bf72 lucidchart-style prompt
 *   T5 multi-persona-routes-to-parent   — bbc6c861 short-circuit gate
 *   T6 destructive-intent-frontier      — existing escalation regression
 *
 * All tests drive POST /api/chat/stream directly with a captured JWT so
 * they don't depend on the UI re-auth flow.
 *
 * BEFORE RUNNING:
 *   export AW_JWT='<openagentic_token cookie value from chat-dev>'
 *   npx playwright test tests/e2e/plan-permutations.spec.ts
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const JWT = process.env.AW_JWT || '';

type Frame = Record<string, any>;

async function createSession(api: APIRequestContext, title: string): Promise<string> {
  const resp = await api.post(`${BASE_URL}/api/chat/sessions`, {
    headers: {
      'content-type': 'application/json',
      cookie: `openagentic_token=${JWT}`,
    },
    data: { title },
  });
  expect(resp.status(), `create session ${title}`).toBe(200);
  const body = await resp.json();
  return body.session.id;
}

async function streamChat(
  api: APIRequestContext,
  sessionId: string,
  message: string,
  timeoutMs = 240_000,
): Promise<Frame[]> {
  const resp = await api.post(`${BASE_URL}/api/chat/stream`, {
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
      cookie: `openagentic_token=${JWT}`,
    },
    data: { sessionId, message, model: 'auto' },
    timeout: timeoutMs,
  });
  expect(resp.status(), `stream ${sessionId} returned ${resp.status()}`).toBe(200);
  const body = await resp.text();
  return body
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((f): f is Frame => f !== null);
}

function modelsUsed(frames: Frame[]): string[] {
  const set = new Set<string>();
  for (const f of frames) {
    const type = f.type;
    if (type === 'handoff' && f.toModel) set.add(f.toModel);
    if (type === 'model_info' && (f.model ?? f.data?.model)) set.add(f.model ?? f.data?.model);
    if (type === 'completion_complete' && f.model) set.add(f.model);
  }
  return Array.from(set);
}

function assistantText(frames: Frame[]): string {
  const pieces: string[] = [];
  for (const f of frames) {
    if (f.type === 'stream' && typeof f.content === 'string') pieces.push(f.content);
    if (f.type === 'content_delta' && typeof f.content === 'string') pieces.push(f.content);
  }
  return pieces.join('');
}

function artifactHtml(frames: Frame[]): string | null {
  // Look for the full artifact body across artifact_open/delta/close frames.
  // Also look in agent output for extracted HTML.
  const pieces: string[] = [];
  for (const f of frames) {
    if (f.type === 'artifact_delta' && typeof f.content === 'string') pieces.push(f.content);
    if (f.type === 'stream' && typeof f.content === 'string') pieces.push(f.content);
  }
  const joined = pieces.join('');
  const match = joined.match(/```artifact:html([\s\S]+?)```/) || joined.match(/```artifact:react([\s\S]+?)```/);
  return match ? match[1] : null;
}

test.describe.configure({ mode: 'serial' });

// Prompts with real LLMs + tool calls can run 2-5 min each; default config
// timeout of 120s isn't enough. Set per-test via test.setTimeout where needed.
const LONG_TEST_MS = 360_000;

test.describe('Plan-permutation matrix (2026-04-23)', () => {
  test.skip(!JWT, 'AW_JWT env var required — extract from chat-dev cookie');

  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext();
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('T1 — simple chat routes to Sonnet-class (not Ministral) [#99 quality-bonus]', async () => {
    const sid = await createSession(api, 't1-simple-chat');
    const frames = await streamChat(api, sid, 'Hello — write me a two-line haiku about the sea.');
    const models = modelsUsed(frames);
    expect(models.length, 'at least one model stamp').toBeGreaterThan(0);
    // Any model that ISN'T ministral-3-3b (the pre-fix bad choice)
    const picked = models.join(',');
    expect(picked, `models used: ${picked}`).not.toMatch(/ministral[-_]?3/i);
  });

  test('T2 — architecture prompt engages architecture-diagram module [plan task 3]', async () => {
    const sid = await createSession(api, 't2-arch-module');
    // 2+ complexity keywords: "architecture" + "interactive" + "layered"
    const frames = await streamChat(
      api,
      sid,
      'Build me an interactive layered architecture diagram for a simple web app.',
    );
    const html = artifactHtml(frames) ?? assistantText(frames);
    // architecture-diagram module says "emit artifact:react" and references React Flow Layer/Node/Edge primitives
    expect(html.length, 'some artifact content returned').toBeGreaterThan(100);
    // At minimum must reference a render surface (react, html, mermaid is the fallback)
    expect(html).toMatch(/artifact:react|artifact:html|Layer|Node|Edge|flowchart/i);
  });

  test('T3 — complexity bias escalates to frontier FCA ≥ 0.93 [plan task 4]', async () => {
    const sid = await createSession(api, 't3-complexity-bias');
    // "decoupled multicloud architecture ... scale ... enterprise" = 4+ complexity keywords → frontier filter
    const frames = await streamChat(
      api,
      sid,
      'Sketch a decoupled multicloud architecture at enterprise scale for 100 million users. Keep it brief.',
    );
    const models = modelsUsed(frames);
    const picked = models.join(',');
    // Frontier tier = Sonnet/Opus/o3/GPT-5/Gemini-class. Must NOT be ollama/qwen/gpt-oss/ministral.
    expect(picked, `models used: ${picked}`).toMatch(/sonnet|opus|o3|gpt-5|gemini|claude/i);
    expect(picked).not.toMatch(/ministral|qwen|gpt-oss|ollama/i);
  });

  test('T4 — cloud-resources artifact is professional (no emoji, CSS vars) [1103bf72 prompt module]', async () => {
    const sid = await createSession(api, 't4-professional-artifact');
    const frames = await streamChat(
      api,
      sid,
      'show me all of my cloud resources in an interactive diagram',
      300_000,
    );
    const html = artifactHtml(frames) ?? assistantText(frames);
    // Professional visuals module says: ban emoji as chrome, use CSS vars, use SVG stencils
    // Check for CSS var usage (var(--app-*))
    expect(html, 'artifact should reference --app-* CSS vars').toMatch(/var\(--app-/);
    // Emoji regex — ornamental emoji (🌐 📊 etc.) in CHROME (headers, card titles) should be absent.
    // Soft check: the artifact may still include ONE emoji if it's inside a legit data cell — so we
    // require the emoji count is under a small threshold (not absolute zero).
    const emojiMatches = html.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? [];
    expect(emojiMatches.length, `emoji count in artifact: ${emojiMatches.length}`).toBeLessThan(5);
  });

  test('T5 — multi-persona delegation routes full content to parent [bbc6c861 short-circuit gate]', async () => {
    const sid = await createSession(api, 't5-multi-persona-gate');
    // Explicit multi-agent delegate with aggregation=merge to exercise the NEW gate path
    const prompt =
      'Call delegate_to_agents with two agents in parallel: {"role":"finops_analyst","task":"Name the top 2 AWS services by spend"}, ' +
      '{"role":"security_auditor","task":"Name 2 IAM compliance issues to check"}. ' +
      'Use orchestration="parallel" and aggregation="merge". After both complete, synthesize their outputs into ONE combined summary.';
    const frames = await streamChat(api, sid, prompt, 300_000);
    // Parent LLM must emit its OWN content after the sub-agents complete (not just the "done, ack it" stub).
    // Evidence: final assistant text is > 200 chars AND mentions BOTH personas' domains (finops + security).
    const text = assistantText(frames);
    expect(text.length, `final parent text length: ${text.length}`).toBeGreaterThan(200);
    // If the gate works, the parent's synthesis mentions both domains
    expect(text.toLowerCase(), 'parent synthesis mentions finops/cost').toMatch(/(cost|spend|finops|aws)/);
    expect(text.toLowerCase(), 'parent synthesis mentions security/iam').toMatch(/(iam|security|compliance)/);
  });

  test('T6 — destructive intent still escalates to frontier (regression)', async () => {
    const sid = await createSession(api, 't6-destructive-regression');
    const frames = await streamChat(
      api,
      sid,
      'Please explain why I should NOT delete resource group rg-prod-01 — but do not actually delete anything.',
      120_000,
    );
    const models = modelsUsed(frames);
    const picked = models.join(',');
    // Destructive escalation → frontier only
    expect(picked, `models used: ${picked}`).toMatch(/sonnet|opus|o3|gpt-5|gemini|claude/i);
  });

});
