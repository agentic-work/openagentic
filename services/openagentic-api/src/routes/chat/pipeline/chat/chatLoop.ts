/**
 * V3 chat loop — thin Claude-Code-style ReAct.
 *
 * One streaming provider call per iteration. Collect tool_use blocks,
 * partition into read-only-parallel and write-serial batches, dispatch,
 * append tool_results to message history, repeat until end_turn.
 *
 * Mirrors /home/trent/anthropic/src/query.ts:241 with chatmode-specific
 * NDJSON envelope (Vercel opcode format) layered on top.
 *
 * Plan: /home/trent/.claude/plans/sprightly-percolating-brook.md
 */
import type {
  ChatLoopInput,
  ChatLoopDeps,
  ChatLoopResult,
  ContentBlock,
  RunCtx,
  StopReason,
  ToolUseBlock,
} from './types.js';
import { partitionToolCalls, runConcurrent, runSerial } from './toolOrchestration.js';
import {
  buildAssistantMessageDelta,
  buildAssistantMessageStop,
  buildContentBlockDelta,
  buildToolExecuting,
  buildToolResult,
} from './builders.js';
import { buildFollowUp } from '../../../../lib/agentic-sdk/agentic-events/index.js';
import { findUnknownToolCallError, buildOfferedToolNames } from './unknownToolGuard.js';
// Phase A.4 — server-side tool_choice forcing on artifact verbs.
// #947 — user-intent + conceptual-template helpers for the anti-bias gate.
import {
  detectArtifactVerb,
  detectArtifactSequence,
  userMessageHasExplicitArtifactVerb,
  isConceptualTemplate,
  type ArtifactSequenceStep,
} from './artifactVerbDetector.js';
// #946 — server-side rescue for inline compose_app/compose_visual XML.
// Phase A enforcement gets dispatch right MOST of the time, but Sonnet 4.6
// still occasionally emits JSX-style `<compose_visual ... data={{...}} />`
// inline. Without this rescue, the raw tag bleeds into the assistant body
// and no iframe mounts. Rescue converts the matched XML into a synthetic
// tool_use ContentBlock + strips the source range from the text block, so
// the persisted message and UI reload render correctly.
import { parseInlineComposePatterns } from './parseInlineComposePatterns.js';
import { stripFreestyleHtml } from './stripFreestyleHtml.js';
// Phase 12 — V3MetricsRegistry singleton for per-turn observability.
// Instrumented seams in chatLoop (vs runChat which covers whole-turn):
//   - tool dispatches (count + duration + outcome ok|error)
//   - hook invocations (count + duration + ok|fail outcome) including
//     the `before_tool_call` block path (reason='dlp'|'hitl'|other)
//   - mid-loop compaction trigger + tokens freed
//   - envelope-overflow advisory counter when an envelope's
//     structuredContent fits but ui_meta indicates the splitter triggered
//   - sub-agent metrics are emitted from the openagentic-proxy boundary (see
//     runChat.ts subagent dispatch wrapper) — chatLoop just dispatches
//     by name through deps.dispatch.
import { v3Metrics, safeIncCounter, safeObserveHistogram } from '../../../../services/V3MetricsRegistry.js';

// NO HARDCODED DEFAULT — admin-tunable via ChatLoopConfigService
// (SoT: `admin.system_configuration` row keyed `chat_loop`, surfaced
// at /admin#chat-loop). The caller (stream.handler.ts) MUST resolve
// the value before invoking chatLoop. Pinned by:
//   - src/routes/chat/pipeline/chat/__tests__/chatLoop.maxTurnsRequired.test.ts
//   - src/__tests__/architecture/no-hardcoded-max-turns.source-regression.test.ts
// Why: 2026-05-11 multi-cloud capstone Sev-1 — gpt-5.4 hit the prior
// hardcoded 12-cap during 32-tool cascade fanout; the cap belongs to
// the operator, not source code.

/**
 * Q1-fix-2 (2026-05-12) — pull the most recent user-turn text out of the
 * canonical chatLoop `messages` array. Forwarded to executeToolSearch as
 * `ctx.userPromptHint`; the /api/internal/tool-search route then unions
 * cloud-detection across both the model's narrowed query and the user's
 * original intent. Without it, tri-cloud prompts ("cost spikes across
 * Azure/AWS/GCP") would still resolve to azure-only top-K when the model
 * narrows to "Azure cost query tool".
 *
 * Robust to two content shapes:
 *   - string content: `messages[i].content = "..."`
 *   - canonical content blocks: `messages[i].content = [{type:'text', text:'...'}, ...]`
 *
 * Returns empty string when there is no user message (e.g. ablation
 * harness with system+priorMessages-only).
 */
export function extractLatestUserText(
  messages: ReadonlyArray<{ role: string; content: unknown }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const part of c as Array<{ type?: string; text?: string }>) {
        if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          parts.push(part.text);
        }
      }
      if (parts.length > 0) return parts.join('\n');
    }
    // Fall through and keep searching earlier turns if this one had no
    // extractable text (e.g. tool_result blocks only).
  }
  return '';
}

/**
 * Sev-0 F1-6 (2026-05-17) — generate the 3 follow-up chip strings rendered
 * in the `.followups` row at the end of every assistant turn. Reuses the
 * SAME chatmode model + streamProvider as the main loop (no hardcoded model
 * id — CLAUDE.md rule 7). On any failure path (provider throws, malformed
 * JSON, wrong shape) returns `[]` so the UI degrades to a blank slot rather
 * than crashing the turn. Caller emits the `follow_up` frame regardless.
 *
 * Bounded: clamps to the first 3 strings, drops empty/non-string entries,
 * trims and 80-char-truncates each so a runaway model can't shovel
 * paragraphs into the chip row.
 */
async function generateFollowUpChips(
  streamProvider: ChatLoopDeps['streamProvider'],
  model: string,
  finalAssistantText: string,
  userText: string,
  logger: RunCtx['logger'],
): Promise<string[]> {
  const trimmedFinal = finalAssistantText.trim();
  // No prose to follow-up on (tool-only turn / empty synthesis) — skip the
  // model call entirely; the UI renders no chips.
  if (trimmedFinal.length === 0) return [];

  const sys =
    'You write 3 short follow-up prompts a user would naturally ask AFTER ' +
    'reading the assistant turn below. Each prompt is a single short imperative ' +
    'phrase (under 60 chars). Reply with ONLY a JSON array of exactly 3 strings ' +
    'and nothing else. No markdown fences, no prose.';
  const userMsg =
    `User asked: ${userText.slice(0, 500)}\n\n` +
    `Assistant answered:\n${trimmedFinal.slice(0, 2000)}\n\n` +
    'Output JSON array of 3 short follow-up prompts now.';

  let buf = '';
  try {
    const iter = streamProvider({
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
      tools: [],
      tool_choice: 'none',
      model,
      cacheBreakpoint: 'never',
    });
    for await (const ev of iter) {
      if (ev.type === 'text_delta' && typeof ev.text === 'string') {
        buf += ev.text;
      }
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error)?.message, model },
      '[chat] follow-up chip generation streamProvider threw — emitting []',
    );
    return [];
  }

  // Strip optional ```json``` fences if the model returned them anyway.
  const stripped = buf
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    logger.debug(
      { model, preview: stripped.slice(0, 120) },
      '[chat] follow-up chip generation produced non-JSON output — emitting []',
    );
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, 80);
    if (t.length === 0) continue;
    out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Sev-0 #871 (2026-05-17) — anti-bias gate helper.
 *
 * Detect whether `value` contains any numeric grounding data. Used by the
 * chatLoop anti-bias gate to decide whether the model has earned the
 * right to emit a compose_visual / compose_app artifact this turn.
 *
 * Semantics:
 *   - `typeof 'number'` at any depth → true.
 *   - Arrays / objects recursed (bounded depth = 8 to avoid pathological
 *     deeply-nested payloads).
 *   - `NaN` / `Infinity` count as numeric grounding (still real tool
 *     data even if degenerate).
 */
export function hasNumericGroundingDeep(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'number') return true;
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (hasNumericGroundingDeep(v, depth + 1)) return true;
    }
    return false;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (hasNumericGroundingDeep(v, depth + 1)) return true;
  }
  return false;
}

/**
 * Return true when the given string content has substantive content
 * that qualifies as real tool grounding data (not just an empty or error stub).
 *
 * A tool_result is grounding data when it:
 *   - Has numeric values anywhere (cost / latency / count / percentage), OR
 *   - Is a non-empty, non-error JSON object/array with meaningful string fields
 *     (e.g. GCP Cloud Run list response: [{name, uri, status, region, ...}]).
 *
 * String-only tool_results (GCP resource lists, k8s pod names, etc.) count as
 * real grounding — they represent actual fetched cloud data that the model should
 * be allowed to visualize. The numeric-only guard was too strict for resource-list
 * queries that return structured string data without dollar amounts.
 *
 * Minimum content threshold: JSON-parsed content must be either:
 *   - An array with at least 1 element, OR
 *   - An object with at least 1 key whose value is a non-trivial string (> 4 chars)
 */
function hasSubstantiveContent(trContent: unknown): boolean {
  if (hasNumericGroundingDeep(trContent)) return true;
  if (typeof trContent === 'string' && trContent.trim().length > 4) {
    // Non-empty string tool_result — try JSON parse for richer check.
    try {
      const parsed = JSON.parse(trContent);
      return hasSubstantiveContent(parsed);
    } catch {
      // Raw string with meaningful content (e.g. a list of resource IDs).
      return trContent.trim().length > 20;
    }
  }
  if (Array.isArray(trContent)) {
    // Any non-empty array with at least one non-trivial item is grounding.
    return trContent.length > 0 && trContent.some((v) => v !== null && v !== undefined);
  }
  if (trContent !== null && typeof trContent === 'object') {
    const keys = Object.keys(trContent as Record<string, unknown>);
    if (keys.length === 0) return false;
    // Has at least one string value longer than a trivial label (> 4 chars).
    return keys.some((k) => {
      const v = (trContent as Record<string, unknown>)[k];
      return (typeof v === 'string' && v.trim().length > 4) ||
             (Array.isArray(v) && v.length > 0) ||
             (typeof v === 'number' && isFinite(v));
    });
  }
  return false;
}

/**
 * Scan the conversation `messages` array for any tool_result content that
 * contains substantive grounding data. Returns true on the first hit. Used
 * by the compose_visual / compose_app anti-bias gate.
 *
 * Accepts both shapes the loop produces:
 *   - role:'tool', content: Array<{tool_use_id, content, is_error?}>
 *   - role:'tool', content: string (legacy)
 *   - role:'assistant', content: Array<ContentBlock>  (NOT scanned —
 *     model-generated text, not tool grounding)
 *
 * Sev-0 #871 fix scope: a single hit anywhere in conversation history
 * unlocks compose_visual / compose_app for this turn. This supports:
 *   - Multi-turn cost-audit flow (Turn 1 fetches, Turn 2 charts from Turn-1 grounding)
 *   - String-only resource lists (GCP Cloud Run, k8s pods, Azure RGs) — these are
 *     real cloud data even without numeric values. Models use them to compose dashboards.
 *
 * Error tool_results are excluded (is_error: true) — they are not grounding data.
 */
export function conversationHasNumericGrounding(
  messages: ReadonlyArray<{ role: string; content: unknown }>,
): boolean {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const c = m.content;
    if (typeof c === 'string') {
      // Legacy string shape — check for substantive content.
      if (hasSubstantiveContent(c)) return true;
      continue;
    }
    if (Array.isArray(c)) {
      for (const tr of c) {
        if (!tr || typeof tr !== 'object') continue;
        const toolResult = tr as { content?: unknown; is_error?: unknown };
        // Skip error results — they are not grounding data.
        if (toolResult.is_error === true) continue;
        if (hasSubstantiveContent(toolResult.content)) return true;
      }
      continue;
    }
    // Other shapes (object with .content / .text) — best-effort recurse.
    if (hasNumericGroundingDeep(c)) return true;
  }
  return false;
}

/**
 * Sev-0 META #826 / #983 / #899 (2026-05-21) — empty-tool-result fabrication.
 *
 * Layer 2 of the two-layer defense: when a tool result that gets fed back
 * to the model is "empty" — `null` / `undefined` / `''` / `{}` / `[]` /
 * errored / wrapper-with-empty-rows-items-data — augment the model-facing
 * content with a SYSTEM NOTE prefix so the model has an unambiguous,
 * in-band signal that it MUST acknowledge the gap and refuse to fabricate.
 *
 * Companion layer 1 = the empty-tool-result clause in
 * getGroundingDisciplineSection (services/prompt/staticSections.ts).
 *
 * The SYSTEM NOTE is server-side; it never reaches the user's UI because
 * the user sees the original `uiContent` via the `tool_result` NDJSON
 * frame emitted upstream of this augmentation. Only the
 * model-conversation channel (toolResults array → messages.push) is
 * augmented.
 *
 * "Empty" criteria — any of:
 *   - content === null
 *   - content === undefined
 *   - content === ''
 *   - content is {} (zero own keys)
 *   - content is []
 *   - isError === true
 *   - content.error !== undefined AND content.success !== true
 *   - content.rows / .items / .data is [] (any empty list wrapper)
 */
export const EMPTY_TOOL_RESULT_SYSTEM_NOTE =
  '[SYSTEM NOTE: This tool returned no usable data. Per your instructions you MUST acknowledge this gap explicitly and refuse to fabricate substitute claims.]';

export function isEmptyToolResultContent(content: unknown, isError: boolean): boolean {
  if (isError === true) return true;
  if (content === null || content === undefined) return true;
  if (content === '') return true;
  if (Array.isArray(content)) return content.length === 0;
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return true;
    // Error sentinel: { error: ..., success: !== true }
    if (obj.error !== undefined && obj.success !== true) return true;
    // Empty list wrappers — common shapes from list-style tools.
    for (const wrapperKey of ['rows', 'items', 'data'] as const) {
      const v = obj[wrapperKey];
      if (Array.isArray(v) && v.length === 0) return true;
    }
    return false;
  }
  // Non-empty primitives (numbers, booleans, non-empty strings) are NOT empty.
  return false;
}

/**
 * Prepend the EMPTY_TOOL_RESULT_SYSTEM_NOTE to model-facing tool_result
 * content. Keeps the original payload alongside so the model still has
 * whatever signal IS there (an error message, an empty-shape hint, etc.).
 *
 * For string content: returns `${NOTE}\n\n${original}` (or just NOTE if empty).
 * For object/array content: returns `${NOTE}\n\nOriginal payload: ${JSON}`.
 *
 * Idempotent — if the content already starts with the prefix, returns it unchanged.
 */
export function withEmptyToolResultGuard(content: unknown): string {
  // Idempotency: if a wrapping layer (e.g. retry path) already injected the
  // SYSTEM NOTE prefix, do not double-prepend.
  if (typeof content === 'string' && content.startsWith(EMPTY_TOOL_RESULT_SYSTEM_NOTE)) {
    return content;
  }
  if (content === null || content === undefined || content === '') {
    return EMPTY_TOOL_RESULT_SYSTEM_NOTE;
  }
  if (typeof content === 'string') {
    return `${EMPTY_TOOL_RESULT_SYSTEM_NOTE}\n\n${content}`;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(content);
  } catch {
    serialized = String(content);
  }
  return `${EMPTY_TOOL_RESULT_SYSTEM_NOTE}\n\nOriginal payload: ${serialized}`;
}

/**
 * Sev-0 META #1105 (2026-05-24) — empty-result fabrication guard
 * (separate system message injection layer).
 *
 * Live evidence (2026-05-24): model dispatched `memory_search`, tool
 * returned `[]`, model fabricated a full table of fake compute-prod /
 * data-warehouse / ml-training dollar values to fill the void. User
 * caught it. Latest in a Sev-0 META pattern (#826, #878, #883, #887,
 * #899, #1009, #1017).
 *
 * Layer 3 of the empty-result defense (companion to Layer 1
 * static-prompt clause + Layer 2 SYSTEM-NOTE prefix on tool_result
 * content). Adds a SEPARATE `{role:'system', content: ...}` message
 * pushed into `messages[]` AFTER the `role:'tool'` message, so the
 * model sees an unambiguous in-band directive on its next turn:
 *
 *   "⚠️ The previous tool call returned no data (empty result). Do
 *    NOT invent or fabricate values to fill this absence. Either:
 *    (a) state honestly that the tool returned no results, OR (b)
 *    call request_clarification to ask the user for the correct
 *    scope/parameters. Reporting "no data" is a CORRECT and
 *    EXPECTED behavior — fabrication is a failure."
 *
 * The wider detection heuristic catches shapes the layer-2
 * `isEmptyToolResultContent` does NOT (by design — that one is
 * surgical on the tool_result body):
 *   - `{count: 0}` (no rows/items/data wrapper)
 *   - `{results: []}` (different wrapper key)
 *   - MCP envelope `{content: [{text: '<json>'}]}` where the
 *     parsed `text` matches any of the empty shapes
 */
export const EMPTY_RESULT_GUARD_SYSTEM_MESSAGE =
  '⚠️ The previous tool call returned no data (empty result). Do NOT invent or fabricate values to fill this absence. Either: (a) state honestly that the tool returned no results, OR (b) call request_clarification to ask the user for the correct scope/parameters. Reporting "no data" is a CORRECT and EXPECTED behavior — fabrication is a failure.';

/**
 * #1105 — wider empty-result detection used by the separate-system-message
 * injection layer. Catches the shapes `isEmptyToolResultContent` skips
 * plus unwraps MCP envelopes whose `.content[0].text` is a JSON string
 * matching an empty shape.
 *
 * Returns true for ANY of:
 *   - all the shapes `isEmptyToolResultContent` flags (delegated), PLUS
 *   - `{count: 0}` standalone
 *   - `{results: []}` (wrapper key besides rows/items/data)
 *   - `{rows:[], count: 0}` (already true via rows:[], but pinned)
 *   - MCP envelope `{content: [{text: '<JSON>'}]}` where the parsed
 *     JSON matches any empty shape above
 */
export function isEmptyForFabricationGuard(content: unknown, isError = false): boolean {
  // Delegate the core empty shapes to the existing helper.
  if (isEmptyToolResultContent(content, isError)) return true;

  // Recognize the layer-2 SYSTEM NOTE prefix — when layer-2 has already
  // wrapped an empty payload, the string starts with the prefix. We
  // treat that as "still empty" so layer-3 can add its separate system
  // message even though the string itself is substantive in isolation.
  if (typeof content === 'string' && content.startsWith(EMPTY_TOOL_RESULT_SYSTEM_NOTE)) {
    return true;
  }

  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;

    // {count: 0} — even without a rows/items/data wrapper, count:0 is the
    // canonical "zero hits" signal from search/list APIs.
    if (typeof obj.count === 'number' && obj.count === 0) return true;

    // {results: []} — wrapper key besides rows/items/data.
    if (Array.isArray(obj.results) && obj.results.length === 0) return true;

    // MCP envelope unwrap: { content: [{ type?:'text', text: '<JSON>' }, ...] }
    // The python-MCP family (openagentic-*) returns this shape verbatim. The model
    // sees the text payload; we must look through it to detect emptiness.
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const first = obj.content[0] as { text?: unknown } | null | undefined;
      if (first && typeof first === 'object' && typeof first.text === 'string') {
        const trimmed = first.text.trim();
        // Empty text payload directly.
        if (trimmed === '' || trimmed === '[]' || trimmed === '{}' || trimmed === 'null') {
          return true;
        }
        // JSON-parse the text and recurse — depth-limited to one level so
        // we don't pathologically chase nested envelopes.
        try {
          const parsed = JSON.parse(trimmed);
          if (isEmptyToolResultContent(parsed, false)) return true;
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const p = parsed as Record<string, unknown>;
            if (typeof p.count === 'number' && p.count === 0) return true;
            if (Array.isArray(p.results) && p.results.length === 0) return true;
          }
        } catch {
          // Non-JSON text payload — leave to layer 2.
        }
      }
    }
  }

  return false;
}

/**
 * #1020 task-attention guard (Q17 empirical, 2026-05-21).
 *
 * Q14 vs Q17 evidence: same kube-system 33-pod inventory prompt, same model
 * (gpt-oss:20b), same thinking budget (~910 tok). Q14 (no priming) cascade-
 * failed — repeat tool call, hallucinated next-user-prompt ("List AKS
 * clusters"), empty synthesis. Q17 (PRIMED with "think carefully about JSON
 * structure") cleanly succeeded — 33 pods verbatim, exact count, no drift.
 *
 * Diagnosis: task-attention loss on large JSON tool results — the model can
 * get distracted mid-synthesis and either re-call the same tool, hallucinate
 * a follow-up turn, or emit empty body. Priming the instruction keeps focus
 * on the parse target.
 *
 * Fix: when a tool result exceeds LARGE_TOOL_RESULT_THRESHOLD_BYTES (8KB by
 * default, env-overridable), prepend a SYSTEM NOTE that directs the model
 * to parse for the user-requested fields ONLY, refuse re-fetch, refuse
 * follow-up hallucination. Mitigates #1015 / #1016 / #1017 stochastic class.
 *
 * The threshold is env-overridable via LARGE_TOOL_RESULT_THRESHOLD_BYTES.
 * Q14 kube-system result was ~12KB; 8KB default catches it with headroom.
 */
export const LARGE_TOOL_RESULT_SYSTEM_NOTE =
  '[SYSTEM NOTE: This tool returned a large result. Parse it for the user-requested fields ONLY. Do NOT call this tool (or any other) to re-fetch the same data. Do NOT invent follow-up user prompts. Synthesize a clear, focused answer from the data already present in this result.]';

function getLargeToolResultThresholdBytes(): number {
  const raw = process.env.LARGE_TOOL_RESULT_THRESHOLD_BYTES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 8 * 1024;
}

function approximateContentBytes(content: unknown): number {
  if (content === null || content === undefined) return 0;
  if (typeof content === 'string') return content.length;
  try {
    return JSON.stringify(content).length;
  } catch {
    return String(content).length;
  }
}

export function isLargeToolResultContent(content: unknown): boolean {
  return approximateContentBytes(content) > getLargeToolResultThresholdBytes();
}

export function withLargeToolResultGuard(content: unknown): string | unknown {
  if (
    typeof content === 'string' &&
    content.startsWith(LARGE_TOOL_RESULT_SYSTEM_NOTE)
  ) {
    return content;
  }
  if (typeof content === 'string') {
    return `${LARGE_TOOL_RESULT_SYSTEM_NOTE}\n\n${content}`;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(content);
  } catch {
    serialized = String(content);
  }
  return `${LARGE_TOOL_RESULT_SYSTEM_NOTE}\n\n${serialized}`;
}

/**
 * Sev-0 #871 (2026-05-17) — names of the composition meta-tools that
 * the anti-bias gate protects. Centralized so future compose_* tools
 * (compose_dashboard, compose_card, etc.) can be added in one place.
 */
const ANTI_BIAS_GATED_COMPOSE_TOOLS = new Set(['compose_visual', 'compose_app']);

/**
 * #946 — convert inline `<compose_visual …>` / `<compose_app …>` XML in text
 * blocks into synthetic tool_use ContentBlocks. Mutates `blocks` in place.
 *
 * Phase A.5 ripped the chatLoop call-site for the same parser; this is the
 * minimal re-wire after the regression. Without it, the persisted message
 * body contains the raw XML text and no iframe ever mounts on reload.
 *
 * Live evidence (user 2026-05-19): Sonnet 4.6 emitted
 *   `<compose_visual caption="…" template="bar_chart" data={{ "x":[…], "y":[…] }} />`
 * verbatim in the assistant body. The text leaked, no chart rendered.
 *
 * Strategy: for each text block, run parseInlineComposePatterns. For every
 * match, append a synthetic tool_use block (id = `inline-compose-<n>` so the
 * UI key is stable). Then rebuild the text without the matched ranges. The
 * stripped text is set back on the block. Empty text blocks are removed.
 */
function rescueInlineComposePatterns(
  blocks: ContentBlock[],
  ctx: RunCtx,
): void {
  let synthCounter = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type !== 'text' || typeof b.text !== 'string' || !b.text) continue;
    const matches = parseInlineComposePatterns(b.text);
    if (matches.length === 0) continue;

    // Build stripped text: keep everything outside the matched ranges.
    let stripped = '';
    let cursor = 0;
    for (const m of matches) {
      stripped += b.text.substring(cursor, m.start);
      cursor = m.end;
    }
    stripped += b.text.substring(cursor);
    (b as { type: 'text'; text: string }).text = stripped.trim();

    // Append a synthetic tool_use block for each match. The id is stable +
    // unique within the turn so the UI keys remain consistent across re-renders.
    for (const m of matches) {
      synthCounter += 1;
      const synthId = `inline-compose-rescue-${synthCounter}-${Date.now()}`;
      blocks.push({
        type: 'tool_use',
        id: synthId,
        name: m.toolName,
        input: m.params,
      });
      ctx.logger?.warn?.(
        {
          toolName: m.toolName,
          template: m.template,
          synthId,
        },
        '[chat] rescued inline compose XML → synthetic tool_use (#946)',
      );
    }
  }
  // Remove text blocks that are now empty after stripping.
  for (let bi = blocks.length - 1; bi >= 0; bi--) {
    const b = blocks[bi];
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() === '') {
      blocks.splice(bi, 1);
    }
  }
}

/**
 * #925 — freestyle HTML rescue.
 *
 * Some models emit raw `<!doctype html>...</html>` / bare `<html>` / standalone
 * `<style>` blocks inside their text response when they intended to call a UI
 * tool but missed BOTH the function-call syntax AND the inline `<compose_app>`
 * XML rescue shape. The first attempt (`stripBareHtmlPayload`, commit `3f7d9171`,
 * reverted in `52fe6712`) only deleted the bytes — the iframe never mounted.
 *
 * This round we BOTH strip and repackage: each stripped block becomes a
 * synthetic `render_artifact` tool_use ContentBlock with `kind: 'html'` so
 * the UI mounts the existing AppRenderer iframe path. Mutates `blocks` in
 * place, mirroring `rescueInlineComposePatterns` shape so call-site discipline
 * stays uniform.
 *
 * The helper at `stripFreestyleHtml.ts` is conservative — markdown code fences
 * are preserved verbatim (legitimate code examples), and the `<compose_app>`
 * rescue shape is left alone (owned by `rescueInlineComposePatterns`).
 */
function rescueFreestyleHtml(blocks: ContentBlock[], ctx: RunCtx): void {
  let synthCounter = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type !== 'text' || typeof b.text !== 'string' || !b.text) continue;
    const result = stripFreestyleHtml(b.text);
    if (result.freestylePayloads.length === 0) continue;

    (b as { type: 'text'; text: string }).text = result.stripped;

    for (const payload of result.freestylePayloads) {
      synthCounter += 1;
      const synthId = `freestyle-html-rescue-${synthCounter}-${Date.now()}`;
      blocks.push({
        type: 'tool_use',
        id: synthId,
        name: 'render_artifact',
        input: {
          kind: payload.kind,
          content: payload.content,
          title: 'Freestyle artifact (auto-rescued)',
          group_id: synthId,
        },
      });
      ctx.logger?.warn?.(
        {
          contentBytes: payload.content.length,
          synthId,
        },
        '[chat] #925 repackaged freestyle HTML payload → synthetic render_artifact tool_use (model emitted raw HTML instead of dispatching a UI tool)',
      );
    }
  }
  // Remove text blocks that are now empty after stripping.
  for (let bi = blocks.length - 1; bi >= 0; bi--) {
    const b = blocks[bi];
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() === '') {
      blocks.splice(bi, 1);
    }
  }
}

export async function chatLoop(
  ctx: RunCtx,
  input: ChatLoopInput,
  deps: ChatLoopDeps,
): Promise<ChatLoopResult> {
  // Caller MUST supply a valid maxTurns. The SoT is
  // ChatLoopConfigService.getMaxTurns() (admin-editable).
  if (
    typeof input.maxTurns !== 'number' ||
    !Number.isFinite(input.maxTurns) ||
    !Number.isInteger(input.maxTurns) ||
    input.maxTurns < 1
  ) {
    throw new RangeError(
      `chatLoop: input.maxTurns is required (positive integer) — got ${String(input.maxTurns)}. ` +
        `Resolve via ChatLoopConfigService.getMaxTurns() before calling.`,
    );
  }
  const maxTurns = input.maxTurns;

  // Phase 3 — HookRunner context. Built once per chatLoop invocation;
  // every `await deps.hooks?.run(...)` / `runModifying(...)` call passes
  // it. `meta` is a per-run scratch bag the EventSequencer stores its
  // wrap state in (see built-in-hooks.ts:225 globalSequencer fallback).
  const hookCtx: any = {
    userId: ctx.userId ?? '',
    sessionId: ctx.sessionId,
    logger: ctx.logger,
    meta: {},
  };
  // If the caller pre-hydrated the user message into priorMessages (V3
  // does this so multimodal attachments survive buildUserMessageContent),
  // we receive userMessage='' and skip the append. Otherwise the
  // standard "user message + history" composition runs.
  const messages = input.userMessage
    ? [...input.priorMessages, { role: 'user' as const, content: input.userMessage }]
    : [...input.priorMessages];
  const tools: any[] = [...input.tools];
  const toolUses: string[] = [];

  // Discovery side-channel. When tool_search / agent_search dispatchers
  // return `discoveredTools` / `discoveredAgents` on the result, we append
  // them to the `tools` array so the next turn sees them. Deduped by
  // function.name to avoid re-adding tools the model already knows about.
  // Mirrors Plan §Tool Catalog Strategy — tool_search is the discovery
  // primitive that lets us keep a small base catalog (9 meta-tools) while
  // the model can pull
  // in the right MCPs on demand without paying the 81k-token cost of
  // shipping the full 270-tool catalog every turn.
  const discoveredNames = new Set<string>();
  for (const t of tools) {
    const n = t?.function?.name;
    if (typeof n === 'string') discoveredNames.add(n);
  }
  const acceptDiscovered = (defs: ReadonlyArray<any> | undefined) => {
    if (!defs || defs.length === 0) return;
    for (const def of defs) {
      const name = def?.function?.name;
      if (typeof name !== 'string' || discoveredNames.has(name)) continue;
      discoveredNames.add(name);
      tools.push(def);
    }
  };

  // Synthesis fallback (port of V2 commit 6b6889b4). When end_turn arrives
  // with no text AFTER prior tool_results, force ONE more turn with a
  // system reminder. Bounded — this flag prevents infinite retries on
  // pathological models that never produce text.
  let synthesisRetried = false;

  // Phase 10 — TFC mid-loop handoff trigger. Counts CONSECUTIVE
  // `request_clarification` tool_uses across turns. Resets to 0 on any
  // turn that dispatches a non-clarification tool. When the count hits
  // the threshold (3), we fire `deps.onMidLoopHandoffTrigger` with a
  // `consecutive_clarifications` signal so the caller can ask
  // HandoffDecisionService whether the current model is below the FCA
  // floor and emit the offer. The caller owns dedup; we fire on every
  // 3rd-and-later clarification turn — `MID_LOOP_CLARIFICATION_THRESHOLD`
  // is the trigger gate, not a one-shot.
  //
  // Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §11.3
  let consecutiveClarificationCount = 0;
  const MID_LOOP_CLARIFICATION_THRESHOLD = 3;

  // Tool-choice override flag — the synthesis-retry turn (set when the
  // bounded-fallback block fires below) must run with tool_choice='none'.
  // The retry's contract is "the model must produce text now, no more
  // tools" — the only protocol-level guarantee for that is making the
  // provider literally unable to return a tool_use on the call. Plain
  // English in the synthesis user message ("Do not call more tools") is
  // unreliable across providers/models; tool_choice='none' is universal.
  // Pinned by chatLoop.synthesisFallback test "forces tool_choice='none'
  // on the synthesis-retry turn".
  //
  // Phase A.4 — also widened to hold the named-function shape for
  // artifact-verb forcing (detectArtifactVerb returns shouldForce + toolName).
  let nextTurnToolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } } = 'auto';

  // C3 — pre-MCP scenario-pattern detector state.
  //
  // Scenario patterns (migration plan, onboarding flow, incident triage, etc.)
  // match user intent at turn-start — no prior MCP round-trip required.
  // detectArtifactVerb is called BEFORE each model call with the accumulated
  // MCP result count from ALL prior turns of this loop. On turn 1 this is 0,
  // which is sufficient for scenario patterns (they fire without MCP data).
  //
  // Anti-loop guard: once a compose_visual / compose_app has been dispatched
  // anywhere in this loop, we stop forcing even if the user's message still
  // matches a scenario pattern. Tracked separately from the post-MCP guard.
  let mcpResultsAccumulated = 0;
  let composeDispatchedThisLoop = false;

  // #965 — multi-artifact sequence queue (Mocks 07/10/12).
  //
  // detectArtifactSequence returns ordered steps for prompts that name TWO
  // artifacts (e.g. "cost spikes + savings", "migration plan + dependency
  // graph", "permission matrix + risk score"). We queue them once at the
  // top of the loop and consume one per forced round — after each compose_*
  // dispatch lands, the next queued step replaces nextTurnToolChoice for
  // the next forced round. When the queue empties, the loop falls back to
  // the existing single-shot detectArtifactVerb behavior.
  //
  // The queue is consumed even when composeDispatchedThisLoop flips true,
  // because the whole point of a multi-step sequence is that ≥2 compose
  // dispatches are EXPECTED in a single loop.
  let artifactSequenceQueue: ArtifactSequenceStep[] = [];
  {
    const initialUserText = extractLatestUserText(messages);
    const seq = detectArtifactSequence({
      userMessage: initialUserText,
      mcpToolResultsThisTurn: 0,
    });
    if (seq.sequence.length > 0) {
      artifactSequenceQueue = seq.sequence.slice();
      ctx.logger.info(
        {
          queueLength: artifactSequenceQueue.length,
          sequence: artifactSequenceQueue,
          userTextPreview: initialUserText.slice(0, 120),
        },
        '[chat] #965 multi-artifact sequence detected; queuing forced rounds',
      );
    }
  }

  // #763 — No-progress guard. Tracks (toolName + argsHash) repeats across
  // turns so the loop can detect a model spinning on the same call (e.g.
  // azure_list_subscriptions × 15 because the result was empty / the
  // model didn't synthesize from prior tool_results). When ANY signature
  // hits the threshold, we force a synthesis turn (tool_choice='none' +
  // English directive) so the model stops looping and produces an answer
  // from what it already has. Mirrors the synthesisRetried bound but
  // keyed on tool repetition rather than empty-end_turn.
  const NO_PROGRESS_THRESHOLD = 3;
  // Bug B (2026-05-24) — artifact tools (compose_visual, compose_app,
  // render_artifact, generate_image) are NEVER usefully called more than
  // once with the same args within a single loop. Duplicate emission
  // ships a duplicate artifact to the UI. Tighten the no-progress
  // threshold to 2 (i.e. guard fires on the 2nd identical call) for
  // these tools; non-artifact tools keep the original threshold of 3.
  const ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set([
    'compose_visual',
    'compose_app',
    'render_artifact',
    'generate_image',
  ]);
  function noProgressThresholdFor(toolName: string): number {
    return ARTIFACT_TOOL_NAMES.has(toolName) ? 2 : NO_PROGRESS_THRESHOLD;
  }
  const toolCallCounts = new Map<string, number>();
  // Discovery primitives vary their args (query string) per call. Original
  // 2026-05-12 fix tracked them by NAME ONLY so repeated tool_search /
  // agent_search / kb_search loops would trip the threshold even when each
  // call varied its query. That overcorrected: Q1-fix-6 (2026-05-12) caught
  // it falsely firing on LEGITIMATE parallel fan-out (Sonnet 4.5 emitting
  // 3 distinct tool_search calls in one turn — azure/aws/gcp). The fix:
  // track BOTH the call count AND the set of distinct (sorted-JSON) arg
  // signatures per name. Only trigger if `sigs.size === 1 && count >=
  // threshold` — i.e. every call had IDENTICAL args. Distinct args =
  // legitimate fan-out, do NOT trigger.
  const DISCOVERY_PRIMITIVES = new Set([
    'tool_search',
    'agent_search',
    'kb_search',
    'memory_search',
    'pattern_recall',
  ]);
  const discoveryNameCounts = new Map<string, number>();
  const discoveryNameSigs = new Map<string, Set<string>>();
  let noProgressGuardFired = false;
  const stableArgsKey = (input: unknown): string => {
    try {
      if (input == null) return 'null';
      if (typeof input !== 'object') return String(input);
      // Object keys are sorted so {a:1,b:2} and {b:2,a:1} share a sig.
      const keys = Object.keys(input as Record<string, unknown>).sort();
      const norm: Record<string, unknown> = {};
      for (const k of keys) norm[k] = (input as Record<string, unknown>)[k];
      return JSON.stringify(norm);
    } catch {
      return '[unstringifiable]';
    }
  };

  for (let turn = 1; turn <= maxTurns; turn++) {
    // Phase 3 — `on_turn_start` (observer). Fires at the top of every
    // turn. Built-in observers (audit, telemetry) read `turn` + `model`
    // for per-turn metrics; user-registered hooks can short-circuit
    // (e.g. tenant rate-limiter) by throwing fail_closed.
    await deps.hooks?.run('on_turn_start', { turn, model: input.model, sessionId: ctx.sessionId, userId: ctx.userId }, hookCtx);

    // Phase 3 — `before_streaming` (modifying point per HOOK_KINDS, but
    // we use the unified `run()` dispatcher and discard the transformed
    // copy — chatLoop owns the message array, not the hook). DLP scans
    // the outbound LLM prompt at this seam for prompt-injection /
    // sensitive-data egress before the provider sees it.
    await deps.hooks?.run('before_streaming', { turn, model: input.model, messages }, hookCtx);

    // L5-1 (2026-05-12) — populate OBO callerContext from the chat ctx so
    // AWSBedrockProvider can exchange the user's AAD token for short-lived
    // STS credentials (assumeRoleWithAADToken → user-scoped BedrockRuntimeClient).
    // Falls through (undefined) for non-Azure-authenticated test paths;
    // streamProvider drops the field from the body when both subfields are
    // empty, so non-OBO providers (Ollama, OpenAI direct, etc.) are unaffected.
    const callerContextForObo = (ctx.userJwt || ctx.user?.email)
      ? {
          ...(ctx.userJwt ? { aadToken: ctx.userJwt } : {}),
          ...(ctx.user?.email ? { userEmail: ctx.user.email as string } : {}),
        }
      : undefined;

    // C3 — pre-turn scenario-pattern detector. Runs on EVERY iteration so
    // scenario prompts (migration/onboarding/incident/compliance) get forced
    // to compose_app / compose_visual on the FIRST model call — before any
    // MCP round-trip. The detector's Phase 2 (scenario patterns) fires with
    // mcpToolResultsThisTurn = 0; Phase 1 (explicit verbs) still requires
    // MCP >= 1 so a bare "render my costs" on turn 1 does NOT force (no data).
    //
    // Precedence: skip if nextTurnToolChoice is already non-auto (synthesis
    // retry / no-progress guard take priority), or if compose has already
    // dispatched in this loop (anti-loop).
    // #965 — multi-artifact sequence: when a queued step exists AND we
    // haven't been overridden by synthesis-retry or no-progress, consume
    // the next queued step. The queue overrides composeDispatchedThisLoop
    // (the whole point is multi-compose dispatch in one loop).
    if (
      artifactSequenceQueue.length > 0 &&
      (nextTurnToolChoice as string) === 'auto' &&
      !noProgressGuardFired
    ) {
      const step = artifactSequenceQueue.shift()!;
      ctx.logger.info(
        {
          turn,
          toolName: step.toolName,
          template: step.template,
          remainingInQueue: artifactSequenceQueue.length,
        },
        `[chat] #965 multi-artifact step — forcing ${step.toolName}${step.template ? `:${step.template}` : ''}`,
      );
      nextTurnToolChoice = {
        type: 'function',
        function: { name: step.toolName },
      };
    } else if (
      !composeDispatchedThisLoop &&
      (nextTurnToolChoice as string) === 'auto' &&
      !noProgressGuardFired
    ) {
      const preCallUserText = extractLatestUserText(messages);
      const preCallDetection = detectArtifactVerb({
        userMessage: preCallUserText,
        mcpToolResultsThisTurn: mcpResultsAccumulated,
      });
      if (preCallDetection.shouldForce && preCallDetection.toolName) {
        ctx.logger.info(
          {
            turn,
            toolName: preCallDetection.toolName,
            mcpResultsAccumulated,
            userTextPreview: preCallUserText.slice(0, 120),
          },
          `[chat] C3 pre-turn — scenario artifact verb detected; forcing turn to ${preCallDetection.toolName}`,
        );
        nextTurnToolChoice = {
          type: 'function',
          function: { name: preCallDetection.toolName },
        };
      }
    }

    const stream = deps.streamProvider({
      system: input.systemPrompt,
      messages,
      tools,
      tool_choice: nextTurnToolChoice,
      model: input.model,
      cacheBreakpoint: 'after_tools',
      ...(callerContextForObo ? { callerContext: callerContextForObo } : {}),
      // Z.ET (2026-05-19) — per-turn extended thinking toggle. Only set
      // when explicitly false to avoid overriding provider defaults on
      // turns where the UI hasn't set the flag.
      ...(input.extendedThinkingEnabled === false
        ? { extendedThinkingEnabled: false }
        : {}),
    });

    // F2 (2026-05-12) — OTel GenAI v1.37 chat span. Manual lifecycle so the
    // for-await loop below can use continue/break/throw without restructure.
    // The prom mirror (gen_ai_chat_turns_total{model=...}) increments on
    // .end() when no error was set, surfacing on /metrics for Grafana.
    const chatSpan = deps.genAITracer?.startChat({
      model: input.model,
      system: input.systemPrompt,
    });
    // Reset to default after each turn — only the synthesis-retry turn
    // wants 'none', and the fallback block re-arms it before `continue`.
    nextTurnToolChoice = 'auto';

    const contentBlocks: ContentBlock[] = [];
    let stopReason: StopReason = 'end_turn';
    // Accumulate text + tool_use input as deltas arrive; flush into
    // content blocks once we know the final shape.
    let textBuf = '';
    const toolBufs = new Map<string, { name: string; inputDelta: string }>();

    // F2-followup (2026-05-12) — streaming-chat SLO metrics. Capture
    // turn-start wall-clock + first-token marker + final usage so the
    // gen_ai_server_time_to_first_token_seconds (TTFT),
    // gen_ai_server_time_per_output_token_seconds (TPOT),
    // gen_ai_client_operation_duration_seconds, gen_ai_client_token_usage_total
    // and gen_ai_finish_reasons_total histograms populate on /metrics for
    // every streaming chat turn. Without this seam the admin LLM
    // Performance pane shows TTFT p95 / req-by-model / cache hit /
    // error % all empty (only the F2 chat_turns counter increments).
    const turnStartedAt = new Date();
    let firstTokenAt: number | undefined;
    let turnUsage:
      | { input: number; output: number; cacheRead?: number; cacheWrite?: number; reasoning?: number }
      | undefined;

    for await (const rawEvent of stream) {
      // Phase 3 — `enrich_sse_event` (modifying-style; declared 'sync' in
      // HOOK_KINDS but invoked via runModifying per spec §4.2 so the
      // EventSequencer wraps sequence numbers + DLP can drop offending
      // chunks fail-closed). The transformed event drives the switch.
      const event = (deps.hooks
        ? await deps.hooks.runModifying('enrich_sse_event', rawEvent, hookCtx)
        : rawEvent) as typeof rawEvent;
      switch (event.type) {
        case 'text_delta':
          // Legacy V2 frame name — what useChatStream actually consumes
          // today (`assistant_message_delta` reducer arm). Payload built
          // via typed builder per Spec §12.2. The dual-emit opcode-0
          // path (A1, 2026-05-12) was ripped — the UI never grew a
          // matching `case '0':` arm; bytes on the wire with no reducer.
          if (firstTokenAt === undefined) firstTokenAt = Date.now();
          ctx.emit('assistant_message_delta', buildAssistantMessageDelta({ text: event.text }));
          textBuf += event.text;
          break;
        case 'thinking_delta':
          // V2's content_block contract for thinking — UI's
          // useChatStream renders this as the live reasoning preview.
          // Payload built via typed builder per Spec §12.2. The dual-
          // emit opcode-e (A1) was ripped.
          if (firstTokenAt === undefined) firstTokenAt = Date.now();
          ctx.emit(
            'content_block_delta',
            buildContentBlockDelta({
              delta: { type: 'thinking_delta', thinking: event.text },
            }),
          );
          break;
        case 'usage':
          // F2-followup (2026-05-12) — final usage from canonical
          // message_delta.usage. Last-write-wins across the stream;
          // most providers emit a single usage on the terminal message_delta.
          turnUsage = {
            input: event.input,
            output: event.output,
            cacheRead: event.cacheRead,
            cacheWrite: event.cacheWrite,
            reasoning: event.reasoning,
          };
          break;
        case 'tool_use_start':
          toolBufs.set(event.id, { name: event.name, inputDelta: '' });
          // Tool-input streaming opcode-2 emit ripped (A1, 2026-05-12);
          // the UI consumes `tool_executing` (built once per tool block
          // BEFORE dispatch, see line below the partition step) for the
          // tool card.
          break;
        case 'tool_use_delta': {
          const buf = toolBufs.get(event.id);
          if (buf) {
            buf.inputDelta += event.inputDelta;
          }
          // Tool-input delta opcode-2 emit ripped (A1, 2026-05-12).
          break;
        }
        case 'tool_use_complete': {
          // F1-4 (2026-05-12 audit): reject truncated_tool_use input.
          // If the stream cut mid-tool_use, `event.input` may be
          // undefined / null / non-object — pushing the contentBlock
          // anyway would let downstream dispatch fail with an opaque
          // TypeError ("Cannot read properties of undefined"). Log +
          // skip the block so the model sees a clean error on the next
          // turn. Opcode-e annotation emit ripped (A1) — UI doesn't
          // consume it; log seam is the audit trail.
          if (event.input == null || typeof event.input !== 'object') {
            ctx.logger.warn(
              { toolUseId: event.id, name: event.name, inputType: typeof event.input },
              '[chat] truncated_tool_use — invalid tool_use input is not an object; skipping block',
            );
            break;
          }
          contentBlocks.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          });
          // Sev-1 L3-4 / Audit F0-5: terminal frame so the UI tool-card
          // spinner can flip from "model building input" to "queued for
          // dispatch." Without this emit, if dispatch crashes between
          // tool_use_complete and tool_result, the spinner orbits forever.
          // Opcode-2 dual-emit ripped (A1).
          ctx.emit('tool_call_complete', {
            id: event.id,
            name: event.name,
            input: event.input,
          });
          break;
        }
        case 'message_stop':
          stopReason = event.stop_reason;
          break;
      }
    }

    // F2 (2026-05-12) — close chat span when stream completes naturally.
    // Usage threads through from the canonical `usage` StreamEvent
    // (yielded by streamProvider from message_delta.usage). When the
    // provider doesn't surface usage mid-stream (rare; some self-hosted
    // Ollama paths), input/output stay zero — chat_turns still increments.
    chatSpan?.recordUsage({
      input: turnUsage?.input ?? 0,
      output: turnUsage?.output ?? 0,
      cacheRead: turnUsage?.cacheRead,
      cacheWrite: turnUsage?.cacheWrite,
    });
    // v1.37 gen_ai.response.finish_reasons — emit the per-turn stopReason as
    // a single-element array (spec models it as `string[]` to allow multi-choice
    // responses; chatmode is always single-choice).
    chatSpan?.end(undefined, { finishReasons: [stopReason] });

    // F2-followup (2026-05-12) — populate the streaming-chat SLO
    // histograms (TTFT/TPOT/operation_duration/token_usage/finish_reasons)
    // + the LLMRequestLog fact-table row. Fire-and-forget — never let
    // a metrics emit fail a chat turn. Provider type derivation happens
    // in the buildChatV2Deps adapter (uses
    // ProviderManager.getProviderForModel(model).type).
    if (deps.recordCompletionMetrics) {
      try {
        const ttftMs =
          firstTokenAt !== undefined ? firstTokenAt - turnStartedAt.getTime() : undefined;
        const maybe = deps.recordCompletionMetrics({
          model: input.model,
          providerType: 'unknown',
          startedAt: turnStartedAt,
          timeToFirstTokenMs: ttftMs,
          usage: turnUsage,
          stopReason,
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          messageId: (ctx as { messageId?: string }).messageId,
        });
        if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
          (maybe as Promise<unknown>).catch((err: unknown) => {
            (ctx.logger as { debug?: (...args: unknown[]) => void } | undefined)?.debug?.(
              { err },
              '[chat] recordCompletionMetrics failed (non-fatal)',
            );
          });
        }
      } catch (err) {
        (ctx.logger as { debug?: (...args: unknown[]) => void } | undefined)?.debug?.(
          { err },
          '[chat] recordCompletionMetrics threw (non-fatal)',
        );
      }
    }

    // Flush accumulated text into a single content block if we got any.
    if (textBuf.length > 0) {
      contentBlocks.push({ type: 'text', text: textBuf });
    }
    // Flush any tool_use buffers that didn't get a tool_use_complete event.
    for (const [id, buf] of toolBufs) {
      const exists = contentBlocks.some(b => b.type === 'tool_use' && (b as ToolUseBlock).id === id);
      if (!exists) {
        let parsed: unknown;
        try {
          parsed = buf.inputDelta ? JSON.parse(buf.inputDelta) : {};
        } catch {
          parsed = { _raw: buf.inputDelta };
        }
        contentBlocks.push({ type: 'tool_use', id, name: buf.name, input: parsed });
      }
    }

    // #946 — rescue inline compose_app/compose_visual XML in text blocks.
    // Phase A enforcement (input_examples + strict + tool_choice forcing)
    // gets dispatch right most of the time, but Sonnet 4.6 still emits
    // JSX `<compose_visual ... data={{...}} />` inline in some turns.
    // Convert each matched XML span to a synthetic tool_use ContentBlock
    // and strip the span from the text. Without this, the persisted
    // message body contains raw XML and no iframe ever mounts.
    rescueInlineComposePatterns(contentBlocks, ctx);

    // #925 — rescue freestyle HTML / CSS leaks in text blocks. Some
    // models emit raw `<!doctype html>...</html>` or standalone `<style>`
    // blocks when they intended a UI tool but missed BOTH function-call
    // syntax AND the inline compose_app XML rescue shape above. Strip
    // those bytes and repackage each as a synthetic render_artifact
    // tool_use with kind:'html' so the UI mounts the existing
    // AppRenderer iframe path. Markdown code fences are preserved
    // verbatim.
    rescueFreestyleHtml(contentBlocks, ctx);

    messages.push({ role: 'assistant', content: contentBlocks });

    if (stopReason === 'end_turn') {
      // Synthesis fallback: empty end_turn after tool_results → force one
      // more turn with a system reminder. Mirrors V2 6b6889b4.
      const hadTextThisTurn = contentBlocks.some(
        b =>
          (b.type === 'text' && b.text.trim().length > 0) ||
          (b.type === 'thinking' && (b as any).thinking?.trim().length > 0),
      );
      const priorToolResults = messages.some(m => m.role === 'tool');
      if (!hadTextThisTurn && priorToolResults && !synthesisRetried) {
        synthesisRetried = true;
        // Force tool_choice='none' on the retry — see comment at loop
        // top. This is the only protocol-level guarantee that the model
        // produces text on this turn (the English directive in the user
        // message below is necessary but not sufficient on its own).
        nextTurnToolChoice = 'none';
        ctx.logger.info(
          { turn, model: input.model },
          '[chat] empty end_turn after tool_results — forcing one synthesis turn (tool_choice=none)',
        );
        messages.push({
          role: 'user',
          content:
            'You returned no answer after running tools. Tool results are above. Provide a clear, concise answer using only that data. Do not call more tools.',
        });
        continue;
      }
      // Sev-0 F1-6 (2026-05-17) — emit `follow_up` chip row BEFORE
      // assistant_message_stop. All 17 northstar mocks
      // (`mocks/UX/AI/Chatmode/end-state-{01..17}.html`) render a
      // `.followups` row with 3 chips immediately after final synthesis.
      // Without this emit chatmode cannot match the mock. Reuses same
      // model + streamProvider — no hardcoded model id (CLAUDE.md rule 7).
      // Position invariant (CLAUDE.md rule 8a): emit lands BETWEEN final
      // assistant_message_delta and assistant_message_stop — never
      // coalesced before tool cards.
      const finalAssistantText = contentBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const followUpUserText = extractLatestUserText(messages);
      const chipItems = await generateFollowUpChips(
        deps.streamProvider,
        input.model,
        finalAssistantText,
        followUpUserText,
        ctx.logger,
      );
      try {
        ctx.emit('follow_up', buildFollowUp({ items: chipItems }));
      } catch (err) {
        // buildFollowUp throws only on programmer error (length > 5 etc).
        // generateFollowUpChips already clamps to 3, but defensively emit
        // [] rather than break the turn if validation flags anything.
        ctx.logger.warn(
          { err: (err as Error)?.message },
          '[chat] follow_up emit failed — emitting empty chip row',
        );
        ctx.emit('follow_up', buildFollowUp({ items: [] }));
      }
      // Legacy V2 frame name — closes the assistant turn in the UI.
      // Payload built via typed builder per Spec §12.2. Opcode-e
      // finish dual-emit ripped (A1).
      ctx.emit(
        'assistant_message_stop',
        buildAssistantMessageStop({ reason: 'end_turn', model: input.model }),
      );
      // Phase 3 — terminal hooks for clean end_turn path.
      await deps.hooks?.run('on_turn_end', { turn, model: input.model, endReason: 'end_turn' as StopReason }, hookCtx);
      await deps.hooks?.run('on_pipeline_end', { sessionId: ctx.sessionId, userId: ctx.userId, totalTurns: turn }, hookCtx);
      return { ok: true, turns: turn, toolUses };
    }

    if (stopReason === 'content_filter') {
      // F2-4 (2026-05-12 audit): Azure Responsible AI tripped on the
      // assistant's output. Emit a distinct annotation frame so the UI
      // renders a compliance banner instead of an empty bubble, AND a
      // structured warn log so operators / FedRAMP audit can trace it.
      ctx.logger.warn(
        { turn, model: input.model, sessionId: ctx.sessionId },
        '[chat] content_filter stop_reason — Responsible AI tripped on assistant output',
      );
      // Opcode-e content_filter + finish dual-emits ripped (A1).
      ctx.emit('content_filter', {
        kind: 'content_filter',
        model: input.model,
        message:
          'Response was redacted by safety filters. The assistant cannot return this content.',
      });
      ctx.emit(
        'assistant_message_stop',
        buildAssistantMessageStop({ reason: 'content_filter' as StopReason, model: input.model }),
      );
      await deps.hooks?.run('on_turn_end', { turn, model: input.model, endReason: 'content_filter' as StopReason }, hookCtx);
      await deps.hooks?.run('on_pipeline_end', { sessionId: ctx.sessionId, userId: ctx.userId, totalTurns: turn }, hookCtx);
      return {
        ok: false,
        error: 'content_filter: assistant output was redacted by safety filters',
        turns: turn,
        toolUses,
      };
    }

    if (stopReason === 'max_tokens' || stopReason === 'stop_sequence') {
      // Phase 10 — fire mid-loop handoff trigger on max_tokens. This is a
      // strong signal the current model is mismatched for the request
      // (it ran out of budget without producing a final answer); we ask
      // the caller to decide whether to surface a stronger model.
      if (stopReason === 'max_tokens' && deps.onMidLoopHandoffTrigger) {
        try {
          await deps.onMidLoopHandoffTrigger('max_tokens');
        } catch (err) {
          ctx.logger.warn(
            { err: (err as Error).message },
            '[chat] mid-loop handoff trigger threw on max_tokens (non-fatal)',
          );
        }
      }
      // Opcode-e finish dual-emit ripped (A1).
      ctx.emit(
        'assistant_message_stop',
        buildAssistantMessageStop({ reason: stopReason, model: input.model }),
      );
      // Phase 3 — terminal hooks for short-circuit stop reasons.
      await deps.hooks?.run('on_turn_end', { turn, model: input.model, endReason: stopReason }, hookCtx);
      await deps.hooks?.run('on_pipeline_end', { sessionId: ctx.sessionId, userId: ctx.userId, totalTurns: turn }, hookCtx);
      return {
        ok: stopReason === 'stop_sequence',
        error: stopReason === 'max_tokens' ? 'max_tokens reached' : `stopped on ${stopReason}`,
        turns: turn,
        toolUses,
      };
    }

    // stopReason === 'tool_use' — partition + dispatch.
    const toolBlocks = contentBlocks.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );

    // #763 — No-progress guard. Count (name + argsHash) repeats across
    // turns. The guard FIRES AT THE END of this turn (after dispatch) so
    // the tool_use ↔ tool_result Anthropic-shape pairing stays intact;
    // the next turn is forced to tool_choice='none' with a directive
    // message. Live-caught 2026-05-11 (capstone): azure_list_subscriptions
    // called 15× in 30s because the result was empty + the model didn't
    // synthesize. Threshold = NO_PROGRESS_THRESHOLD identical (name,args)
    // calls accumulated across all turns of this loop.
    let noProgressTriggerTool: { name: string; count: number } | null = null;
    for (const block of toolBlocks) {
      const sig = `${block.name}:${stableArgsKey(block.input)}`;
      const count = (toolCallCounts.get(sig) ?? 0) + 1;
      toolCallCounts.set(sig, count);
      if (
        !noProgressGuardFired &&
        count >= noProgressThresholdFor(block.name) &&
        (!noProgressTriggerTool || count > noProgressTriggerTool.count)
      ) {
        noProgressTriggerTool = { name: block.name, count };
      }
      // Discovery-primitive counter — broader trip per memory
      // `project_ollama_canonical_tool_use_emission_2026_05_11` followup.
      // Q1-fix-6 (2026-05-12): track distinct arg signatures too. Only
      // trigger when every call had identical args (sigs.size === 1).
      // Distinct args = legitimate parallel fan-out (e.g. Sonnet emits
      // 3 tool_search calls for azure/aws/gcp in one turn) — must NOT
      // trip the guard.
      if (DISCOVERY_PRIMITIVES.has(block.name)) {
        const nameCount = (discoveryNameCounts.get(block.name) ?? 0) + 1;
        discoveryNameCounts.set(block.name, nameCount);
        const sigSet = discoveryNameSigs.get(block.name) ?? new Set<string>();
        sigSet.add(stableArgsKey(block.input));
        discoveryNameSigs.set(block.name, sigSet);
        if (
          !noProgressGuardFired &&
          nameCount >= NO_PROGRESS_THRESHOLD &&
          sigSet.size === 1 &&
          (!noProgressTriggerTool || nameCount > noProgressTriggerTool.count)
        ) {
          noProgressTriggerTool = { name: block.name, count: nameCount };
        }
      }
    }

    for (const block of toolBlocks) {
      toolUses.push(block.name);
      // Legacy V2 frame name — `tool_executing` opens the tool_use
      // ContentBlock (INPUT card per mocks/UX/01-cloud-ops.html). Emit
      // BEFORE dispatch so the card appears while the tool runs. Dual-
      // emitted alongside opcode `2` per Plan §UI consumer changes
      // backwards-compat clause. Payload built via typed builder per
      // Spec §12.2.
      ctx.emit(
        'tool_executing',
        buildToolExecuting({
          name: block.name,
          tool_use_id: block.id,
          input: block.input,
        }),
      );
    }

    // Partition: adjacent read-only blocks coalesce into one parallel batch;
    // every mutating block becomes its own serial batch. Mirrors Claude Code's
    // /home/trent/anthropic/src/services/tools/toolOrchestration.ts:91.
    const safeNames = input.concurrencySafeNames ?? new Set<string>();
    const concurrency = input.maxConcurrency ?? 5;
    const batches = partitionToolCalls(toolBlocks, safeNames);

    // Phase 3 — block-name → original ToolUseBlock so the wrapped dispatch
    // can pass `serverName` / `toolUseId` into the hook data shape.
    const blockByName = new Map<string, ToolUseBlock>();
    for (const b of toolBlocks) blockByName.set(b.name, b);

    // #850 (2026-05-14) — offered-tools catalog for the unknown-name short-
    // circuit. Live failure: gpt-oss:20b emitted `name: "list"` for a
    // `tool_search`-shaped call. PermissionService default-fell-through to
    // `ask` and HITL popped a useless "approve list?" prompt that timed-
    // out after 120s. We catch the unknown name BEFORE the permission gate
    // and feed a synthetic tool_result back so the model can self-correct.
    //
    // 2026-05-23 (regression of #850): the set was originally built ONCE
    // here at turn start. Discovery via tool_search mutates `tools` mid-loop
    // (line ~671 `tools.push(def)`), so a tool the model legitimately
    // discovered (e.g. k8s_list_pods after tool_search) would still be
    // flagged as unknown. Fix: rebuild the set on every dispatch so the
    // discovered tools are honored. `buildOfferedToolNames` is O(N) and
    // the catalog stays under a few hundred items — negligible cost.

    /**
     * Phase 3 — wrap the unwrapped `deps.dispatch` so:
     *   1. `before_tool_call` runs as a modifying hook (HITL gate +
     *      DLP-redact). If `data.blocked === true` after the hook chain,
     *      we synthesise a tool failure result without invoking dispatch.
     *   2. `after_tool_call` runs as an observer hook with the dispatch
     *      result + executionTimeMs (audit trail, telemetry).
     *
     * Stays inside the loop so `concurrencySafeNames` / `concurrency` /
     * `batch` ordering remain orchestrator concerns; hooks are per-call
     * cross-cuts.
     */
    const wrappedDispatch = async (
      runCtx: RunCtx,
      call: { name: string; input: unknown },
    ) => {
      const block = blockByName.get(call.name);

      // #850 (2026-05-14) — unknown-tool short-circuit. Catch model-
      // hallucinated tool names (e.g. gpt-oss:20b emitting bare `list`
      // for a tool_search-shape call) BEFORE the permission gate. This
      // prevents the gate from default-fall-through to `ask` and popping
      // HITL on a name that does not exist. The synthesized tool_result
      // tells the model the real catalog so it can self-correct on the
      // next turn (and the no-progress guard at #763 traps repeats).
      // Recompute every dispatch — see comment above (regression of #850).
      // `tools` is mutated mid-loop by discovery (tool_search side-channel),
      // so we MUST snapshot the current set, not a stale turn-start one.
      const offeredToolNames = buildOfferedToolNames(tools);
      const unknownToolErr = findUnknownToolCallError(call.name, offeredToolNames);
      if (unknownToolErr) {
        ctx.logger.warn(
          {
            toolName: call.name,
            toolUseId: block?.id,
            offeredCount: offeredToolNames.size,
          },
          '[chat] #850 unknown-tool short-circuit — model hallucinated a tool name not in the offered catalog; emitting synthetic tool_result error and skipping dispatch/permission-gate',
        );
        return {
          ok: false,
          error: unknownToolErr,
        };
      }

      // Sev-0 #871 (2026-05-17) — anti-bias gate on composition meta-tools.
      // Refuse compose_visual / compose_app when the conversation has no
      // prior tool_result with numeric grounding data. The model occasionally
      // emits these on text-only prompts and the UI renders a "No data"
      // placeholder; worse, it fabricates dollar amounts. The synthetic
      // error tells the model to fetch data first OR answer in prose.
      //
      // Multi-turn-safe: scans the FULL `messages` array (including prior
      // turns' tool_results), so the cost-audit Turn 2 "show me the chart"
      // flow works — Turn 1 pushed tool_results into messages; Turn 2's
      // compose_visual sees them and clears the gate.
      if (ANTI_BIAS_GATED_COMPOSE_TOOLS.has(call.name)) {
        // #947 — bypass conditions for the anti-bias gate.
        //
        //   (a) User explicitly asked for the artifact (verbs: draw, diagram,
        //       render, visualize, architecture, chart, …). When intent is
        //       explicit there's no fabrication concern — the user knows it
        //       isn't from live data and asked for it anyway. Live evidence:
        //       Sonnet 4.6 on "give me an arch diagram of X" hit the gate and
        //       narrated "the artifact gate blocked the diagram because it
        //       expects numeric data from a tool call" — that's the gate
        //       leaking through.
        //
        //   (b) The template slug is conceptual (arch_diagram, reactflow_arch,
        //       network, mermaid, flow, sequence, erd). These are structural
        //       by construction; "numeric grounding" is the wrong gate to
        //       apply by definition.
        //
        // Only when BOTH bypass conditions fail does the gate fire (the
        // intended target: model proactively emits compose_visual after a
        // text-only prompt and would fabricate numbers).
        const latestUserText = extractLatestUserText(messages);
        const userAsked = userMessageHasExplicitArtifactVerb(latestUserText);
        const conceptual = isConceptualTemplate(call.input);
        // Bug A (2026-05-24) — drop the conversationHasNumericGrounding
        // bypass. memory_search results containing numbers were tripping the
        // bypass on prompts where the user did NOT ask for a chart, causing
        // unsolicited compose_visual emission. Per
        // [[feedback_artifacts_must_be_explicitly_requested]]: require
        // userAsked || conceptual; no numeric-grounding escape valve.
        if (!userAsked && !conceptual) {
          ctx.logger.warn(
            {
              toolName: call.name,
              toolUseId: block?.id,
              messagesCount: messages.length,
              latestUserText: latestUserText?.slice(0, 200),
            },
            '[chat] #871/#947 anti-bias gate — compose_visual/compose_app dispatched without explicit user-ask AND non-conceptual template; emitting synthetic tool_result error',
          );
          return {
            ok: false,
            error:
              `compose_visual and compose_app fire only when the user explicitly asks for a chart, diagram, or app (verbs like render, plot, visualize, draw, make a chart, make a diagram). ` +
              `The current user prompt did not request a visualization — answer in plain prose, or call request_clarification if the user's intent is ambiguous.`,
          };
        }
        if (userAsked || conceptual) {
          ctx.logger.info(
            {
              toolName: call.name,
              userAsked,
              conceptual,
              template: (call.input as { template?: unknown })?.template,
            },
            '[chat] #947 anti-bias gate bypass — user explicitly asked OR template is conceptual; allowing dispatch without numeric grounding',
          );
        }
      }

      const hookData: any = {
        toolName: call.name,
        serverName: undefined,
        arguments: call.input,
        userId: ctx.userId ?? '',
        sessionId: ctx.sessionId,
        emit: ctx.emit,
        blocked: false,
      };

      // before_tool_call — modifying. HITL + DLP can mutate `arguments`,
      // set `blocked: true` + `blockReason: '...'`. fail_closed default
      // means a thrown DLP scanner aborts the dispatch; the orchestrator
      // surfaces the throw to the loop.
      // Phase 12 — hook invocation + duration + block outcome metrics.
      const beforeHookStart = Date.now();
      let after: any;
      try {
        after = deps.hooks
          ? await deps.hooks.runModifying<any>('before_tool_call', hookData, hookCtx)
          : hookData;
        safeIncCounter(v3Metrics.hookInvocations, { hook: 'before_tool_call', outcome: 'ok' });
      } catch (hookErr) {
        safeIncCounter(v3Metrics.hookInvocations, { hook: 'before_tool_call', outcome: 'fail' });
        throw hookErr;
      } finally {
        safeObserveHistogram(
          v3Metrics.hookDuration,
          { hook: 'before_tool_call' },
          (Date.now() - beforeHookStart) / 1000,
        );
      }

      if (after.blocked) {
        // Phase 12 — block reason metric (DLP block, HITL deny, etc).
        safeIncCounter(v3Metrics.hookBlocked, {
          hook: 'before_tool_call',
          reason: String(after.blockReason ?? 'unknown'),
        });
        // Skip dispatch — return a synthesised tool failure result with
        // the block reason. ToolDispatchResult shape per types.ts.
        return {
          ok: false,
          error: after.blockReason ?? 'tool call blocked',
        };
      }

      const startedAt = Date.now();

      // B4 (2026-05-12) — short-circuit on malformed tool_call arguments.
      // OllamaProvider tags the tool_use block's `input` with
      // `__malformed_args:true` when gpt-oss:20b (and friends) emit a
      // malformed-JSON string. Dispatching with garbage input was
      // surfacing as a 500 PIPELINE_ERROR — instead, synthesize a
      // tool_result with a clear recovery message so the model can
      // self-correct on the next turn.
      const argsObj = after.arguments as Record<string, unknown> | undefined;
      if (
        argsObj &&
        typeof argsObj === 'object' &&
        (argsObj as { __malformed_args?: unknown }).__malformed_args === true
      ) {
        const rawPreview = String((argsObj as { __raw_args?: unknown }).__raw_args ?? '').slice(0, 200);
        ctx.logger.warn(
          {
            toolName: after.toolName,
            toolUseId: block?.id,
            rawArgsPreview: rawPreview,
          },
          '[chat] B4 short-circuit: tool_use carried __malformed_args sentinel — emitting synthetic tool_result is_error instead of dispatching',
        );
        return {
          ok: false,
          error:
            'Model emitted malformed JSON arguments — try again with a smaller payload or different structure.',
        };
      }

      // Phase 6 — propagate the tool_use_id to dispatch so meta-tool
      // handlers (Task / compose_app / browser_sandbox_exec) that need
      // to correlate parent-child events on the wire (e.g. openagentic-proxy's
      // X-Correlation-Id, sub_agent_started's parent link) can read it
      // off the ctx without changing the dispatch contract. block.id is
      // the LLM-assigned tool_use_id from the assistant message's
      // tool_use ContentBlock.
      //
      // Q1-fix-2 (2026-05-12) — also propagate the most recent user-turn
      // text as `userPromptHint`. executeToolSearch forwards it to
      // /api/internal/tool-search so cloud-detection unions both the
      // model's narrowed query and the user's original intent. Without
      // this, "Find cost spikes across Azure/AWS/GCP" + model query
      // "Azure cost query tool" returns azure-only and the model never
      // sees AWS/GCP tools.
      const userPromptHint = extractLatestUserText(messages);
      const baseDispatchCtx = userPromptHint
        ? { ...runCtx, userPromptHint }
        : runCtx;
      const dispatchCtx = block
        ? { ...baseDispatchCtx, toolUseId: block.id }
        : baseDispatchCtx;
      const result = await deps.dispatch(dispatchCtx, {
        name: after.toolName,
        input: after.arguments,
      });

      // Phase 12 — tool dispatch count + duration + outcome metrics. The
      // tool_name label is the LLM-visible function name (after.toolName)
      // so the chart aggregates correctly across servers.
      const toolDispatchMs = Date.now() - startedAt;
      safeIncCounter(v3Metrics.toolDispatches, {
        tool_name: String(after.toolName ?? 'unknown'),
        outcome: result.ok ? 'ok' : 'error',
      });
      safeObserveHistogram(
        v3Metrics.toolDispatchDuration,
        { tool_name: String(after.toolName ?? 'unknown') },
        toolDispatchMs / 1000,
      );

      // after_tool_call — observer. Cost / audit / telemetry sinks read
      // result + executionTimeMs. Audit + cost are fail_open per built-in
      // registrations so a sink hiccup doesn't abort the user's turn.
      after.result = result.ok ? result.output : { error: result.error };
      after.executionTimeMs = toolDispatchMs;
      if (block) {
        // Forward-compat: pass the tool_use_id so observer hooks can
        // correlate with the SSE tool_result frame (sequencer+audit join).
        after.messageId = block.id;
      }
      if (deps.hooks) {
        // Phase 12 — after_tool_call hook metrics.
        const afterHookStart = Date.now();
        try {
          await deps.hooks.run('after_tool_call', after, hookCtx);
          safeIncCounter(v3Metrics.hookInvocations, { hook: 'after_tool_call', outcome: 'ok' });
        } catch (afterErr) {
          safeIncCounter(v3Metrics.hookInvocations, { hook: 'after_tool_call', outcome: 'fail' });
          throw afterErr;
        } finally {
          safeObserveHistogram(
            v3Metrics.hookDuration,
            { hook: 'after_tool_call' },
            (Date.now() - afterHookStart) / 1000,
          );
        }
      }

      return result;
    };

    const toolResults: Array<{ tool_use_id: string; content: unknown; is_error?: boolean }> = [];
    for (const batch of batches) {
      const runResults = batch.isConcurrencySafe
        ? await runConcurrent(ctx, batch.blocks, wrappedDispatch, concurrency)
        : await runSerial(ctx, batch.blocks, wrappedDispatch);
      for (const r of runResults) {
        // Discovery side-channel: tool_search / agent_search dispatchers
        // place resolved defs on result.discoveredTools / .discoveredAgents.
        // Append to tools[] so next iteration's provider call sees them.
        acceptDiscovered(r.result.discoveredTools);
        acceptDiscovered(r.result.discoveredAgents);

        // Phase 4 — two-channel envelope split (Spec §6.2). When the
        // dispatcher returned an envelope, the MODEL sees only
        // structuredContent (no `_meta`) on the next turn, and the UI
        // sees both structuredContent + `_meta` on the NDJSON frame.
        // When no envelope is present, fall back to the legacy
        // bare-output rendering for backward compat with existing
        // dispatchers that haven't been migrated yet.
        const envelope = r.result.envelope;
        const isError = !r.result.ok;
        // Sev-1 L3-6 / Audit F1-2: when envelope is present but
        // structuredContent is empty (splitter dropped content / oversize /
        // shape mismatch), fall through to the legacy output instead of
        // feeding '' to the model on the next turn (empty bubble).
        // structuredContent's static type is an object, but at runtime the
        // splitter can produce an empty string when the source data was
        // dropped/oversized. Treat undefined / null / '' / {} all as
        // "no envelope content" and fall through to legacy output.
        const envelopeContent = envelope?.structuredContent as unknown;
        const hasEnvelopeContent =
          envelopeContent !== undefined &&
          envelopeContent !== null &&
          envelopeContent !== '' &&
          !(
            typeof envelopeContent === 'object' &&
            !Array.isArray(envelopeContent) &&
            Object.keys(envelopeContent as Record<string, unknown>).length === 0
          );
        const modelContent = hasEnvelopeContent
          ? envelopeContent
          : r.result.ok
            ? (r.result.output ?? '')
            : (r.result.error ?? 'tool failed');
        const uiContent = modelContent;
        const uiMeta = envelope?._meta;

        // Phase 12 — envelope-overflow advisory. The Phase 4 splitter sets
        // _meta.truncated / _meta.overflow when it had to drop content
        // from structuredContent. Bump the per-tool counter so operators
        // see WHICH tools regularly outgrow the envelope.
        if (
          uiMeta &&
          typeof uiMeta === 'object' &&
          ((uiMeta as any).truncated === true || (uiMeta as any).overflow === true)
        ) {
          safeIncCounter(v3Metrics.envelopeOverflow, {
            tool_name: String(r.name ?? 'unknown'),
          });
        }

        // Frame name `tool_result` fills the RESULT card body. Field
        // shape (`tool_use_id`, `is_error`) matches the legacy chat
        // pipeline contract that useChatStream consumes.
        // Payload built via typed builder per Spec §12.2. Phase 4 adds
        // optional `_meta` so the UI's tool_result reducer arm can look
        // up the FrameRendererRegistry component for outputTemplate.
        // Opcode-3 dual-emit ripped (A1, 2026-05-12).
        ctx.emit(
          'tool_result',
          buildToolResult({
            name: r.name,
            tool_use_id: r.toolUseId,
            content: uiContent,
            is_error: isError,
            _meta: uiMeta,
          }),
        );
        // Opcode-4 ARTIFACT dual-emit ripped (A1) — UI never grew a
        // matching `case '4':` arm. Visual artifacts surface via the
        // named `visual_render` / `app_render` / `artifact_render`
        // frames emitted by their respective tool handlers
        // (ComposeVisualTool, ComposeAppTool, RenderArtifactTool).
        // Model channel — strip _meta entirely. When envelope is set,
        // we push only structuredContent so the model never sees the
        // outputTemplate slug / artifactHandle / size / elapsed / cost.
        //
        // Sev-0 META #826/#983/#899 — empty-tool-result guard. When the
        // final model-facing content is empty / errored / list-wrapper-empty,
        // prepend a SYSTEM NOTE so the model has an unambiguous in-band
        // instruction to acknowledge the gap and refuse fabrication. The
        // UI emit above (ctx.emit 'tool_result') already shipped the raw
        // uiContent to the user — only the model channel is augmented.
        // Guard chain: empty-result guard FIRST (highest priority — the
        // model must not fabricate from nothing). Otherwise, if the result
        // is large, apply the task-attention guard so the model parses what
        // is there without re-calling the tool or hallucinating a follow-up
        // turn. #1020 — Q17 empirical: priming keeps the model on-task on
        // large-result inventory prompts (kube-system 33-pod ~12KB JSON).
        let modelContentGuarded: unknown = modelContent;
        if (isEmptyToolResultContent(modelContent, isError)) {
          modelContentGuarded = withEmptyToolResultGuard(modelContent);
        } else if (isLargeToolResultContent(modelContent)) {
          modelContentGuarded = withLargeToolResultGuard(modelContent);
        }
        toolResults.push({
          tool_use_id: r.toolUseId,
          content: modelContentGuarded,
          is_error: isError,
        });
      }
    }

    messages.push({ role: 'tool', content: toolResults });

    // Sev-0 META #1105 (2026-05-24) — fabrication-on-empty-tool-result
    // guard. Layer 3 of the empty-result defense: when ANY tool_result
    // landing in the next turn's `messages` is empty per the wider
    // detection heuristic (catches `{count:0}`, `{results:[]}`, and
    // MCP-envelope-wrapped empties on top of the layer-2 shapes), push
    // a SEPARATE `role:'system'` message right after the tool message
    // so the model sees an unambiguous in-band directive on its next
    // turn: "Do NOT invent or fabricate". Live evidence: model
    // dispatched memory_search, tool returned `[]`, model fabricated
    // a full table of fake compute-prod / data-warehouse / ml-training
    // dollar values. The layer-2 SYSTEM NOTE prefix on the tool_result
    // content alone was insufficient — gpt-oss:20b still ignored it.
    // The separate system message lands BETWEEN the tool message and
    // the next provider call, which keeps it salient for the model.
    {
      let anyEmpty = false;
      for (const r of toolResults) {
        if (isEmptyForFabricationGuard(r.content, r.is_error === true)) {
          anyEmpty = true;
          break;
        }
      }
      if (anyEmpty) {
        ctx.logger.warn(
          {
            turn,
            toolResultCount: toolResults.length,
          },
          '[chat] [empty-result-guard] #1105 — at least one tool_result is empty; injecting role:"system" fabrication-refusal directive into next-turn messages',
        );
        // chatLoop's messages array is typed `user|assistant|tool` to match
        // ProviderRequest. We push role:'system' here per Sev-0 META #1105
        // spec — the directive lands as a distinct salient frame between
        // the empty tool_result and the next provider call. Downstream
        // providers (ProviderManager.createCompletion) fold system-role
        // messages mid-array into the prompt appropriately.
        (messages as Array<{ role: string; content: any }>).push({
          role: 'system',
          content: EMPTY_RESULT_GUARD_SYSTEM_MESSAGE,
        });
      }
    }

    // C3 — update the accumulated MCP result count and compose-dispatched flag
    // for the pre-turn detector on the next iteration.
    const composeNamesForC3 = new Set(['compose_visual', 'compose_app']);
    const mcpToolResultsThisTurn = toolBlocks.filter(
      (b) => !composeNamesForC3.has(b.name),
    ).length;
    mcpResultsAccumulated += mcpToolResultsThisTurn;
    if (toolBlocks.some((b) => composeNamesForC3.has(b.name))) {
      composeDispatchedThisLoop = true;
    }

    // Phase A.4 — artifact-verb forcing: after MCP fetches complete, check
    // whether the user's message contained an artifact verb. If so, and if
    // no compose_visual / compose_app was already dispatched this turn
    // (anti-loop guard), force the next model call to the correct tool.
    //
    // Runs ONLY when the no-progress guard hasn't already fired (no-progress
    // takes precedence — the model is stuck and must synthesize, not render).
    //
    // Also skipped when nextTurnToolChoice is already 'none' (synthesis
    // retry path — same precedence rule).
    if (!noProgressTriggerTool && (nextTurnToolChoice as string) !== 'none') {
      // composeAlreadyDispatched check — uses the same composeNamesForC3 set.
      const composeAlreadyDispatched = composeDispatchedThisLoop;
      if (!composeAlreadyDispatched && mcpToolResultsThisTurn >= 1) {
        const userText = extractLatestUserText(messages);
        const detection = detectArtifactVerb({
          userMessage: userText,
          mcpToolResultsThisTurn,
        });
        if (detection.shouldForce && detection.toolName) {
          ctx.logger.info(
            {
              turn,
              toolName: detection.toolName,
              mcpToolResultsThisTurn,
              userTextPreview: userText.slice(0, 120),
            },
            `[chat] Phase A.4 — artifact verb detected; forcing next turn to ${detection.toolName}`,
          );
          nextTurnToolChoice = {
            type: 'function',
            function: { name: detection.toolName },
          };
        }
      }
    }

    // #763 — No-progress guard trigger. Fires AFTER tool_results pushed so
    // tool_use ↔ tool_result pairing is intact in the conversation. The
    // next turn runs with tool_choice='none' + a directive message
    // pointing the model at the existing tool_results.
    if (noProgressTriggerTool && !noProgressGuardFired) {
      noProgressGuardFired = true;
      ctx.logger.warn(
        {
          turn,
          toolName: noProgressTriggerTool.name,
          count: noProgressTriggerTool.count,
        },
        `[chat] no-progress guard: tool '${noProgressTriggerTool.name}' called ${noProgressTriggerTool.count}× with identical args — forcing synthesis turn`,
      );
      messages.push({
        role: 'user',
        content: `You have called \`${noProgressTriggerTool.name}\` ${noProgressTriggerTool.count} times with the same arguments. The result above is stable — do not call this tool again. Synthesize a clear, concise answer from the tool_results already in the conversation.`,
      });
      nextTurnToolChoice = 'none';
      // Opcode-e no_progress guard emit ripped (A1, 2026-05-12). The
      // warn log above is the audit trail; the synthesis-turn directive
      // message + tool_choice='none' is what the model sees.
    }

    // Phase 10 — TFC mid-loop handoff trigger.
    //
    // A turn that ONLY dispatched `request_clarification` tools is a
    // signal the current model is uncertain about the user's intent. If
    // it does this 3+ turns in a row, the model is stuck — surface the
    // handoff offer. Mixed turns (clarification + other tools) reset the
    // counter; partial-clarification turns aren't strong enough signal.
    //
    // Counter increments AFTER tool_results are pushed so the offer
    // envelope renders below the latest clarification card in the UI.
    const allClarification =
      toolBlocks.length > 0 &&
      toolBlocks.every((b) => b.name === 'request_clarification');
    if (allClarification) {
      consecutiveClarificationCount += 1;
    } else {
      consecutiveClarificationCount = 0;
    }
    if (
      consecutiveClarificationCount >= MID_LOOP_CLARIFICATION_THRESHOLD &&
      deps.onMidLoopHandoffTrigger
    ) {
      try {
        await deps.onMidLoopHandoffTrigger('consecutive_clarifications');
      } catch (err) {
        ctx.logger.warn(
          { err: (err as Error).message },
          '[chat] mid-loop handoff trigger threw on consecutive_clarifications (non-fatal)',
        );
      }
    }

    // Phase 8 — mid-loop compaction trigger. After tool_results are pushed
    // (the buffer just grew), check usage and compact when the HARD
    // threshold (85%) is breached. The check is awaited (not
    // fire-and-forget) so the next round's provider call sees the smaller
    // buffer. Failures are non-fatal — logged + swallowed so the loop
    // continues even if the underlying ContextManagementService throws.
    //
    // Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
    if (deps.contextMgmt && ctx.sessionId) {
      try {
        const usage = await deps.contextMgmt.getContextUsage(ctx.sessionId, input.model);
        if (usage.usagePercentage >= 85) {
          ctx.logger.info(
            { sessionId: ctx.sessionId, usage: usage.usagePercentage, model: input.model },
            '[chat] mid-loop compaction triggered (>=85% hard threshold)',
          );
          // Phase 12 — mid-loop compaction trigger metric.
          safeIncCounter(v3Metrics.compactionTriggers, { trigger_point: 'midloop' });
          const compactResult = await deps.contextMgmt.compactContext(ctx.sessionId, input.model);
          if (typeof (compactResult as any)?.tokensFreed === 'number') {
            safeObserveHistogram(
              v3Metrics.compactionTokensFreed,
              (compactResult as any).tokensFreed,
            );
          }
        }
      } catch (err: any) {
        ctx.logger.warn(
          { err: err?.message ?? String(err), sessionId: ctx.sessionId },
          '[chat] mid-loop compaction failed (non-fatal — loop continues)',
        );
      }
    }

    // Phase 3 — `on_turn_end` (observer) fires at the bottom of every
    // turn iteration that didn't already short-circuit on a terminal
    // stop reason. The next loop pass calls `on_turn_start` again.
    // Audit / telemetry sinks can record per-turn metrics here.
    await deps.hooks?.run('on_turn_end', { turn, model: input.model, endReason: 'tool_use' as StopReason }, hookCtx);
  }

  // Opcode-e max_turns finish dual-emit ripped (A1, 2026-05-12).
  ctx.emit(
    'assistant_message_stop',
    buildAssistantMessageStop({ reason: 'max_turns' as StopReason, model: input.model }),
  );
  // Phase 3 — terminal pipeline hook for the max-turns guard path.
  await deps.hooks?.run('on_pipeline_end', { sessionId: ctx.sessionId, userId: ctx.userId, totalTurns: maxTurns }, hookCtx);
  return {
    ok: false,
    error: `hit max-turns cap (${maxTurns}) without an end_turn`,
    turns: maxTurns,
    toolUses,
  };
}
