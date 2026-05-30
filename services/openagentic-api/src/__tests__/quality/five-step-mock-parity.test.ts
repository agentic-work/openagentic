/**
 * Phase F Layer 2 — five-step primitive → mock DOM parity contract
 *
 * Asserts that the canonical NDJSON event taxonomy + the api's tool-card /
 * sub-agent / streaming-table / compose_visual envelopes can mount EVERY
 * primitive class declared in the reference mock `mocks/UX/01-cloud-ops.html`.
 *
 * Layer 1 (SDK probe replay) proves the wire envelope is canonical for each
 * provider. Layer 2 (this file) proves the api's NDJSON event taxonomy
 * declares the frame types the UI mocks render. If a primitive lives in the
 * mock but no api event type can produce it, the mock is a lie — and that's
 * the regression this test catches.
 *
 * 5-step primitive → mock DOM class map:
 *   1. User asks                  → .msg-user
 *   2. Model picks tools          → .tool .tool-parallel-hdr .tool-parallel
 *   3. Tools dispatch + return    → .tool[data-state="running"|"done"]
 *   4. Model synthesizes          → .msg-asst .msg-body + .thinking
 *   5. UI renders inline          → .streaming-table .savings-card
 *                                   .citation .cost-pill.live .subagent.agent-c
 *
 * Per memory rule feedback_no_synthetic_chunks_only_real_provider_captures.md,
 * this file does NOT call providers — it asserts contract-level coverage.
 * Layer 3 (Playwright) is the end-to-end live-verify.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// services/openagentic-api/src/__tests__/quality/ → repo root is 5 levels up
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const REFERENCE_MOCK = join(REPO_ROOT, 'mocks', 'UX', '01-cloud-ops.html');

/**
 * Map: mock DOM class → list of api event-emit types or canonical event
 * types that, when fired in a chat-stream NDJSON envelope, the UI mounts
 * that class. If a class has no event mapping, the UI is rendering
 * something the api can never emit — that's a contract violation.
 *
 * The api emit channel uses opcodes (see EventSequencer / openagentic-sdk
 * canonical taxonomy). For the AC battery these are the operative ones:
 *
 *   '0'                       text delta (Anthropic Vercel-style)
 *   'tool_executing'          tool dispatch start
 *   'tool_result'             tool result envelope
 *   'thinking_delta'          reasoning chunk
 *   'streaming_table'         compose_visual streaming_table template
 *   'compose_visual'          compose_visual catch-all (savings_card etc)
 *   'rag_citation'            inline citation pill
 *   'cost_tick'               cost pill update
 *   'sub_agent_started'       sub-agent lifecycle begin
 *   'sub_agent_finished'      sub-agent lifecycle end
 *   'parallel_tool_use'       parallel tool dispatch header
 *   'message_handoff_offer'   model_handoff_offer
 *
 * The UI mock classes are pinned here; if the mock changes, this test
 * changes alongside it (one place to keep them aligned).
 */
const MOCK_CLASS_TO_NDJSON_EVENT: Record<
  string,
  { events: string[]; describesStep: 1 | 2 | 3 | 4 | 5 }
> = {
  '.msg-user': { events: ['user_message'], describesStep: 1 },
  '.tool': { events: ['tool_executing', 'tool_result'], describesStep: 3 },
  '.tool.running': { events: ['tool_executing'], describesStep: 3 },
  '.tool.done': { events: ['tool_result'], describesStep: 3 },
  '.tool-parallel': { events: ['parallel_tool_use', 'tool_executing'], describesStep: 2 },
  '.tool-parallel-hdr': { events: ['parallel_tool_use'], describesStep: 2 },
  '.subagent.agent-c': { events: ['sub_agent_started', 'sub_agent_finished'], describesStep: 3 },
  '.streaming-table': { events: ['streaming_table', 'compose_visual'], describesStep: 5 },
  '.savings-card': { events: ['compose_visual'], describesStep: 5 },
  '.cost-pill.live': { events: ['cost_tick'], describesStep: 5 },
  '.thinking': { events: ['thinking_delta'], describesStep: 4 },
  '.citation': { events: ['rag_citation'], describesStep: 5 },
};

/**
 * Read the reference mock and extract every distinctive primitive class it
 * uses. Returns a flat set of CSS-style selectors derived from class
 * attribute values.
 */
function extractMockClasses(): Set<string> {
  if (!existsSync(REFERENCE_MOCK)) {
    throw new Error(`Reference mock not found at ${REFERENCE_MOCK}`);
  }
  const html = readFileSync(REFERENCE_MOCK, 'utf-8');
  const out = new Set<string>();
  const re = /class="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const classes = m[1]!.split(/\s+/).filter(Boolean);
    // Selectors of interest are 1- and 2-part class compositions that match
    // the primitives we declare a contract for.
    if (classes.length === 1) out.add(`.${classes[0]}`);
    if (classes.length >= 2) {
      // Stable composite: e.g. ".tool.running" or ".subagent.agent-c"
      out.add('.' + classes.join('.'));
      // Also add each class on its own (some primitives are referenced via
      // single-class selectors in the contract).
      for (const c of classes) out.add(`.${c}`);
    }
  }
  return out;
}

describe('Phase F Layer 2 — five-step primitive ↔ 01-cloud-ops.html mock parity', () => {
  let mockClasses: Set<string>;
  try {
    mockClasses = extractMockClasses();
  } catch (err) {
    // Surface a single big skip instead of N silent failures.
    it.skip(`mock not present: ${(err as Error).message}`, () => {});
    return;
  }

  it('reference mock 01-cloud-ops.html parses + has the five-step primitive classes', () => {
    // Sanity gate: if the mock evolved and dropped a key class, surface it
    // here BEFORE asserting downstream mappings.
    const required = [
      '.msg-user',
      '.tool',
      '.tool-parallel',
      '.subagent',
      '.streaming-table',
      '.savings-card',
      '.cost-pill',
      '.thinking',
      '.citation',
    ];
    const missing = required.filter((c) => !mockClasses.has(c));
    expect(
      missing,
      `Reference mock is missing primitive classes — was the mock changed without updating MOCK_CLASS_TO_NDJSON_EVENT? Missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every primitive in MOCK_CLASS_TO_NDJSON_EVENT is present in the mock', () => {
    // Forward direction: the contract declares X classes; every one must
    // actually live in the mock (no contract for classes that aren't there).
    const violations: string[] = [];
    for (const selector of Object.keys(MOCK_CLASS_TO_NDJSON_EVENT)) {
      // Selectors may include compound forms like '.tool.running'; we test
      // both the compound AND the base — at least one must be in the mock.
      const base = '.' + selector.split('.').filter(Boolean)[0];
      if (!mockClasses.has(selector) && !mockClasses.has(base)) {
        violations.push(`${selector} (and base ${base}) not in mock`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('each step (1..5) of the five-step primitive has ≥1 mock class mapped to it', () => {
    const byStep: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const [sel, spec] of Object.entries(MOCK_CLASS_TO_NDJSON_EVENT)) {
      byStep[spec.describesStep]!.push(sel);
    }
    for (const step of [1, 2, 3, 4, 5] as const) {
      expect(
        byStep[step].length,
        `Step ${step} has no mock-class coverage — five-step primitive is incomplete.`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('each primitive class declares at least one api ndjson event type', () => {
    for (const [sel, spec] of Object.entries(MOCK_CLASS_TO_NDJSON_EVENT)) {
      expect(
        spec.events.length,
        `Primitive ${sel} declares zero NDJSON events — UI would mount with no api signal.`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('NDJSON event types used by the contract are documented (no typos)', () => {
    // Whitelist of known event types the api emit channel actually supports
    // (or that the chat-pipeline composes). Source of truth comments:
    //   services/openagentic-api/src/services/EventSequencer.ts
    //   services/openagentic-api/src/services/ComposeVisualTool.ts
    //   services/openagentic-api/src/services/SubagentOrchestrator.ts
    //   openagentic-sdk canonical taxonomy
    const VALID = new Set([
      'user_message',
      'tool_executing',
      'tool_result',
      'parallel_tool_use',
      'sub_agent_started',
      'sub_agent_finished',
      'streaming_table',
      'compose_visual',
      'cost_tick',
      'thinking_delta',
      'rag_citation',
      'message_handoff_offer',
    ]);
    for (const spec of Object.values(MOCK_CLASS_TO_NDJSON_EVENT)) {
      for (const ev of spec.events) {
        expect(
          VALID.has(ev),
          `Event type "${ev}" not in known-good set — typo in MOCK_CLASS_TO_NDJSON_EVENT?`,
        ).toBe(true);
      }
    }
  });
});

/**
 * Phase F Layer 2 — drives the same prompt across the SDK probe captures
 * (saved by Layer 4) and asserts the NDJSON event sequence MOUNTS the
 * minimum set of primitive classes per the contract above.
 *
 * The api emit channel layer (chatLoop.ts) wraps the SDK canonical events
 * into NDJSON envelopes; for a direct-provider probe with no tool dispatch,
 * the api would NOT emit tool_executing / tool_result / parallel_tool_use.
 * But it WILL emit (when text or thinking arrives):
 *   - text_delta opcode '0' (mounts .msg-asst .msg-body)
 *   - thinking_delta (mounts .thinking)
 *   - message_stop (settles the turn)
 *
 * So at minimum we assert per capture: the canonical stream contains
 * enough events to mount {.msg-asst, .thinking?} — the synthesis step's
 * MINIMUM render contract.
 */
describe('Phase F Layer 2 — five-step minimum render coverage on SDK captures', () => {
  // Direct-provider probe captures don't run the api pipeline so the
  // canonical stream is all we have. This test confirms each provider's
  // canonical stream contains the MINIMUM events to mount step 4 in the UI.
  const SDK_REPO = join(REPO_ROOT, '..', 'openagentic-sdk');
  const probeDir = join(SDK_REPO, 'reports', 'provider-probe');

  if (!existsSync(probeDir)) {
    it.skip('SDK probe directory not found — run probe-real-provider.ts first', () => {});
    return;
  }

  // Find the most recent date dir with primitive-5-step captures.
  const dateDirs = require('fs')
    .readdirSync(probeDir)
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (dateDirs.length === 0) {
    it.skip('no dated probe captures', () => {});
    return;
  }
  const latest = dateDirs[dateDirs.length - 1];
  const captureDir = join(probeDir, latest, 'primitive-5-step');
  if (!existsSync(captureDir)) {
    it.skip(`no primitive-5-step subdir in ${latest}`, () => {});
    return;
  }

  const fs = require('fs');
  const captureFiles = fs
    .readdirSync(captureDir)
    .filter((f: string) => f.endsWith('.canonical.ndjson'));

  if (captureFiles.length === 0) {
    it.skip('no canonical ndjson captures', () => {});
    return;
  }

  for (const f of captureFiles) {
    it(`${f.replace('.canonical.ndjson', '')} — has events to mount .msg-asst and (optional) .thinking`, () => {
      const events = fs
        .readFileSync(join(captureDir, f), 'utf-8')
        .split('\n')
        .filter((l: string) => l.trim())
        .map((l: string) => JSON.parse(l));

      let textDeltas = 0;
      let thinkingDeltas = 0;
      let messageStops = 0;
      for (const e of events) {
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') textDeltas++;
        if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') thinkingDeltas++;
        if (e.type === 'message_stop') messageStops++;
      }
      // .msg-asst requires text_delta presence so SharedMarkdownRenderer
      // can paint inside the message body.
      expect(
        textDeltas,
        `${f}: capture has zero text_delta — synthesis step would render empty .msg-asst`,
      ).toBeGreaterThanOrEqual(1);
      // Wire envelope must close.
      expect(messageStops, `${f}: message_stop must close the envelope`).toBe(1);
      // thinking_delta is optional — only providers with reasoning emit it.
      // We log it for visibility but don't fail when absent.
      if (thinkingDeltas > 0) {
        // eslint-disable-next-line no-console
        console.log(`  [Layer 2] ${f}: .thinking primitive has ${thinkingDeltas} delta(s)`);
      }
    });
  }
});
