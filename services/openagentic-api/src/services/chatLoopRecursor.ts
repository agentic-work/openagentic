/**
 * chatLoopRecursor — execute a sub-agent task as a child chatLoop turn.
 *
 * Replaces the legacy in-api orchestrator's `orchestrate(prompt, tools)`
 * call for sub-agent dispatch (Phase E.8.d of the chat-pipeline refactor plan). A
 * sub-agent is simply a child chatLoop call with its own RunCtx (child
 * sequencer, agent-scoped model + system prompt), reusing the parent's
 * tool resolver, streamProvider, and AgentEventStore subscription.
 *
 * Why recursion and not a separate process: the parent already owns the
 * provider connection, the model registry warmup, the MCP proxy auth
 * surface, and the AgentEventStore subscription. A sub-agent that runs
 * "inside" the parent context inherits all of these without duplicating
 * any. The openagentic-proxy service (out-of-process) is the FUTURE path for
 * security-isolated dispatch (E.8.b-c); chatLoopRecursor is the IN-PROCESS
 * primitive the chat-side Task tool calls today.
 *
 * Architecture:
 *
 *   parent chatLoop -> TaskTool dispatch -> chatLoopRecursor
 *                                                  |
 *                                                  v
 *                                            child chatLoop
 *                                            (own RunCtx, child sequencer,
 *                                             agentSpec.model / systemPrompt,
 *                                             inherited streamProvider+dispatch)
 *
 * the design notes
 *
 * IMPORTANT — Phase E.8.d delivers ONLY the primitive + tests. Wiring
 * TaskTool to call this is E.8.e (separate slice). DO NOT extend.
 */
import { randomUUID } from 'node:crypto';
import { chatLoop } from '../routes/chat/pipeline/chat/chatLoop.js';
import type {
  RunCtx,
  ChatLoopDeps,
  ChatLoopInput,
} from '../routes/chat/pipeline/chat/types.js';
import { EventSequencer } from '../infra/event-sequencer.js';
import { AgentEventStore, getAgentEventStore } from './AgentEventStore.js';
import { publishAgentEvent } from './subagentEventPublish.js';

/**
 * Sub-agent specification handed to the recursor by its caller (typically
 * the chat-side Task meta-tool dispatcher).
 *
 * `tools` is the wildcard scope from the agent's frontmatter (e.g.
 * `['azure_*', 'aws_*']`); it's metadata only — the recursor does NOT
 * narrow the parent's resolved tool array based on this. Tool discovery
 * is the model's job via `tool_search`. Operators looking to BIAS what
 * the model can pull set the catalog at the parent level.
 *
 * `inheritedTools` (optional) is the EXACT OpenAI-shape tool defs the
 * child chatLoop will pass to its provider call. When omitted, the child
 * loop runs with an empty tools array. The caller is responsible for
 * choosing the right inheritance policy (e.g. "parent's resolved array",
 * "parent's meta-tools only", etc.). The recursor's job is plumbing,
 * not policy.
 */
export interface ChatLoopRecursorAgentSpec {
  /** Model to drive the child loop with. Falls through (empty string) when omitted. */
  model?: string;
  /** Domain-specific system prompt. Falls through (empty string) when omitted. */
  systemPrompt?: string;
  /** Wildcard scope from agent frontmatter — metadata, not a filter. */
  tools: string[];
  /** Exact tool defs the child loop should see. Empty by default. */
  inheritedTools?: ReadonlyArray<any>;
  /** Default 5. Passed through to chatLoop as `maxTurns`. */
  maxIterations?: number;
  /** Optional. Aborts the child loop and surfaces `{success:false, error}`. */
  timeoutMs?: number;
}

export interface ChatLoopRecursorOptions {
  /** Parent's RunCtx — used as the prototype for the child's RunCtx. */
  parentCtx: RunCtx;
  /** Parent's ChatLoopDeps — streamProvider + dispatch shared by reference. */
  parentDeps: ChatLoopDeps;
  /** Parent's EventSequencer — child sequencer is forked from this via `.child(agentId)`. */
  parentSequencer: EventSequencer;
  /**
   * Conversation-level identifier the chat-stream handler subscribed to.
   * Sub-agent lifecycle + tool events are published to the AgentEventStore
   * keyed on this id; the chat handler re-emits them as `agent_progress`
   * NDJSON frames so the UI draws nested sub-agent cards.
   */
  parentTurnId: string;
  /** Sub-agent specification. */
  agentSpec: ChatLoopRecursorAgentSpec;
  /** The sub-agent's actual task — becomes the child's userMessage. */
  userPrompt: string;
  /**
   * Test-only escape hatch. Production wiring uses `getAgentEventStore()`
   * (the module singleton); tests inject their own store to assert
   * publish behavior without leaking through the singleton.
   */
  __agentEventStoreForTests?: AgentEventStore;
}

export interface ChatLoopRecursorResult {
  success: boolean;
  /** Synthesized text the child loop produced (terminal text content). */
  result?: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
  /** Reserved — the child chatLoop does not surface usage today. */
  tokenUsage?: { input: number; output: number; total: number };
  error?: string;
}

/**
 * Execute a sub-agent task as a child chatLoop turn.
 *
 * The function is async and returns a single result envelope. Streaming
 * happens through the inherited `parentCtx.emit` + the published events
 * into the AgentEventStore — by the time the promise resolves, all child
 * events have already flowed to the parent stream.
 */
export async function chatLoopRecursor(
  options: ChatLoopRecursorOptions,
): Promise<ChatLoopRecursorResult> {
  const { parentCtx, parentDeps, parentSequencer, parentTurnId, agentSpec, userPrompt } = options;
  const startedAt = Date.now();

  // Derive a stable sub-agent id for sequencer multiplexing + AgentEventStore
  // event keying. We use a UUID prefix so concurrent sub-agents (parallel
  // Task dispatches in the same parent turn) get distinct streams.
  const agentId = `sub-${randomUUID().slice(0, 8)}`;

  // Fork the parent sequencer for the child loop. The child's EventSequencer
  // shares the parent's runId (so client gap-detection treats them as one
  // logical turn) but stamps every event with `_agentId` for fan-in.
  //
  // CONTRACT: parentSequencer.child(agentId) is the canonical pattern from
  // EventSequencer — do not invent a new fork mechanism.
  const childSequencer = parentSequencer.child(agentId);

  // Resolve the AgentEventStore. Tests inject their own; production uses
  // the singleton so the chat-stream handler's subscription (keyed on
  // parentTurnId) catches our publishes.
  const eventStore = options.__agentEventStoreForTests ?? getAgentEventStore();

  // Publish agent_start so the UI can draw the sub-agent's empty card
  // BEFORE the child loop emits its first text/tool delta.
  publishAgentEvent(eventStore, {
    turnId: parentTurnId,
    runId: childSequencer.runId,
    parentRunId: null,
    agentId,
    agentRole: agentSpec.systemPrompt ? 'subagent' : undefined,
    event: 'agent_start',
    payload: { model: agentSpec.model ?? '', prompt: userPrompt },
    timestamp: Date.now(),
  });

  // Build the child's RunCtx by copying the parent and stamping the
  // sequenced emit channel. The parent's emit is reused verbatim so child
  // text/tool/finish events flow into the same NDJSON stream the UI is
  // already drinking from. The sequencer's wrap() is applied via a thin
  // wrapper so child opcodes carry `_seq` + `_agentId`.
  //
  // Why wrap emit instead of replacing it: chatLoop emits typed payloads
  // (e.g. `{kind:'thinking', text}`) — we don't want to corrupt the
  // payload shape, so we only attach sequence metadata when the payload
  // is a plain object. String payloads (opcode '0' text deltas) pass
  // through unwrapped — the sequencer's metadata applies at the SSE
  // envelope layer (added by built-in hooks), not at the inner payload.
  const childCtx: RunCtx = {
    ...parentCtx,
    emit: (op: string, payload: any) => {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        // Stamp _agentId so the UI's nested-card reducer routes the event
        // to the right sub-agent card. _seq is supplied by EventSequencer.
        const wrapped = childSequencer.wrap({ ...payload, _agentId: agentId });
        parentCtx.emit(op, wrapped);
      } else {
        // Primitive payloads (string text deltas) — pass through and let
        // the parent's stream handler attribute them to the active
        // sub-agent via the lifecycle event ordering.
        parentCtx.emit(op, payload);
      }
    },
  };

  // Build the child chatLoop input. The child's `priorMessages` is empty
  // because the sub-agent task is a fresh ReAct loop — it does NOT inherit
  // the parent's conversation history. (Inheriting parent history would
  // leak unrelated context and blow the child's token budget.) The child's
  // sole input is the userPrompt under its own system prompt.
  const loopInput: ChatLoopInput = {
    userMessage: userPrompt,
    priorMessages: [],
    systemPrompt: agentSpec.systemPrompt ?? '',
    tools: agentSpec.inheritedTools ?? [],
    model: agentSpec.model ?? '',
    maxTurns: agentSpec.maxIterations ?? 5,
  };

  // Track the child loop's terminal text so we can surface it as `result`.
  // The child's emit channel sends `assistant_message_delta` payloads (and
  // opcode '0' text strings) — we tap the wrapped emit to capture text
  // without re-implementing the stream parser.
  let synthesizedText = '';
  const tappedCtx: RunCtx = {
    ...childCtx,
    emit: (op: string, payload: any) => {
      // Opcode '0' is the canonical text-delta envelope (Vercel opcode format).
      if (op === '0' && typeof payload === 'string') {
        synthesizedText += payload;
      }
      childCtx.emit(op, payload);
    },
  };

  // Race the child loop against the optional timeout. We use AbortController
  // semantics indirectly via a Promise.race — the child loop itself does not
  // currently observe an abort signal, but its stream provider should bail
  // when its inner request times out (Ollama/AIF/etc honor request-level
  // timeouts at the SDK layer). The result race ensures we surface a
  // {success:false, error} envelope even if the inner stream stalls past
  // the budget.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = agentSpec.timeoutMs
    ? new Promise<ChatLoopRecursorResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            success: false,
            error: `chatLoopRecursor timed out after ${agentSpec.timeoutMs}ms`,
            toolsUsed: [],
            iterations: 0,
            durationMs: Date.now() - startedAt,
          });
        }, agentSpec.timeoutMs);
      })
    : null;

  // Pass the parent's ChatLoopDeps verbatim. The streamProvider closure
  // already encodes the model registry + provider routing the parent set
  // up at session start; we don't need to re-resolve. The dispatch
  // function is also shared — tool calls from the child resolve through
  // the same dispatcher and respect the same DLP/HITL hooks if hooked at
  // the deps level.
  const childDeps: ChatLoopDeps = parentDeps;

  let loopResult: Awaited<ReturnType<typeof chatLoop>> | undefined;
  let loopError: Error | undefined;

  const runChildLoop = async (): Promise<ChatLoopRecursorResult> => {
    try {
      loopResult = await chatLoop(tappedCtx, loopInput, childDeps);
    } catch (err) {
      loopError = err as Error;
    }
    const durationMs = Date.now() - startedAt;
    if (loopError) {
      return {
        success: false,
        error: loopError.message,
        toolsUsed: [],
        iterations: 0,
        durationMs,
      };
    }
    const r = loopResult!;
    const success = r.ok;
    return {
      success,
      result: synthesizedText.length > 0 ? synthesizedText : undefined,
      toolsUsed: r.toolUses ?? [],
      iterations: r.turns ?? 0,
      durationMs,
      error: success ? undefined : r.error,
    };
  };

  const result = timeoutPromise
    ? await Promise.race([runChildLoop(), timeoutPromise])
    : await runChildLoop();
  if (timeoutHandle) clearTimeout(timeoutHandle);

  // Publish agent_complete so the UI can close the sub-agent card.
  publishAgentEvent(eventStore, {
    turnId: parentTurnId,
    runId: childSequencer.runId,
    parentRunId: null,
    agentId,
    event: 'agent_complete',
    payload: {
      success: result.success,
      iterations: result.iterations,
      toolsUsed: result.toolsUsed,
      durationMs: result.durationMs,
      error: result.error,
    },
    timestamp: Date.now(),
  });

  return result;
}
