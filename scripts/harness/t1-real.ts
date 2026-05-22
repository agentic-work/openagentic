#!/usr/bin/env -S node --experimental-strip-types
/**
 * scripts/harness/t1-real.ts
 *
 * Real-TDD harness for the T1 catalog (14 tools at
 * services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts:104-125).
 *
 * Every case drives the live `/api/chat/stream` endpoint against chat-dev
 * with a real prompt and asserts on the captured NDJSON. The chat model
 * id is resolved from the registry SoT (`/api/admin/llm-providers/default-models`).
 * NO model literals in this file — that would violate CLAUDE.md Rule 7.
 *
 * Usage:
 *   OPENAGENTIC_TEST_KEY=$(cat ~/.openagentic-test-key) \
 *     node --experimental-strip-types scripts/harness/t1-real.ts            # all cases
 *
 *   T1_CASES=compose_visual node --experimental-strip-types scripts/harness/t1-real.ts
 *
 * Env:
 *   OPENAGENTIC_TEST_KEY  — bearer (falls back to ~/.openagentic-test-key)
 *   OPENAGENTIC_HOST      — default https://chat-dev.openagentic.io
 *   T1_CASES              — comma-separated case names; default ALL
 *   T1_TIMEOUT_MS         — per-case timeout (default 240000)
 *   EVIDENCE_DIR          — default reports/verify-cadence/t1-harness-<sha>/
 *
 * Output (per case):
 *   <EVIDENCE_DIR>/<name>.ndjson  raw NDJSON wire capture
 *   <EVIDENCE_DIR>/<name>.json    summary + assertion verdict
 *   <EVIDENCE_DIR>/SUMMARY.json   roll-up across cases
 *
 * Exit code: 0 if all selected cases GREEN, 1 otherwise.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env.OPENAGENTIC_HOST || 'https://chat-dev.openagentic.io';
const TIMEOUT_MS = Number(process.env.T1_TIMEOUT_MS || 240_000);

function resolveKey(): string {
  if (process.env.OPENAGENTIC_TEST_KEY) return process.env.OPENAGENTIC_TEST_KEY;
  const f = join(homedir(), '.openagentic-test-key');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('OPENAGENTIC_TEST_KEY not set and ~/.openagentic-test-key missing');
}

function sha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return String(Date.now());
  }
}

/** Resolve the chat model id from the registry SoT. */
async function resolveChatModel(key: string): Promise<string> {
  const r = await fetch(`${HOST}/api/admin/llm-providers/default-models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`default-models HTTP ${r.status}`);
  const j = (await r.json()) as { defaults?: { chat?: string } };
  const id = j?.defaults?.chat;
  if (!id) throw new Error('No chat default-model configured in registry');
  return id;
}

/** Mint a fresh chat session so SESSION_NOT_OWNED never fires. */
async function newSession(key: string, title: string): Promise<string> {
  const r = await fetch(`${HOST}/api/chat/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`sessions POST HTTP ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  const id = j?.session?.id ?? j?.id ?? j?.sessionId;
  if (!id) throw new Error(`session id missing from response: ${JSON.stringify(j)}`);
  return id;
}

interface Frame {
  type?: string;
  [k: string]: unknown;
}

interface CaptureResult {
  frames: Frame[];
  raw: string;
  elapsedMs: number;
  httpStatus: number;
}

/** POST /api/chat/stream and accumulate NDJSON frames. */
async function captureStream(
  key: string,
  sessionId: string,
  message: string,
): Promise<CaptureResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let httpStatus = 0;
  const frames: Frame[] = [];
  let raw = '';
  try {
    const r = await fetch(`${HOST}/api/chat/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
      signal: ctrl.signal,
    });
    httpStatus = r.status;
    if (!r.body) throw new Error(`stream body missing (HTTP ${r.status})`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          frames.push(JSON.parse(line));
        } catch {
          // Tolerate non-JSON lines (rare). Recorded in raw for diff.
        }
      }
    }
  } finally {
    clearTimeout(t);
  }
  return { frames, raw, elapsedMs: Date.now() - t0, httpStatus };
}

/** What every per-case assertion gets. */
interface AssertCtx {
  frames: Frame[];
  toolNames: string[];
  hasFrame: (predicate: (f: Frame) => boolean) => boolean;
  countFrames: (predicate: (f: Frame) => boolean) => number;
}

interface Turn {
  prompt: string;
  assert: (c: AssertCtx) => { ok: boolean; reason: string };
}

interface Case {
  name: string; // T1 tool name OR test-id
  turns: Turn[]; // 1 or more turns, run sequentially in same session
}

/**
 * T1 cases. Each turn drives ONE chat turn and asserts on its NDJSON
 * capture. Multi-turn cases match the platform's documented composition
 * contract: turn 1 gathers data + offers the artifact, turn 2 explicitly
 * requests it and the model emits.
 *
 * First case = compose_visual — the Sev-0 #905 reproduced live. Per
 * `getCostAuditCompositionSection` + `getArtifactExplicitRequestGate`,
 * the platform contract is:
 *   - Turn 1 ("show me X and render a sankey"): list tools fire, model
 *     ends with prose + follow_up offer. compose_visual may or may not
 *     fire here depending on model capability (Sonnet may same-turn,
 *     Haiku defers).
 *   - Turn 2 ("yes, render the sankey of the data from above"): the
 *     EXPLICIT-ASK on an unambiguous prompt MUST trigger compose_visual.
 *     This is the gate — if it doesn't fire here, the rule is broken.
 */
const CASES: Case[] = [
  {
    name: 'compose_visual',
    turns: [
      {
        prompt:
          'Show me my Azure subscriptions and resource groups. Render a sankey ' +
          'diagram of resource distribution by subscription.',
        assert: ({ toolNames }) => {
          // Turn 1 baseline: model MUST gather Azure data. compose_visual is
          // OK but not required this turn (capable models do; Haiku defers).
          const listed =
            toolNames.includes('azure_list_subscriptions') ||
            toolNames.includes('azure_list_resource_groups') ||
            toolNames.includes('tool_search');
          if (!listed) {
            return {
              ok: false,
              reason: 'turn 1 expected list/discover tool, got: ' + toolNames.join(','),
            };
          }
          return { ok: true, reason: 'turn 1 listed/discovered: ' + toolNames.join(',') };
        },
      },
      {
        prompt:
          'Yes — render the sankey diagram now using the data you just retrieved. ' +
          'Emit a compose_visual tool_use. This is an explicit request for the ' +
          'visualization; do not return a markdown table.',
        assert: ({ toolNames, hasFrame }) => {
          // Turn 2 gate: explicit-ask MUST fire compose_visual.
          const calledTool = toolNames.includes('compose_visual');
          if (!calledTool) {
            return {
              ok: false,
              reason: 'turn 2 explicit-ask: compose_visual NEVER fired (tools=' + toolNames.join(',') + ')',
            };
          }
          const hasVizFrame = hasFrame(
            (f) => f.type === 'viz_render' || f.type === 'compose_visual',
          );
          if (!hasVizFrame) {
            return { ok: false, reason: 'compose_visual dispatched but no viz_render frame' };
          }
          return { ok: true, reason: 'compose_visual dispatched + viz_render frame present' };
        },
      },
    ],
  },
];

function summarize(frames: Frame[]) {
  const tally: Record<string, number> = {};
  const toolNames: string[] = [];
  for (const f of frames) {
    const t = typeof f.type === 'string' ? f.type : '<no-type>';
    tally[t] = (tally[t] || 0) + 1;
    if (t === 'tool_executing' && typeof (f as any).name === 'string') {
      toolNames.push((f as any).name);
    }
  }
  return { tally, toolNames };
}

async function runCase(
  c: Case,
  key: string,
  model: string,
  evidenceDir: string,
): Promise<{
  name: string;
  ok: boolean;
  reason: string;
  elapsedMs: number;
  httpStatus: number;
  turnCount: number;
}> {
  // ONE session shared across all turns of the case — the platform's
  // composition contract requires session-state continuity.
  const sessionId = await newSession(key, `t1-real-${c.name}`);
  const perTurn: Array<{
    turnIdx: number;
    ok: boolean;
    reason: string;
    elapsedMs: number;
    httpStatus: number;
    toolNames: string[];
    tally: Record<string, number>;
    frameCount: number;
  }> = [];
  let totalElapsed = 0;
  let lastHttp = 0;
  let allOk = true;

  for (let i = 0; i < c.turns.length; i++) {
    const turn = c.turns[i];
    const cap = await captureStream(key, sessionId, turn.prompt);
    totalElapsed += cap.elapsedMs;
    lastHttp = cap.httpStatus;
    const { tally, toolNames } = summarize(cap.frames);
    const ctx: AssertCtx = {
      frames: cap.frames,
      toolNames,
      hasFrame: (p) => cap.frames.some(p),
      countFrames: (p) => cap.frames.filter(p).length,
    };
    const verdict = turn.assert(ctx);
    if (!verdict.ok) allOk = false;
    perTurn.push({
      turnIdx: i + 1,
      ok: verdict.ok,
      reason: verdict.reason,
      elapsedMs: cap.elapsedMs,
      httpStatus: cap.httpStatus,
      toolNames,
      tally,
      frameCount: cap.frames.length,
    });

    // Per-turn NDJSON capture for forensic replay.
    writeFileSync(join(evidenceDir, `${c.name}.turn${i + 1}.ndjson`), cap.raw);

    // Stop early if a turn failed AND the next turn would depend on prior
    // turn state (which is always true in our composition contract).
    if (!verdict.ok) break;
  }

  const finalReason = perTurn
    .map((p) => `turn${p.turnIdx}: ${p.ok ? 'OK' : 'FAIL'} — ${p.reason}`)
    .join(' | ');

  writeFileSync(
    join(evidenceDir, `${c.name}.json`),
    JSON.stringify(
      {
        case: c.name,
        ok: allOk,
        reason: finalReason,
        model,
        sessionId,
        turnCount: c.turns.length,
        completedTurns: perTurn.length,
        totalElapsedMs: totalElapsed,
        perTurn,
      },
      null,
      2,
    ),
  );

  return {
    name: c.name,
    ok: allOk,
    reason: finalReason,
    elapsedMs: totalElapsed,
    httpStatus: lastHttp,
    turnCount: c.turns.length,
  };
}

async function main() {
  const key = resolveKey();
  const filter = (process.env.T1_CASES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = filter.length === 0 ? CASES : CASES.filter((c) => filter.includes(c.name));
  if (selected.length === 0) {
    console.error(`no cases matched filter: ${filter.join(',')}`);
    process.exit(2);
  }

  const model = await resolveChatModel(key);
  const dir =
    process.env.EVIDENCE_DIR || join('reports', 'verify-cadence', `t1-harness-${sha()}`);
  mkdirSync(dir, { recursive: true });

  console.error(`[t1-real] model=${model}`);
  console.error(`[t1-real] host=${HOST}`);
  console.error(`[t1-real] cases=${selected.map((c) => c.name).join(',')}`);
  console.error(`[t1-real] dir=${dir}`);

  const results: Array<Awaited<ReturnType<typeof runCase>>> = [];
  for (const c of selected) {
    const started = new Date().toISOString();
    process.stderr.write(`  → ${c.name} ... `);
    try {
      const r = await runCase(c, key, model, dir);
      results.push(r);
      process.stderr.write(`${r.ok ? 'GREEN' : 'RED'} (${r.elapsedMs}ms) — ${r.reason}\n`);
    } catch (e: any) {
      results.push({
        name: c.name,
        ok: false,
        reason: `harness threw: ${e?.message || String(e)}`,
        elapsedMs: 0,
        httpStatus: 0,
      });
      process.stderr.write(`THREW — ${e?.message || e}\n`);
    }
    void started;
  }

  const summary = {
    host: HOST,
    model,
    sha: sha(),
    timestamp: new Date().toISOString(),
    results,
    counts: {
      total: results.length,
      green: results.filter((r) => r.ok).length,
      red: results.filter((r) => !r.ok).length,
    },
  };
  writeFileSync(join(dir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));

  console.error('');
  console.error(`[t1-real] ${summary.counts.green}/${summary.counts.total} GREEN`);
  console.error(`[t1-real] SUMMARY: ${join(dir, 'SUMMARY.json')}`);
  process.exit(summary.counts.red === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`[t1-real] fatal: ${e?.stack || e?.message || e}`);
  process.exit(2);
});
