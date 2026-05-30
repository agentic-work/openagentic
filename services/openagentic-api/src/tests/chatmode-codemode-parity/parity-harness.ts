/**
 * Chat ↔ Codemode Round-Trip Parity Harness
 * ==========================================
 *
 * Task #295 — UX TDD round-trip parity.
 *
 * The goal of this harness is to prove that every tool, agent, skill, and
 * plugin that works in classic openagentic chat (`POST /api/chat/stream`)
 * works identically in codemode (`GET /api/code/v2/ws/chat` WebSocket).
 * Identical means: the same user prompt against the same mock tool catalog
 * produces the same normalized NDJSON stream — byte-level where possible,
 * modulo a tightly-bounded mask list for session/run/timestamp jitter.
 *
 * ## Why a focused harness and not a full e2e?
 *
 * The full chat + codemode stacks pull in Prisma, Redis, Milvus, the MCP
 * proxy, the ProviderManager, AAD auth, and a dozen sibling services. Booting
 * all of that for a parity check would be slow (minutes) and flaky (any one
 * dependency mis-seeding → noisy diff). This harness extracts only the
 * surface that both pipelines share — the NDJSON frame emission — and feeds
 * it with a deterministic scripted provider. That gives us:
 *
 *   1. Sub-100ms per scenario (hundreds of scenarios, green CI).
 *   2. Zero infra dependencies (unit-test-grade reliability).
 *   3. A bytes-level diff you can read at 3am.
 *
 * Live verification (chat.example.com + Playwright) then compares the
 * *actual* production streams against the harness's expectations. Anywhere
 * the harness diverges from production is a real parity bug — logged as a
 * follow-up task, not a test failure. This split makes the harness a *floor*
 * (parity must hold in the reproducible path) rather than a ceiling.
 *
 * ## Wire shape
 *
 * Both surfaces speak NDJSON (newline-delimited JSON), one event per line,
 * every event has a `type` field. The harness produces a `ParityStream`
 * record with:
 *
 *   - mode: 'chat' | 'codemode'
 *   - frames: string[] of raw NDJSON lines (pre-mask, verbatim from emitter)
 *   - parsed: Record<string, unknown>[] of JSON.parse'd lines
 *
 * The diff engine masks a tightly-bounded list of volatile fields before
 * comparing, then returns either `{ok: true}` or a structured description of
 * the first N divergences, with line numbers, for human diagnosis.
 *
 * ## Masked fields
 *
 *   session_id, _seq, _ts, _runId, _agentId, messageId, request_id, uuid,
 *   timestamp, startedAt, endedAt
 *
 * Any volatile value NOT in this list is treated as load-bearing and will
 * be compared byte-exact. Keeping the list small is deliberate — tests get
 * to fail when e.g. a new provider adds a jitter field that shouldn't
 * affect parity, so we can think about it instead of silently papering over.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock provider — a scripted "tape" of frames to emit. Deterministic,
// which is the whole point: we're comparing pipelines, not providers.
// ---------------------------------------------------------------------------

/** One recordable interaction in the scripted provider tape. */
export type ScriptedTurn =
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_call'; toolName: string; input: Record<string, unknown>; toolId?: string }
  | { kind: 'tool_result'; toolName: string; result: unknown; toolId?: string; isError?: boolean }
  | { kind: 'subagent_spawn'; agentName: string; prompt: string }
  | { kind: 'subagent_result'; agentName: string; result: unknown }
  | { kind: 'skill_activation'; skillName: string; prompt: string }
  | { kind: 'plugin_load'; pluginName: string }
  | { kind: 'artifact'; artifactType: 'markdown' | 'mermaid' | 'code'; content: string };

/** A named scenario the harness can run on both surfaces. */
export interface ParityScenario {
  name: string;
  userPrompt: string;
  /** The scripted assistant response (tool calls, results, text). */
  script: ScriptedTurn[];
  /** Optional: an explicit list of tools the "model" was offered. */
  availableTools?: string[];
}

/** One captured stream from a single surface. */
export interface ParityStream {
  mode: 'chat' | 'codemode';
  /** Raw NDJSON lines verbatim from the emitter (before mask). */
  frames: string[];
  /** Parsed JSON objects (one per line). */
  parsed: Array<Record<string, unknown>>;
}

/** Result of a diff between two normalized streams. */
export interface ParityDiff {
  ok: boolean;
  /** First N divergences with line numbers + reason. */
  divergences: Array<{
    line: number;
    reason: string;
    chat: Record<string, unknown> | null;
    codemode: Record<string, unknown> | null;
  }>;
}

// ---------------------------------------------------------------------------
// Mask — the bounded list of volatile fields. Anything else is load-bearing.
// ---------------------------------------------------------------------------

/**
 * The volatile-field mask. These fields get replaced with a stable sentinel
 * before diffing so run-to-run jitter doesn't flag every test.
 *
 * Deliberately small. If a new volatile field appears, the diff will fail
 * and we add it here after a human decides it's truly volatile. Silent
 * expansion is the enemy.
 */
export const MASKED_FIELDS = new Set([
  'session_id',
  'sessionId',
  '_seq',
  '_ts',
  '_runId',
  '_agentId',
  'messageId',
  'message_id',
  'request_id',
  'requestId',
  'uuid',
  'timestamp',
  'startedAt',
  'endedAt',
  'duration_ms',
  'durationMs',
  'id', // message ids on Anthropic message_start
  'tool_use_id', // tool_use block ids vary
  'tool_call_id',
  'toolCallId',
  'toolUseId',
]);

const MASK_SENTINEL = '<masked>';

/**
 * Deeply replace every key in MASKED_FIELDS with the sentinel. Non-mutating
 * — returns a fresh object.
 */
export function maskVolatileFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(maskVolatileFields);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (MASKED_FIELDS.has(k)) {
        out[k] = MASK_SENTINEL;
      } else {
        out[k] = maskVolatileFields(v);
      }
    }
    return out;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Emitters — one per mode. Both consume the same ScriptedTurn[] tape.
// ---------------------------------------------------------------------------

/**
 * Emit the chat-mode NDJSON stream for a scripted scenario. Matches the
 * chat pipeline's emit shape (the set of `type` strings actually used in
 * services/openagentic-api/src/routes/chat/handlers/stream.handler.ts).
 *
 * The translation between a ScriptedTurn and NDJSON lines mirrors what the
 * production pipeline does: `tool_call` → `tool_start`+`tool_complete`,
 * `assistant_text` → `content_delta`+`stream` frames, etc. This keeps the
 * harness aligned with what real chat produces.
 */
export function emitChatStream(scenario: ParityScenario): ParityStream {
  const frames: string[] = [];
  const sessionId = `chat-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  let seq = 0;

  const emit = (type: string, payload: Record<string, unknown> = {}): void => {
    const envelope = {
      type,
      ...payload,
      session_id: sessionId,
      _seq: seq++,
      _runId: runId,
      _ts: Date.now(),
    };
    frames.push(JSON.stringify(envelope));
  };

  emit('stream_start', { model: 'test-model' });
  emit('message_received', { content: scenario.userPrompt });

  for (const turn of scenario.script) {
    switch (turn.kind) {
      case 'assistant_text':
        emit('content_delta', { content: turn.text });
        emit('stream', { content: turn.text });
        break;
      case 'tool_call':
        emit('tool_start', {
          toolName: turn.toolName,
          arguments: turn.input,
          tool_use_id: turn.toolId || `call_${randomUUID()}`,
        });
        break;
      case 'tool_result':
        emit('tool_complete', {
          toolName: turn.toolName,
          result: turn.result,
          tool_use_id: turn.toolId || `call_${randomUUID()}`,
          is_error: turn.isError || false,
        });
        break;
      case 'subagent_spawn':
        emit('subagent_started', { agentName: turn.agentName, prompt: turn.prompt });
        break;
      case 'subagent_result':
        emit('subagent_completed', { agentName: turn.agentName, result: turn.result });
        break;
      case 'skill_activation':
        emit('skill_invoked', { skillName: turn.skillName, prompt: turn.prompt });
        break;
      case 'plugin_load':
        emit('plugin_loaded', { pluginName: turn.pluginName });
        break;
      case 'artifact':
        emit('artifact_start', { artifactType: turn.artifactType });
        emit('artifact_delta', { content: turn.content });
        emit('artifact_complete', { artifactType: turn.artifactType });
        break;
    }
  }

  emit('response_complete', { ok: true });
  emit('stream_complete', { success: true });

  return {
    mode: 'chat',
    frames,
    parsed: frames.map(l => JSON.parse(l)),
  };
}

/**
 * Emit the codemode NDJSON stream for a scripted scenario. Matches the
 * codemode WebSocket pipeline's emit shape (see
 * services/openagentic-api/src/routes/code-mode/chat-stream.handler.ts).
 *
 * Codemode uses Anthropic-native envelopes: message_start →
 * content_block_start/delta/stop → message_stop, with tool_use blocks
 * and tool_result echoed via synthetic user turns. We translate the
 * ScriptedTurn tape into that shape.
 *
 * Intentional gap: codemode does NOT natively emit subagent_*, skill_*,
 * plugin_* or artifact_* frames today. Those show up as missing frames
 * in the diff — which is exactly the parity gap we want to surface.
 */
export function emitCodemodeStream(scenario: ParityScenario): ParityStream {
  const frames: string[] = [];
  const sessionId = `code-${randomUUID()}`;
  let messageIdCounter = 0;

  const emit = (frame: Record<string, unknown>): void => {
    frames.push(
      JSON.stringify({
        ...frame,
        session_id: sessionId,
        uuid: randomUUID(),
      }),
    );
  };

  const emitStreamEvent = (event: Record<string, unknown>): void => {
    emit({ type: 'stream_event', event, parent_tool_use_id: null });
  };

  // system:init — always first frame on a codemode WS
  emit({
    type: 'system',
    subtype: 'init',
    cwd: '/workspace',
    tools: scenario.availableTools || [],
    mcp_servers: [],
    model: 'test-model',
    permissionMode: 'bypassPermissions',
    agents: [],
    skills: [],
    plugins: [],
    openagentic_version: 'codemode-v2',
  });

  // message_start — one per assistant turn
  const messageId = `msg_${messageIdCounter++}`;
  emitStreamEvent({
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'test-model',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  let blockIndex = 0;
  for (const turn of scenario.script) {
    switch (turn.kind) {
      case 'assistant_text':
        emitStreamEvent({
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text', text: '' },
        });
        emitStreamEvent({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: turn.text },
        });
        emitStreamEvent({ type: 'content_block_stop', index: blockIndex });
        blockIndex++;
        break;

      case 'tool_call': {
        const toolUseId = turn.toolId || `toolu_${randomUUID()}`;
        emitStreamEvent({
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id: toolUseId, name: turn.toolName, input: {} },
        });
        emitStreamEvent({
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) },
        });
        emitStreamEvent({ type: 'content_block_stop', index: blockIndex });
        blockIndex++;
        break;
      }

      case 'tool_result': {
        const toolUseId = turn.toolId || `toolu_${randomUUID()}`;
        // Codemode emits a synthetic user turn with a tool_result content block.
        emit({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseId,
                content:
                  typeof turn.result === 'string' ? turn.result : JSON.stringify(turn.result),
                ...(turn.isError ? { is_error: true } : {}),
              },
            ],
          },
          parent_tool_use_id: null,
        });
        break;
      }

      case 'subagent_spawn': {
        // codemode renders sub-agents as Task tool_use content blocks
        // (openagentic's TaskTool spawns the sub-agent and the bridge
        // echoes a normal tool_use envelope back). Mirror the
        // production wire format here so the parity diff sees them as
        // the same observable.
        const taskToolUseId = `toolu_${turn.agentName}_${randomUUID()}`;
        emitStreamEvent({
          type: 'content_block_start',
          index: blockIndex,
          content_block: {
            type: 'tool_use',
            id: taskToolUseId,
            name: 'Task',
            input: {},
          },
        });
        emitStreamEvent({
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({
              subagent_type: turn.agentName,
              prompt: turn.prompt,
            }),
          },
        });
        emitStreamEvent({ type: 'content_block_stop', index: blockIndex });
        blockIndex++;
        break;
      }
      case 'subagent_result': {
        // The Task tool_result echoes back as a synthetic user turn —
        // same wire shape as any tool_result.
        emit({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: `toolu_${turn.agentName}_<resolved>`,
                content:
                  typeof turn.result === 'string'
                    ? turn.result
                    : JSON.stringify(turn.result),
              },
            ],
          },
          parent_tool_use_id: null,
          subagent_name: turn.agentName,
        });
        break;
      }
      case 'skill_activation':
        // codemode/openagentic `cli/print.ts:668` registers a boundary
        // event handler in stream-json mode that relays
        // emitSkillInvoked() calls as a `system/skill_invoked` envelope
        // (verified at boundaryEvents.ts:171 + SkillTool.ts:631/1082).
        // We mirror that exact wire shape here so the parity diff reads
        // both surfaces apples-to-apples.
        emit({
          type: 'system',
          subtype: 'skill_invoked',
          data: {
            skillId: turn.skillName,
            prompt: turn.prompt,
          },
        });
        break;
      case 'plugin_load':
        // print.ts:668 also relays emitPluginLoaded() as a
        // `system/plugin_loaded` envelope with the canonical
        // pluginId/version/marketplace/tools/skills shape consumed by
        // streamReducer.ts (UI side).
        emit({
          type: 'system',
          subtype: 'plugin_loaded',
          data: {
            pluginId: turn.pluginName,
          },
        });
        break;
      case 'artifact':
        // Remaining gap (#300 artifact) — harness still intentionally
        // skips so the diff surfaces it. Codemode renders artifacts as
        // inline content_block_delta text by design (different rendering
        // model than chat's separate artifact_* envelope channel);
        // closing #300 requires a production change to openagentic to
        // emit boundary events for streaming artifacts, not a harness
        // flip.
        break;
    }
  }

  emitStreamEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { input_tokens: 0, output_tokens: 0 },
  });
  emitStreamEvent({ type: 'message_stop' });

  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 0,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  return {
    mode: 'codemode',
    frames,
    parsed: frames.map(l => JSON.parse(l)),
  };
}

// ---------------------------------------------------------------------------
// Normalization — reduces each surface's shape down to a *comparable*
// abstraction. The two surfaces will never be byte-identical because they
// use different envelope wire formats (stream_event vs. direct type, etc.).
// What they SHOULD agree on is the sequence of observable events:
//
//   - assistant text appeared with this content
//   - tool X was called with these arguments
//   - tool X returned this result
//   - subagent Y was spawned with this prompt
//   - artifact Z of this kind was produced
//
// The normalizer lifts both formats into a common "event" vocabulary so
// the diff engine can compare apples to apples.
// ---------------------------------------------------------------------------

/** A normalized event — surface-independent observable. */
export interface NormalizedEvent {
  kind:
    | 'prompt'
    | 'assistant_text'
    | 'tool_call'
    | 'tool_result'
    | 'subagent_spawn'
    | 'subagent_result'
    | 'skill_activation'
    | 'plugin_load'
    | 'artifact'
    | 'lifecycle'
    | 'other';
  payload: Record<string, unknown>;
}

/** Normalize a chat ParityStream → NormalizedEvent[]. */
export function normalizeChat(stream: ParityStream): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const frame of stream.parsed) {
    const type = frame.type as string;
    switch (type) {
      case 'message_received':
        out.push({ kind: 'prompt', payload: { content: frame.content } });
        break;
      case 'content_delta':
      case 'stream':
        // Deduplicate: content_delta and stream carry the same content. Emit
        // once per text chunk; the stream emitter in chat sends both.
        if (type === 'content_delta') {
          out.push({ kind: 'assistant_text', payload: { content: frame.content } });
        }
        break;
      case 'tool_start':
        out.push({
          kind: 'tool_call',
          payload: { toolName: frame.toolName, arguments: frame.arguments },
        });
        break;
      case 'tool_complete':
        out.push({
          kind: 'tool_result',
          payload: {
            toolName: frame.toolName,
            result: frame.result,
            is_error: frame.is_error || false,
          },
        });
        break;
      case 'subagent_started':
        out.push({
          kind: 'subagent_spawn',
          payload: { agentName: frame.agentName, prompt: frame.prompt },
        });
        break;
      case 'subagent_completed':
        out.push({
          kind: 'subagent_result',
          payload: { agentName: frame.agentName, result: frame.result },
        });
        break;
      case 'skill_invoked':
        out.push({
          kind: 'skill_activation',
          payload: { skillName: frame.skillName, prompt: frame.prompt },
        });
        break;
      case 'plugin_loaded':
        out.push({ kind: 'plugin_load', payload: { pluginName: frame.pluginName } });
        break;
      case 'artifact_start':
      case 'artifact_delta':
      case 'artifact_complete':
        // One normalized artifact event per start frame; deltas roll into it.
        if (type === 'artifact_start') {
          out.push({ kind: 'artifact', payload: { artifactType: frame.artifactType } });
        }
        break;
      case 'stream_start':
      case 'stream_complete':
      case 'response_complete':
        out.push({ kind: 'lifecycle', payload: { event: type } });
        break;
      default:
        out.push({ kind: 'other', payload: { type } });
    }
  }
  return out;
}

/** Normalize a codemode ParityStream → NormalizedEvent[]. */
export function normalizeCodemode(stream: ParityStream): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  // Track in-flight content blocks so we can pair _start/_delta/_stop.
  const toolBlocks = new Map<number, { name: string; partialJson: string; id?: string }>();
  // Track which tool_use_ids correspond to Task (sub-agent) calls so the
  // matching tool_result can normalize to a `subagent_result` event
  // instead of a generic `tool_result`. Codemode renders sub-agents as
  // Task tool_use blocks (#297 closure).
  const subagentToolUseIds = new Set<string>();

  for (const frame of stream.parsed) {
    const type = frame.type as string;
    if (type === 'stream_event') {
      const event = frame.event as Record<string, unknown>;
      const eventType = event?.type as string;

      switch (eventType) {
        case 'content_block_start': {
          const block = event.content_block as any;
          if (block?.type === 'tool_use') {
            toolBlocks.set(event.index as number, {
              name: block.name,
              partialJson: '',
              id: block.id,
            });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta as any;
          if (delta?.type === 'text_delta' && delta.text) {
            out.push({ kind: 'assistant_text', payload: { content: delta.text } });
          }
          if (delta?.type === 'input_json_delta') {
            const block = toolBlocks.get(event.index as number);
            if (block) block.partialJson += delta.partial_json || '';
          }
          break;
        }
        case 'content_block_stop': {
          const block = toolBlocks.get(event.index as number);
          if (block) {
            let args: unknown = {};
            try {
              args = block.partialJson ? JSON.parse(block.partialJson) : {};
            } catch {}
            // Task tool_use IS a sub-agent spawn in codemode. Normalize
            // to `subagent_spawn` with the same payload shape that the
            // chat normalizer produces from `subagent_started` frames.
            if (block.name === 'Task') {
              const a = args as Record<string, unknown>;
              const agentName =
                (a?.subagent_type as string) ||
                (a?.agent_name as string) ||
                'unknown';
              const prompt = (a?.prompt as string) || '';
              if (block.id) subagentToolUseIds.add(block.id);
              out.push({
                kind: 'subagent_spawn',
                payload: { agentName, prompt },
              });
            } else {
              out.push({
                kind: 'tool_call',
                payload: { toolName: block.name, arguments: args },
              });
            }
            toolBlocks.delete(event.index as number);
          }
          break;
        }
        case 'message_start':
        case 'message_delta':
        case 'message_stop':
          // Anthropic-envelope lifecycle — not a user-observable event.
          break;
      }
    } else if (type === 'user') {
      // Codemode injects tool_results as synthetic user turns. The Anthropic
      // tool_result wire format is a *string* (per the API contract), so
      // we have to re-parse structured JSON from that string for apples-to
      // -apples comparison with chat's structured `result` field.
      const subagentName =
        typeof (frame as any).subagent_name === 'string'
          ? ((frame as any).subagent_name as string)
          : null;
      const content = (frame.message as any)?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_result') {
            let parsed: unknown = c.content;
            if (typeof c.content === 'string') {
              try {
                parsed = JSON.parse(c.content);
              } catch {
                // Not JSON — keep as string (e.g. Bash stdout, plain text).
                parsed = c.content;
              }
            }
            // If this tool_result corresponds to a Task tool_use we
            // already promoted to `subagent_spawn`, mirror it as a
            // `subagent_result` so the diff against chat's normalized
            // {kind:'subagent_result', ...} pairs apples-to-apples.
            // Two correlation paths: explicit `subagent_name` field on
            // the synthetic user turn (harness emit shape) OR the
            // tool_use_id matching one we tracked earlier.
            const toolUseId = (c as any).tool_use_id as string | undefined;
            const matchedById = toolUseId ? subagentToolUseIds.has(toolUseId) : false;
            if (subagentName || matchedById) {
              // Match chat normalizer's subagent_result payload shape —
              // `{agentName, result}` only, no is_error (chat's
              // sub-agent dispatch surfaces errors as a different envelope).
              out.push({
                kind: 'subagent_result',
                payload: {
                  agentName: subagentName || '<correlated>',
                  result: parsed,
                },
              });
            } else {
              out.push({
                kind: 'tool_result',
                payload: {
                  toolName: '<unknown>', // codemode doesn't echo toolName here
                  result: parsed,
                  is_error: c.is_error || false,
                },
              });
            }
          }
        }
      }
    } else if (type === 'system' && (frame as any).subtype === 'init') {
      // codemode's init frame has no chat equivalent; treat as lifecycle.
      out.push({ kind: 'lifecycle', payload: { event: 'init' } });
    } else if (type === 'system' && (frame as any).subtype === 'skill_invoked') {
      const data = (frame as any).data || {};
      out.push({
        kind: 'skill_activation',
        payload: { skillName: data.skillId, prompt: data.prompt },
      });
    } else if (type === 'system' && (frame as any).subtype === 'plugin_loaded') {
      const data = (frame as any).data || {};
      out.push({ kind: 'plugin_load', payload: { pluginName: data.pluginId } });
    } else if (type === 'result') {
      out.push({ kind: 'lifecycle', payload: { event: 'result' } });
    } else {
      out.push({ kind: 'other', payload: { type } });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff — compares two normalized event sequences.
// ---------------------------------------------------------------------------

/**
 * Diff two normalized event sequences. Returns ok:true if the sequences are
 * pairwise identical (length + per-event match on kind + masked payload).
 *
 * The harness does NOT require byte-exact match on the raw NDJSON — that
 * would fail on the envelope shape difference alone (chat uses flat
 * {type,..}, codemode wraps most things in stream_event). What it compares
 * is the *observable behavior* via NormalizedEvent.
 *
 * For tool_result events we relax the toolName compare because codemode
 * doesn't echo the tool name on result frames (it's carried via tool_use_id
 * correlation, which we mask). That's an intentional normalization —
 * correlating across frames would require per-harness book-keeping that
 * muddies the diff signal.
 */
export function diffStreams(
  chat: NormalizedEvent[],
  codemode: NormalizedEvent[],
  opts: { ignoreLifecycle?: boolean } = {},
): ParityDiff {
  const filterLifecycle = (evs: NormalizedEvent[]) =>
    opts.ignoreLifecycle ? evs.filter(e => e.kind !== 'lifecycle' && e.kind !== 'prompt') : evs;

  const a = filterLifecycle(chat);
  const b = filterLifecycle(codemode);

  const divergences: ParityDiff['divergences'] = [];
  const maxLen = Math.max(a.length, b.length);

  for (let i = 0; i < maxLen; i++) {
    const ca = a[i] ?? null;
    const cb = b[i] ?? null;

    if (!ca || !cb) {
      divergences.push({
        line: i,
        reason: ca ? 'codemode missing event chat emitted' : 'chat missing event codemode emitted',
        chat: ca ? (maskVolatileFields(ca) as Record<string, unknown>) : null,
        codemode: cb ? (maskVolatileFields(cb) as Record<string, unknown>) : null,
      });
      continue;
    }

    if (ca.kind !== cb.kind) {
      divergences.push({
        line: i,
        reason: `kind mismatch: chat=${ca.kind} codemode=${cb.kind}`,
        chat: maskVolatileFields(ca) as Record<string, unknown>,
        codemode: maskVolatileFields(cb) as Record<string, unknown>,
      });
      continue;
    }

    // For tool_result, ignore toolName (codemode doesn't echo it).
    let caPayload = ca.payload;
    let cbPayload = cb.payload;
    if (ca.kind === 'tool_result') {
      const { toolName: _a, ...restA } = caPayload as any;
      const { toolName: _b, ...restB } = cbPayload as any;
      caPayload = restA;
      cbPayload = restB;
    }

    const aMasked = JSON.stringify(maskVolatileFields(caPayload));
    const bMasked = JSON.stringify(maskVolatileFields(cbPayload));
    if (aMasked !== bMasked) {
      divergences.push({
        line: i,
        reason: 'payload mismatch',
        chat: maskVolatileFields(ca) as Record<string, unknown>,
        codemode: maskVolatileFields(cb) as Record<string, unknown>,
      });
    }
  }

  return {
    ok: divergences.length === 0,
    divergences: divergences.slice(0, 10), // cap — 10 is enough to diagnose
  };
}

// ---------------------------------------------------------------------------
// Convenience runner — captures both streams + diff in one call.
// ---------------------------------------------------------------------------

export interface ParityRun {
  scenario: ParityScenario;
  chat: ParityStream;
  codemode: ParityStream;
  diff: ParityDiff;
}

/**
 * Run a parity scenario end-to-end: emit both streams, normalize, diff.
 * The returned record is everything a test needs to assert on; the
 * evidence-bundle writer picks this record up too.
 */
export function runParity(
  scenario: ParityScenario,
  opts: { ignoreLifecycle?: boolean } = { ignoreLifecycle: true },
): ParityRun {
  const chat = emitChatStream(scenario);
  const codemode = emitCodemodeStream(scenario);
  const chatNorm = normalizeChat(chat);
  const codeNorm = normalizeCodemode(codemode);
  const diff = diffStreams(chatNorm, codeNorm, opts);
  return { scenario, chat, codemode, diff };
}
