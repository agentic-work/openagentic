/**
 * makeRunSubagentViaRecursor — chatLoopRecursor-backed `deps.runSubagent`
 * for the chat TaskTool.
 *
 * Phase E.8.e of the chat-pipeline refactor plan. The chat path's Task meta-tool
 * dispatches sub-agents through `deps.runSubagent(spec, parentCtx)`.
 * Before this slice, that dep was wired to the legacy `makeRunSubagent(...)`
 * from `buildChatV2Deps.ts`, which wrapped the in-api orchestrator service
 * slated for removal in Phase E.8.g.
 *
 * This factory replaces that wrap with a direct call into the recursor
 * primitive (chatLoopRecursor) — same TaskTool surface, no orchestrator
 * involvement. The legacy `makeRunSubagent` stays in the codebase only
 * for the V2-stub pipeline path (#741), gated by `useRecursor: false`.
 *
 * Two flavors:
 *
 *  - `makeRunSubagentViaRecursor({...})` — closure-binds the parent's
 *    per-turn handles (parentCtx, parentDeps, parentSequencer, parentTurnId)
 *    and returns a `runSubagent` fn that reuses them for every call. Use
 *    this INSIDE a per-turn driver (e.g. runChat) that already owns the
 *    handles.
 *
 *  - `makeRunSubagentViaRecursorPerCall({ getAgents, … })` — returns a
 *    `runSubagent` fn that pulls the per-turn handles off the `parentCtx`
 *    argument it receives at call time. The chat plugin's deps factory
 *    uses this shape because buildChatV2Deps runs at plugin init, before
 *    any per-turn handle exists. The chat handler stamps the handles onto
 *    `ctx.__parentDeps` / `ctx.__parentSequencer` / `ctx.__parentTurnId`
 *    before invoking the V2 dispatch; this fn reads them back.
 *
 * Architecture (sub-agent dispatch through TaskTool):
 *
 *   chat-side ToolUseBlock { name: "Task", input: {...} }
 *        │
 *        ▼  routes/chat/pipeline/chat/chatLoop.ts dispatches `Task`
 *        ▼  → deps.dispatch(ctx, {name:"Task", input}) — chat-loop side
 *        ▼  → executeTask(...) — TaskTool.ts:executeTask
 *        ▼  → deps.runSubagent(spec, ctx)
 *        │
 *        ▼  ← this factory's closure ←
 *        ▼  ┌─────────────────────────────────────────────────────────┐
 *        ▼  │ adapter: SubagentSpec → ChatLoopRecursorAgentSpec        │
 *        ▼  │   - spec.prompt        → userPrompt                      │
 *        ▼  │   - spec.role          → registry.agent_type             │
 *        ▼  │   - registry.body      → agentSpec.systemPrompt          │
 *        ▼  │   - registry.tools     → agentSpec.tools (metadata)      │
 *        ▼  │   - spec.model         → agentSpec.model (override)      │
 *        ▼  └─────────────────────────────────────────────────────────┘
 *        ▼
 *        ▼  chatLoopRecursor({ parentCtx, parentDeps, parentSequencer,
 *        ▼                     parentTurnId, agentSpec, userPrompt })
 *        ▼
 *        ▼  Returns ChatLoopRecursorResult → adapter → SubagentRunResult
 *
 * the design notes
 */
import { chatLoopRecursor } from './chatLoopRecursor.js';
import type {
  RunCtx,
  ChatLoopDeps,
} from '../routes/chat/pipeline/chat/types.js';
import type { EventSequencer } from '../infra/event-sequencer.js';
import type { AgentEventStore } from './AgentEventStore.js';
import type {
  SubagentSpec,
  SubagentRunResult,
} from './TaskTool.js';
import type { BuiltInAgentRegistryEntry } from './BuiltInAgentRegistry.js';

/**
 * Subset of the agent registry shape this factory consumes. The chat-side
 * deps closure passes `getBuiltInAgents` from BuiltInAgentRegistry; tests
 * pass a synchronous inline list. The shape is structural so we don't
 * tie the test harness to the full BuiltInAgentRegistryEntry surface
 * (description / display_name are unused here).
 */
export interface RecursorAgentLookupEntry {
  agent_type: string;
  /** The agent's system prompt body — becomes the child loop's `system`. */
  body: string;
  /** Wildcard tool scope (metadata, not a filter). */
  tools: string[];
}

export interface MakeRunSubagentViaRecursorOptions {
  /** Parent turn's RunCtx (emit + logger + sessionId + userId). */
  parentCtx: RunCtx;
  /** Parent turn's ChatLoopDeps — streamProvider + dispatch shared by reference. */
  parentDeps: ChatLoopDeps;
  /** Parent turn's EventSequencer — child sequencer is forked from this. */
  parentSequencer: EventSequencer;
  /**
   * Conversation-level identifier for AgentEventStore keying. The chat
   * handler is subscribed on this id; sub-agent lifecycle events flow
   * through the parent NDJSON stream as `agent_progress` frames.
   */
  parentTurnId: string;
  /**
   * Lookup over the canonical agent registry. Synchronous so dispatch
   * stays fast — production wires `getBuiltInAgents()` from
   * BuiltInAgentRegistry; tests pass an inline array.
   */
  getAgents: () => ReadonlyArray<RecursorAgentLookupEntry | BuiltInAgentRegistryEntry>;
  /**
   * Default chatLoopRecursor `maxIterations` when spec doesn't carry an
   * override. Recursor's own default is 5; this allows the chat path to
   * tighten it (e.g. real-provider smoke uses 1).
   */
  defaultMaxIterations?: number;
  /**
   * Default chatLoopRecursor `timeoutMs` when spec doesn't carry an
   * override. Omitted → no timeout race in the recursor.
   */
  defaultTimeoutMs?: number;
  /**
   * Test-only escape hatch threaded into chatLoopRecursor. Production
   * wiring leaves this undefined; the recursor falls through to the
   * AgentEventStore module singleton.
   */
  __agentEventStoreForTests?: AgentEventStore;
}

/**
 * Build the `runSubagent(spec, parentCtx)` function that TaskTool's
 * `deps.runSubagent` slot expects. The returned function is closure-bound
 * to the parent turn's wiring (ctx + deps + sequencer + turnId + registry).
 * Sub-agent dispatch executes in-process via chatLoopRecursor — no
 * orchestrator, no separate process.
 */
export function makeRunSubagentViaRecursor(
  opts: MakeRunSubagentViaRecursorOptions,
): (spec: SubagentSpec, _parentCtxIgnored?: any) => Promise<SubagentRunResult> {
  const {
    parentCtx,
    parentDeps,
    parentSequencer,
    parentTurnId,
    getAgents,
    defaultMaxIterations,
    defaultTimeoutMs,
    __agentEventStoreForTests,
  } = opts;

  return async (spec: SubagentSpec, _parentCtxIgnored?: any): Promise<SubagentRunResult> => {
    // Resolve the requested role against the registry. Try exact match
    // first, then the legacy `_` → `-` substitution form some prompts
    // emit (e.g. `cloud_operations` vs `cloud-operations`). The legacy
    // dispatch path tolerated both shapes; we keep the back-compat
    // surface so the model isn't trained off a slug it can no longer hit.
    const requestedRole = (spec.role ?? '').trim();
    const altRole = requestedRole.replaceAll(/_/g, '-');
    let agent: RecursorAgentLookupEntry | BuiltInAgentRegistryEntry | undefined;
    try {
      const agents = getAgents();
      agent =
        agents.find((a) => a.agent_type === requestedRole) ??
        agents.find((a) => a.agent_type === altRole);
    } catch {
      // Registry lookup blew up — fall through to "unknown agent" error
      // so the model sees a structured failure and can pick a different
      // sub-agent. Crashing the whole turn over a registry blip is the
      // anti-pattern the legacy path had.
      agent = undefined;
    }

    if (!agent) {
      return {
        ok: false,
        error: `unknown agent type: ${requestedRole}`,
        turns: 0,
        tokens: 0,
        durationMs: 0,
        toolsUsed: [],
      };
    }

    // Adapter: SubagentSpec → ChatLoopRecursorAgentSpec. Only fields the
    // recursor knows about cross the boundary; the rest of SubagentSpec
    // (parentSessionId / parentUserId / background) is owned by the
    // TaskTool layer and is implicit in the closure's parentCtx.
    const agentSpec = {
      // spec.model wins when supplied; otherwise the recursor's empty-
      // string fallthrough applies (controller resolves a model in the
      // parent's resolveChatModel layer). NO platform-side coercion.
      model: spec.model,
      systemPrompt: agent.body,
      tools: agent.tools ?? [],
      // No materialized tool defs at dispatch — sub-agent discovers tools
      // mid-turn via tool_search (T1 architecture). The recursor passes
      // an empty `inheritedTools` through to the child chatLoop. Spec
      // 2026-05-10 the three-layer prompt architecture §sub-agents.
      inheritedTools: [],
      maxIterations: defaultMaxIterations,
      timeoutMs: defaultTimeoutMs,
    };

    const startedAt = Date.now();
    const result = await chatLoopRecursor({
      parentCtx,
      parentDeps,
      parentSequencer,
      parentTurnId,
      agentSpec,
      userPrompt: spec.prompt,
      __agentEventStoreForTests,
    });

    // Adapter: ChatLoopRecursorResult → SubagentRunResult. The recursor
    // returns `success` (boolean) and `result` (text); TaskTool's
    // `runSubagent` contract returns `ok` and `output`. tokens stays 0
    // for now — chatLoop doesn't surface usage; same legacy gap.
    return {
      ok: result.success,
      output: result.result,
      error: result.error,
      turns: result.iterations,
      tokens: result.tokenUsage?.total ?? 0,
      durationMs: result.durationMs ?? Date.now() - startedAt,
      toolsUsed: result.toolsUsed ?? [],
    };
  };
}

// ---------------------------------------------------------------------------
// Per-call variant — for plugin-init-level wiring (buildChatV2Deps)
// ---------------------------------------------------------------------------

/**
 * Convention slot names the chat handler stamps onto the per-turn RunCtx
 * before invoking the V2 dispatch path. Exported so the chat handler /
 * runChat can stamp via the same constants and the type stays accurate
 * across re-imports.
 *
 * Why a side-channel rather than extending RunCtx: the existing
 * RunCtx is the public sub-agent context surface (used in many other
 * code paths that don't need recursor wiring). The recursor-specific
 * handles are an internal contract between the chat handler and this
 * factory; using prefixed slot names keeps RunCtx itself clean.
 */
export const RECURSOR_CTX_SLOTS = Object.freeze({
  parentDeps: '__parentDeps',
  parentSequencer: '__parentSequencer',
  parentTurnId: '__parentTurnId',
  /**
   * Sev-1 audit fix 2026-05-12 — current sub-agent recursion depth.
   * Top-level chat turn: undefined (treated as 0). Each
   * `chatLoopRecursor` invocation increments on the child ctx so
   * grandchild calls see depth=2. The per-call factory below caps
   * at `OPENAGENTIC_MAX_SUBAGENT_DEPTH` (default 2) — child dispatch
   * is REJECTED before recursion when the cap would be exceeded.
   */
  subagentDepth: '__subagentDepth',
} as const);

/**
 * Max sub-agent recursion depth. Top-level chat → 1 sub-agent (depth 1)
 * → 1 nested sub-agent (depth 2) is allowed by default. The third level
 * (depth 3) is REJECTED. Override via env for special cases.
 */
function getMaxSubagentDepth(): number {
  const raw = Number.parseInt(process.env.OPENAGENTIC_MAX_SUBAGENT_DEPTH || '2', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

export interface MakeRunSubagentViaRecursorPerCallOptions {
  /**
   * Synchronous accessor to the canonical agent registry. The chat
   * plugin wires `getBuiltInAgents()` here; tests pass an inline array.
   */
  getAgents: () => ReadonlyArray<RecursorAgentLookupEntry | BuiltInAgentRegistryEntry>;
  /** Default recursor `maxIterations` when spec doesn't supply one. */
  defaultMaxIterations?: number;
  /** Default recursor `timeoutMs` when spec doesn't supply one. */
  defaultTimeoutMs?: number;
  /** Test-only AgentEventStore override forwarded to the recursor. */
  __agentEventStoreForTests?: AgentEventStore;
}

/**
 * Build a `runSubagent(spec, parentCtx)` fn whose per-turn handles
 * (parentDeps + parentSequencer + parentTurnId) are pulled off the
 * `parentCtx` argument at CALL time. Used by buildChatV2Deps because
 * it runs at plugin init, before any per-turn state exists.
 *
 * Contract: the caller (chat handler / runChat) MUST stamp the per-turn
 * handles onto the ctx before invoking the V2 dispatch:
 *
 *   ctx[RECURSOR_CTX_SLOTS.parentDeps] = ChatLoopDeps;
 *   ctx[RECURSOR_CTX_SLOTS.parentSequencer] = EventSequencer;
 *   ctx[RECURSOR_CTX_SLOTS.parentTurnId] = turnId;
 *
 * When any handle is missing, the runSubagent fn returns
 * `{ ok: false, error: /not wired/i }` so the model sees a structured
 * failure and can fall back to a direct tool call rather than crashing
 * the turn. This degrades cleanly during incremental rollout — older
 * call sites that haven't stamped the slots get a clear error instead
 * of a silent infinite loop.
 */
export function makeRunSubagentViaRecursorPerCall(
  opts: MakeRunSubagentViaRecursorPerCallOptions,
): (spec: SubagentSpec, parentCtx?: any) => Promise<SubagentRunResult> {
  return async (spec: SubagentSpec, parentCtx?: any): Promise<SubagentRunResult> => {
    if (!parentCtx) {
      return {
        ok: false,
        error:
          'sub-agent dispatch via recursor not wired — parentCtx is undefined. ' +
          'Caller must pass the per-turn RunCtx with parentDeps/parentSequencer/parentTurnId stamped on.',
        turns: 0,
        tokens: 0,
        durationMs: 0,
        toolsUsed: [],
      };
    }
    const parentDeps = parentCtx[RECURSOR_CTX_SLOTS.parentDeps] as
      | import('../routes/chat/pipeline/chat/types.js').ChatLoopDeps
      | undefined;
    const parentSequencer = parentCtx[RECURSOR_CTX_SLOTS.parentSequencer] as
      | EventSequencer
      | undefined;
    const parentTurnId = parentCtx[RECURSOR_CTX_SLOTS.parentTurnId] as
      | string
      | undefined;
    const missing: string[] = [];
    if (!parentDeps) missing.push('parentDeps');
    if (!parentSequencer) missing.push('parentSequencer');
    if (!parentTurnId) missing.push('parentTurnId');
    if (missing.length > 0) {
      return {
        ok: false,
        error:
          `sub-agent dispatch via recursor not wired — parentCtx is missing: ${missing.join(', ')}. ` +
          'Stamp the per-turn handles via RECURSOR_CTX_SLOTS before invoking dispatch.',
        turns: 0,
        tokens: 0,
        durationMs: 0,
        toolsUsed: [],
      };
    }

    // Sev-1 fix 2026-05-12 — sub-agent recursion depth cap. The child
    // dispatch we're about to make would land at `currentDepth + 1`.
    // Reject if that would exceed the configured max. The model sees a
    // structured failure and can pick a non-recursive approach.
    const currentDepth = (parentCtx[RECURSOR_CTX_SLOTS.subagentDepth] as number | undefined) ?? 0;
    const maxDepth = getMaxSubagentDepth();
    const childDepth = currentDepth + 1;
    if (childDepth > maxDepth) {
      return {
        ok: false,
        error:
          `sub-agent recursion depth limit exceeded (current=${currentDepth}, ` +
          `child would be ${childDepth}, max=${maxDepth}). ` +
          'Pick a different approach — finish the work in the current agent, or ' +
          'override via OPENAGENTIC_MAX_SUBAGENT_DEPTH.',
        turns: 0,
        tokens: 0,
        durationMs: 0,
        toolsUsed: [],
      };
    }
    // Sev-1 fix 2026-05-12 race — clone parentCtx into a per-call
    // childCtx with the new depth stamped on the CLONE, not the
    // original. Mutating parentCtx caused parallel sub-agent dispatch
    // siblings to all see the same childDepth (race: A reads 0, B reads
    // 0, A writes 1, B writes 1, both pass 1 to recursor; grandchildren
    // then all classify as depth=2 even when only one level deep).
    //
    // Shallow clone is enough — the slot values (parentDeps,
    // parentSequencer, parentTurnId) are references, but `subagentDepth`
    // is a primitive that's now per-call-scoped. The recursor's own
    // spread into childCtx (chatLoopRecursor.ts:171) carries the depth
    // forward to grandchildren via the spread; that path still works.
    const childCtxWithDepth = {
      ...parentCtx,
      [RECURSOR_CTX_SLOTS.subagentDepth]: childDepth,
    };

    const runSubagent = makeRunSubagentViaRecursor({
      parentCtx: childCtxWithDepth,
      parentDeps: parentDeps!,
      parentSequencer: parentSequencer!,
      parentTurnId: parentTurnId!,
      getAgents: opts.getAgents,
      defaultMaxIterations: opts.defaultMaxIterations,
      defaultTimeoutMs: opts.defaultTimeoutMs,
      __agentEventStoreForTests: opts.__agentEventStoreForTests,
    });
    // Pass the per-call clone (with stamped depth) so grandchildren read
    // the right depth — NOT the original parentCtx (which would lose the
    // stamp under parallel dispatch).
    return runSubagent(spec, childCtxWithDepth);
  };
}
