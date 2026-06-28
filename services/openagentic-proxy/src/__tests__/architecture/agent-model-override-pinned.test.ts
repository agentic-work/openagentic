/**
 * Source-regression cage: per-agent model override (model_config.primaryModel)
 * MUST be honored when an agent row is resolved from the API, even when the
 * row's `system_prompt` column is empty.
 *
 * Background:
 *   - Agent table column: `agent.model_config` (Json), with `primaryModel` field.
 *   - API endpoint: GET /api/agents/resolve?role=<role>&mode=<mode>
 *     returns `{ model: model_config.primaryModel || 'auto', systemPrompt, ... }`.
 *   - Caller: openagentic-proxy AgentOrchestrator.resolveAgentFromAPI() reads the
 *     response and threads `dbConfig.model` into the per-agent spec as the
 *     middle precedence tier: `a.model || dbConfig?.model || DEFAULT_MODELS[role]`.
 *
 * Bug (2026-05-13): the resolve-response gate was
 *   `if (res.status === 200 && res.data?.systemPrompt) { ... }`
 * which falsy-rejected rows with empty `system_prompt`. Since ~11 of 19
 * default platform agents ship with an empty prompt (DEFAULT_PROMPTS[role]
 * is applied at runtime by AgentOrchestrator), those rows' primaryModel
 * overrides were silently dropped — every call fell through to
 * DEFAULT_MODELS[role] = 'auto' (Smart Router). Live probe confirmed:
 * setting `custom` default agent's primaryModel to 'gpt-oss:20b' produced
 * `modelUsed: 'auto'` and Smart Router picked claude-sonnet-4-6 instead.
 *
 * Fix: drop the `&& res.data?.systemPrompt` clause. Empty prompts still
 * fall through to DEFAULT_PROMPTS[role] via the existing
 * `dbConfig?.systemPrompt || DEFAULT_PROMPTS[a.role]` fallback in
 * runExecution(), so behavior is unchanged for the prompt path.
 *
 * This test grep-pins both invariants:
 *   1. The gate is `res.status === 200 && res.data` (NOT `&& res.data?.systemPrompt`).
 *   2. AgentOrchestrator reads `dbConfig?.model` into the resolved spec's
 *      `model` field (precedence: spec → dbConfig → DEFAULT_MODELS).
 *
 * Runner: Node 24 `node:test` + `--experimental-strip-types`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORCHESTRATOR_PATH = join(
  process.cwd(),
  'src/services/AgentOrchestrator.ts',
);

test('AgentOrchestrator.resolveAgentFromAPI does NOT gate on truthy systemPrompt', () => {
  const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');

  // Forbidden pattern that caused the bug:
  const forbidden = /res\.status\s*===\s*200\s*&&\s*res\.data\?\.systemPrompt/;
  assert.equal(
    forbidden.test(src),
    false,
    'AgentOrchestrator.ts must not gate the resolve-response branch on ' +
    'truthy `res.data.systemPrompt`. Empty system_prompt rows must still ' +
    'flow into dbConfig so model_config.primaryModel is honored. Use ' +
    '`res.status === 200 && res.data` instead.',
  );

  // Required pattern post-fix:
  const required = /if\s*\(\s*res\.status\s*===\s*200\s*&&\s*res\.data\s*\)/;
  assert.equal(
    required.test(src),
    true,
    'AgentOrchestrator.ts must use `if (res.status === 200 && res.data)` ' +
    'to gate the resolve-response success branch.',
  );
});

test('AgentOrchestrator.runExecution threads dbConfig.model into per-agent spec', () => {
  const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');

  // Precedence line: spec.model -> dbConfig.model -> DEFAULT_MODELS[role] -> DEFAULT_MODELS.custom
  const precedence = /model:\s*a\.model\s*\|\|\s*dbConfig\?\.model\s*\|\|\s*DEFAULT_MODELS\[a\.role\]\s*\|\|\s*DEFAULT_MODELS\.custom/;
  assert.equal(
    precedence.test(src),
    true,
    'AgentOrchestrator.ts must preserve the model precedence ' +
    '`a.model || dbConfig?.model || DEFAULT_MODELS[a.role] || DEFAULT_MODELS.custom`. ' +
    'Removing the dbConfig?.model tier breaks per-agent overrides set via ' +
    'admin.agentic_loops.model_config.primaryModel.',
  );
});

test('AgentOrchestrator.callLLM passes the resolved model verbatim to the inner LLM call', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/services/AgentRunner.ts'),
    'utf8',
  );

  // callLLM signature must accept model as the FIRST positional param
  // and the request body must include `model` keyed directly to that param.
  const signature = /private\s+async\s+callLLM\(model:\s*string/;
  assert.equal(
    signature.test(src),
    true,
    'AgentRunner.callLLM must accept `model: string` as first parameter.',
  );

  // The OpenAI-compatible body must include `model,` (shorthand) — not a
  // hardcoded literal or a coerced 'auto'.
  const bodyShorthand = /requestBody:\s*Record<string,\s*any>\s*=\s*\{\s*\n\s*model,/;
  assert.equal(
    bodyShorthand.test(src),
    true,
    'AgentRunner.callLLM must POST {model, ...} verbatim to the API ' +
    'completions endpoint. Hardcoding the model literal or overriding ' +
    'it with `auto` breaks per-agent overrides.',
  );
});
