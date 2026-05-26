/**
 * REAL-MODEL GATE (#1071, 2026-05-24) — CLAUDE.md Rule 7c.
 *
 * Hits the LIVE Ollama at gpt-oss:20b (same model production chat uses),
 * NO mocks. Proves the Harmony-synthesis salvage mechanism works against
 * the real model: given the Azure subscriptions + resource-groups tool
 * results already in history, the no-tools synthesis re-call (the exact
 * body buildHarmonySynthesisRecall produces) must return a real plain-text
 * answer that names the subscriptions — NOT a tool call, NOT empty.
 *
 * This is the gate that matters. The salvage path's correctness depends on
 * the live model actually producing text when tools are stripped + nudged;
 * a mock can't prove that. Skips (does not fail) only when hal is genuinely
 * unreachable from the test env, per the task's reachability caveat.
 *
 * Run: HARNESS_LIVE=1 vitest run <thisfile>
 * Evidence saved to reports/real-model-harness/q1-harmony-recovery/.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildHarmonySynthesisRecall,
  extractOllamaContent,
} from '../util/ollamaHarmonySynthesisSalvage.js';

const HAL_BASE =
  process.env.OLLAMA_BASE_URL || 'http://10.2.10.142:11434';
const MODEL = process.env.HARNESS_OLLAMA_MODEL || 'gpt-oss:20b';
const RUN_LIVE = process.env.HARNESS_LIVE === '1' || process.env.CI_REAL_MODEL === '1';

// Tool-result history mirroring the live Q1 capture: two subscriptions and
// their resource groups already fetched. Ollama wire shape.
const HISTORY_WITH_TOOL_RESULTS = [
  {
    role: 'user',
    content: 'show me my Azure subscriptions and what is in each resource group',
  },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      { function: { name: 'azure_list_subscriptions', arguments: {} } },
      { function: { name: 'azure_list_resource_groups', arguments: {} } },
    ],
  },
  {
    role: 'tool',
    content: JSON.stringify({
      subscriptions: [
        { id: '6ed00000-1111-2222-3333-444455556666', name: 'Phat-Prod' },
        { id: '815a0000-7777-8888-9999-aaaabbbbcccc', name: 'Phat-Dev' },
      ],
    }),
  },
  {
    role: 'tool',
    content: JSON.stringify({
      resourceGroups: [
        { subscription: 'Phat-Prod', name: 'rg-prod-eastus', location: 'eastus' },
        { subscription: 'Phat-Prod', name: 'rg-prod-network', location: 'eastus' },
        { subscription: 'Phat-Dev', name: 'rg-dev-westus', location: 'westus' },
      ],
    }),
  },
];

async function halReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${HAL_BASE}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

describe('OllamaProvider — Harmony salvage REAL-MODEL gate (#1071, Rule 7c)', () => {
  it('the no-tools synthesis re-call returns real text naming the subscriptions (live gpt-oss:20b)', async () => {
    if (!RUN_LIVE) {
      // Default vitest run does not hit the network. The live gate runs
      // under HARNESS_LIVE=1 and via scripts/harness. Skip cleanly otherwise.
      return;
    }
    if (!(await halReachable())) {
      // Task caveat: skip (do not fail) when hal is unreachable from test env.
      console.warn(`[harness] hal unreachable at ${HAL_BASE} — skipping live gate`);
      return;
    }

    const recallBody = buildHarmonySynthesisRecall({
      model: MODEL,
      messages: HISTORY_WITH_TOOL_RESULTS,
      tools: [
        { type: 'function', function: { name: 'azure_list_subscriptions' } },
        { type: 'function', function: { name: 'azure_list_resource_groups' } },
      ],
      stream: true,
    });

    const resp = await fetch(`${HAL_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(recallBody),
      signal: AbortSignal.timeout(120000),
    });

    expect(resp.ok, `live /api/chat returned ${resp.status}`).toBe(true);
    const data = await resp.json();
    const text = extractOllamaContent(data);

    // Evidence capture. vitest cwd is services/openagentic-api; the repo-root
    // reports dir is two levels up.
    const dir = resolve(
      process.cwd(),
      '../../reports/real-model-harness/q1-harmony-recovery',
    );
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        resolve(dir, `recall-${Date.now()}.json`),
        JSON.stringify({ model: MODEL, halBase: HAL_BASE, request: recallBody, response: data, extractedText: text }, null, 2),
      );
    } catch {
      /* evidence best-effort */
    }

    expect(text, 'live model must produce a non-empty text synthesis').toBeTruthy();
    // Must name at least one subscription from the tool results. gpt-oss:20b
    // sometimes renders names with Unicode hyphens/dashes (U+2010..U+2015,
    // U+2212) — normalize to ASCII '-' before matching.
    const normalized = (text || '').replace(/[‐-―−]/g, '-');
    expect(/Phat-Prod|Phat-Dev/i.test(normalized)).toBe(true);
    // Must NOT have emitted a tool call.
    expect((data?.message?.tool_calls ?? []).length).toBe(0);
  }, 130000);
});
