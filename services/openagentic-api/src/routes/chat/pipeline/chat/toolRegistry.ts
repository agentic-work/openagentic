/**
 * Chat toolRegistry — T1 catalog source-of-truth + concurrency-safe set.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §C.1
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md §Layer-2
 *
 * The T1 catalog (canonical order):
 *   tool_search · agent_search · Task · agent_send · agent_list · agent_stop ·
 *   read_large_result · web_search · web_fetch ·
 *   pattern_save · pattern_recall
 *
 * pattern_save / pattern_recall added 2026-05-11 — model self-curates a
 * memory of useful tool chains in the `learned_patterns` Milvus collection.
 * Exemplars (hints), NOT prescriptions — user-scoped + model-written from
 * successful workflows. Replaces a previously-considered `usecase_search`
 * with pre-baked tool_chain_yaml workflow recipes (rejected as anti-pattern
 * — ServiceNow/LangGraph/Zapier all proved pre-baked chains brittle).
 *
 * REMOVED from T1 (now discoverable via tool_search in mcp_tools index):
 *   compose_visual · compose_app · render_artifact · request_clarification ·
 *   browser_sandbox_exec · memorize · memory_search · delegate_to_agents ·
 *   synth_execute (renamed → synth).
 *
 * Concurrency-safe partitioning:
 *   - T1 baseline (hardcoded META_TOOL_CONCURRENCY_SAFE): tool_search /
 *     agent_search / read_large_result / web_search / web_fetch /
 *     pattern_recall — pure reads, always parallel-safe.
 *   - Task / agent_send / agent_list / agent_stop / synth — LIVE-classified
 *     as 'allow' by PermissionService.classifyName (sub-agent lifecycle
 *     against independent isolated sessions; mutation safety is the
 *     SUB-AGENT's concern). Coalesce into the parallel batch.
 *   - pattern_save — LIVE-classified 'ask' (persists state to learned_patterns
 *     Milvus collection), partitions into its own serial batch.
 *   - MCP tools: classifier.classifyName → 'allow' = safe, 'deny'/'ask' = serial.
 *
 * Live contract pinned by `__tests__/concurrency-safety-classification.test.ts`
 * (Sev-0 — T1 Task/agent_* tools must be concurrency-safe).
 */
import { TASK_TOOL } from '../../../../services/TaskTool.js';
import { TOOL_SEARCH_TOOL } from '../../../../services/ToolSearchTool.js';
import { AGENT_SEARCH_TOOL } from '../../../../services/AgentSearchTool.js';
import { AGENT_SEND_TOOL } from '../../../../services/AgentSendTool.js';
import { AGENT_LIST_TOOL } from '../../../../services/AgentListTool.js';
import { AGENT_STOP_TOOL } from '../../../../services/AgentStopTool.js';
import { READ_LARGE_RESULT_TOOL_DEF } from '../../../../services/ReadLargeResultTool.js';
import { WEB_SEARCH_TOOL } from '../../../../services/WebSearchTool.js';
import { WEB_FETCH_TOOL } from '../../../../services/WebFetchTool.js';
import { PATTERN_SAVE_TOOL } from '../../../../services/PatternSaveTool.js';
import { PATTERN_RECALL_TOOL } from '../../../../services/PatternRecallTool.js';
// 2026-05-24 — memory_search re-added to T1 catalog for #1085 (per-user RAG
// memory). The dispatch arm + Milvus semanticRecall layer were wired in
// commits 1-3 of #1085 but the TOOL DEFINITION wasn't being offered to the
// model, so any model that tried to recall (gpt-oss:20b, Sonnet, etc.) hit
// the #850 unknown-tool short-circuit and returned "tool not available."
// Live evidence: chat-dev 2026-05-24, mcp-tester user, model called
// memory_search → offeredCount=17, short-circuit fired, model apologized.
import { MEMORY_SEARCH_TOOL_DEF } from '../../../../services/MemorySearchTool.js';
// 2026-05-12 — visualization + clarification meta-tools brought BACK into
// T1 (was discovery-only, but tool_search wasn't reliably surfacing them
// for smaller models like gpt-oss:20b — model would fall back to mermaid).
import { COMPOSE_VISUAL_TOOL } from '../../../../services/ComposeVisualTool.js';
import { COMPOSE_APP_TOOL } from '../../../../services/ComposeAppTool.js';
import { RENDER_ARTIFACT_TOOL } from '../../../../services/RenderArtifactTool.js';
import { REQUEST_CLARIFICATION_TOOL } from '../../../../services/RequestClarificationTool.js';
// 2026-05-24 — generate_image brought BACK into the always-available meta-tool
// surface. It was deleted with the legacy ChatPipeline.ts in the #741 chatmode
// rip and never re-added; with no image-gen tool in the catalog the model
// fabricated `<img src="https://unsplash...">` tags instead of generating a
// real image. Sits next to compose_app so the model always sees it.
import { GENERATE_IMAGE_TOOL } from '../../../../services/GenerateImageTool.js';

export interface BuildChatToolArrayOptions {
  /** Pre-resolved MCP tools (no semantic top-K filter for chat). */
  mcpTools: ReadonlyArray<any>;
  /** Description body for the Task tool, generated from the live agent registry. */
  taskToolDescription: string;
  /**
   * The dispatching model id. When set, the Task tool is gated by
   * `shouldExposeTaskToolForModel(selectedModel)` — cheap/small models
   * physically don't see Task and can't dispatch sub-agents for trivial
   * one-tool queries. Unknown / undefined → fail-open (Task included).
   * See `services/modelTaskGate.ts` (#843, 2026-05-14).
   */
  selectedModel?: string;
}

/**
 * Single source of truth for the platform's T1 tool array — the 12
 * agentic primitives that ship as part of the openagentic-api image
 * (analogous to Claude Code's `getAllBaseTools()`).
 *
 * `taskToolDescription` is injected at call time so the Task tool's
 * description reflects the live agent registry. Pass `undefined` to
 * use the static default baked into TASK_TOOL.
 *
 * `includeTaskTool=false` excludes the Task sub-agent dispatcher from
 * the array. Used by `buildChatToolArray` when the dispatching model
 * fails `shouldExposeTaskToolForModel` (#843 capability gate).
 */
export function getAllBaseTools(
  taskToolDescription?: string,
  includeTaskTool: boolean = true,
): any[] {
  const taskTool = taskToolDescription
    ? {
        ...TASK_TOOL,
        function: { ...TASK_TOOL.function, description: taskToolDescription },
      }
    : TASK_TOOL;

  // Canonical order from spec §Layer-2. Discovery primitives first, then
  // sub-agent lifecycle, then IO primitives. pattern_save / pattern_recall
  // trail the IO block — they are memory primitives the model uses to
  // self-improve across sessions (exemplars from past successful chains).
  // `Task` is gated by `includeTaskTool` (#843 capability gate); the spread
  // keeps the canonical array-literal shape that arch tests rely on.
  return [
    TOOL_SEARCH_TOOL,
    AGENT_SEARCH_TOOL,
    ...(includeTaskTool ? [taskTool] : []),
    AGENT_SEND_TOOL,
    AGENT_LIST_TOOL,
    AGENT_STOP_TOOL,
    READ_LARGE_RESULT_TOOL_DEF,
    WEB_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    PATTERN_SAVE_TOOL,
    PATTERN_RECALL_TOOL,
    // #1085 — per-user RAG memory recall. Sibling of memorize (write side
    // routes via discovery / memorize tool). Dispatch arm wires both
    // AgentMemoryService.recall (Postgres substring) AND
    // MilvusMemoryService.searchUserMemories (per-user semantic vector).
    MEMORY_SEARCH_TOOL_DEF,
    // Always-available visualization + clarification meta-tools — the model
    // shouldn't need to discover these. Live capture 2026-05-12 with
    // gpt-oss:20b: "No tool in catalog for compose_visual" → fell back to
    // mermaid (model training-data bias) when discovery-only.
    COMPOSE_VISUAL_TOOL,
    COMPOSE_APP_TOOL,
    GENERATE_IMAGE_TOOL,
    RENDER_ARTIFACT_TOOL,
    REQUEST_CLARIFICATION_TOOL,
  ];
}

/**
 * Assemble the full tool array sent to the model on a chat turn.
 *
 *   T1     = getAllBaseTools(...)  (Task gated by selectedModel capability)
 *   MCP    = every enabled MCP tool, verbatim, in input order
 *   RESULT = [...T1, ...MCP]
 *
 * NO duplicate guard (the MCP layer guarantees unique names already).
 * NO intent-gated subsetting. NO regex on user content.
 *
 * Task tool gate (#843, 2026-05-14): when `selectedModel` is set, the
 * Task sub-agent dispatcher is included ONLY if the model passes the
 * structural capability check in `modelTaskGate.ts`. Small/cheap models
 * physically don't see Task and can't dispatch sub-agents for trivial
 * one-tool queries.
 */
export async function buildChatToolArray(
  opts: BuildChatToolArrayOptions,
): Promise<any[]> {
  const { shouldExposeTaskToolForModel } = await import('../../../../services/modelTaskGate.js');
  const includeTaskTool = await shouldExposeTaskToolForModel(opts.selectedModel);
  return [
    ...getAllBaseTools(opts.taskToolDescription, includeTaskTool),
    ...opts.mcpTools,
  ];
}

/**
 * Static safe-set for the T1 primitives. Read-only primitives run in
 * parallel; lifecycle / mutation primitives run serially.
 */
export const META_TOOL_CONCURRENCY_SAFE: ReadonlySet<string> = new Set([
  'tool_search',
  'agent_search',
  'read_large_result',
  'web_search',
  'web_fetch',
  'pattern_recall',
]);

/**
 * Permission classifier shape — minimal contract chat needs from
 * PermissionService. Returns the Claude-Code-style PermissionBehavior
 * (allow/deny/ask) for a tool name with no arg context.
 */
export interface RiskClassifier {
  classifyName: (toolName: string) => 'allow' | 'deny' | 'ask';
}

/**
 * Compute the concurrencySafeNames set for the current turn's tool array.
 * Combines:
 *   - T1 primitives from META_TOOL_CONCURRENCY_SAFE (static)
 *   - MCP tools where classifyName(name) === 'allow' (dynamic)
 *
 * Called once per turn in chatLoop right before partitionToolCalls.
 *
 * Note: classifyName runs without arg context for the SAFE-SET decision
 * because the partition is a coarse-grained yes/no — the per-call
 * PermissionService.evaluate (which sees actual args) still runs at
 * dispatch time.
 */
export function computeConcurrencySafeNames(
  tools: ReadonlyArray<any>,
  classifier: RiskClassifier,
): Set<string> {
  const safe = new Set<string>(META_TOOL_CONCURRENCY_SAFE);
  for (const t of tools) {
    const name = t?.function?.name;
    if (typeof name !== 'string') continue;
    if (safe.has(name)) continue;
    try {
      const behavior = classifier.classifyName(name);
      if (behavior === 'allow') safe.add(name);
    } catch {
      // Conservative default: if classifyName throws, treat as not-safe.
    }
  }
  return safe;
}
