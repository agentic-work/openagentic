/**
 * openagentic-proxy: definition route DEFER_AGENTS gating.
 *
 * Contract:
 *  - When `DEFER_AGENTS=true`, GET /api/agents/definitions returns ONLY
 *    a single `general-purpose` built-in. All DB-backed agents are
 *    HIDDEN. The model only sees the agent_search meta-tool until it
 *    discovers candidates via the search route. This matches Claude
 *    Code's "agents on demand" pattern.
 *  - When `DEFER_AGENTS=false` (default), behaviour is unchanged from
 *    the legacy contract: built-ins + cached DB agents merged.
 *
 * Design choice: `DEFER_AGENTS=true` returns ONLY `general-purpose`
 * (not empty). Reason: callers (codemode, workflows) still need a
 * "Task can dispatch" sanity entry without rebuilding their entire
 * defaults pipeline. The agent-discovery flow runs through agent_search
 * — definitions.ts is for resolution, not discovery.
 *
 * The route imports `authMiddleware` (which depends on pino) at module
 * load. Under node:test/strip-types we cannot resolve those without
 * matching extension paths, so we test the PURE gating helper directly
 * — `applyDeferAgentsGate(builtIns, dbAgents, deferEnv)` — and trust
 * the route handler to compose it. The handler logic itself is one
 * line: `applyDeferAgentsGate(BUILTIN_AGENTS, dbAgents, process.env.DEFER_AGENTS)`.
 *
 * Runner: Node 24 `node:test` + `--experimental-strip-types`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeferAgentsGate, GENERAL_PURPOSE_AGENT } from '../routes/definitionsGate.ts';

const FAKE_BUILTINS = [
  { id: 'research', name: 'Research Agent', role: 'reasoning' },
  { id: 'data-analyst', name: 'Data Analyst', role: 'data_query' },
  { id: 'code-generator', name: 'Code Generator', role: 'code_execution' },
];

const FAKE_DB = [
  { id: 'custom-1', name: 'Custom Bob', role: 'custom', source: 'database' },
  { id: 'custom-2', name: 'Custom Alice', role: 'custom', source: 'database' },
];

test('DEFER_AGENTS unset/false — returns full catalog (built-ins + DB merged)', () => {
  const merged = applyDeferAgentsGate(FAKE_BUILTINS, FAKE_DB, undefined);
  assert.strictEqual(merged.length, FAKE_BUILTINS.length + FAKE_DB.length);
  const ids = merged.map((a: any) => a.id);
  assert.ok(ids.includes('research'));
  assert.ok(ids.includes('data-analyst'));
  assert.ok(ids.includes('custom-1'));
  assert.ok(ids.includes('custom-2'));
});

test('DEFER_AGENTS="false" — returns full catalog (string false treated as off)', () => {
  const merged = applyDeferAgentsGate(FAKE_BUILTINS, FAKE_DB, 'false');
  assert.strictEqual(merged.length, FAKE_BUILTINS.length + FAKE_DB.length);
});

test('DEFER_AGENTS="true" — returns ONLY general-purpose, hides built-ins and DB', () => {
  const result = applyDeferAgentsGate(FAKE_BUILTINS, FAKE_DB, 'true');
  assert.strictEqual(result.length, 1, 'must collapse to a single agent');
  assert.strictEqual(result[0].id, 'general-purpose');

  const ids = result.map((a: any) => a.id);
  assert.ok(!ids.includes('research'));
  assert.ok(!ids.includes('data-analyst'));
  assert.ok(!ids.includes('custom-1'));
  assert.ok(!ids.includes('custom-2'));
});

test('GENERAL_PURPOSE_AGENT has the canonical shape required by Task tool', () => {
  // Task expects { id, role, description } at minimum.
  assert.strictEqual(GENERAL_PURPOSE_AGENT.id, 'general-purpose');
  assert.strictEqual(typeof GENERAL_PURPOSE_AGENT.name, 'string');
  assert.strictEqual(typeof GENERAL_PURPOSE_AGENT.role, 'string');
  assert.strictEqual(typeof (GENERAL_PURPOSE_AGENT as any).description, 'string');
});

test('DEFER_AGENTS="true" overrides duplicate IDs — DB cannot leak through merge', () => {
  // Even if a DB agent claims id='general-purpose', defer mode returns only
  // the canonical one (not the DB-shadowed copy).
  const dbWithCollision = [...FAKE_DB, { id: 'general-purpose', name: 'Hijack', role: 'malicious' }];
  const result = applyDeferAgentsGate(FAKE_BUILTINS, dbWithCollision, 'true');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, GENERAL_PURPOSE_AGENT.name,
    'general-purpose name must match canonical, not DB override');
});
