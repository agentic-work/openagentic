/**
 * sdkAdapter — force-close logic for openagentic stream-json top-level events.
 *
 * Mirrors the pattern in /home/trent/anthropic/src/remote/sdkMessageAdapter.ts
 * from claude-code proper. The key invariant: once a `result` (or `error`)
 * top-level record arrives, the in-flight assistant message must be
 * fully closed — every thinking block set `streaming=false`, every
 * tool_use block set `streaming=false` with its partial input parsed,
 * including nested sub-transcripts inside Task tool blocks.
 *
 * Before this helper existed, the reducer in useCodeModeChat set
 * `message.streaming = false` on result but left inner block.streaming
 * = true when the daemon dropped the corresponding content_block_stop
 * events (which happens under network flakes, compaction, mid-turn
 * daemon restarts, and when /v1/messages returns before the stream
 * buffer fully drains). The UI then rendered "Agent is working…"
 * indefinitely because every reducer pass saw at least one open block.
 * That's the #249 "result frame doesn't render response" bug.
 *
 * Spec references:
 *   docs/core/openagentic-ccr-implementation.md §6 row 6
 *   /home/trent/anthropic/src/remote/sdkMessageAdapter.ts (isSessionEndMessage)
 *   /home/trent/anthropic/src/remote/SessionsWebSocket.ts (reconnect policy)
 */

import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
} from '../types/uiState';

/**
 * Attempt to parse a partial_json accumulator as JSON. Returns the parsed
 * object on success, undefined otherwise.
 *
 * Two paths:
 *   1. Fast path — the whole string is a single, non-empty JSON object.
 *      Covers the well-behaved Anthropic-SDK case (`{"a":1}`).
 *   2. Slow path — the AIF Responses API quirk where `input_json_delta`
 *      arrives as `{}{"todos":[...]}` (an empty-object prefix concatenated
 *      with the real payload, sometimes multiple prefixes — `{}{}{...}`).
 *      We walk top-level object boundaries and return the first non-empty
 *      object. Without this, ActiveTaskBar never sees todos and the
 *      generic tool_use card falls back to rendering the raw stream text.
 */
export function tryParseInput(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  // Fast path
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    ) {
      return parsed as Record<string, unknown>;
    }
    // Fall through for empty {} (could be noise prefix) or non-object literals.
  } catch {
    // Not a single object — could be `{}{real}` concatenation. Fall through.
  }
  // Slow path: walk top-level object boundaries.
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const slice = raw.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          if (
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            Object.keys(parsed).length > 0
          ) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          /* skip malformed slice */
        }
        start = -1;
      }
    }
  }
  return undefined;
}

/**
 * Close every open block on a single assistant message (recursively
 * through Task-tool subBlocks). Returns the same reference when nothing
 * needed closing — lets callers skip a React re-render when the turn
 * ended cleanly.
 *
 * Mutation-safe: returns a NEW AssistantChatMessage when any block was
 * closed, so React identity comparison works.
 */
export function forceCloseMessageBlocks(
  msg: AssistantChatMessage,
): AssistantChatMessage {
  const { nextBlocks, changed } = closeBlocks(msg.blocks);
  if (!changed && !msg.streaming) return msg;
  return {
    ...msg,
    blocks: changed ? nextBlocks : msg.blocks,
    streaming: false,
  };
}

/**
 * Recursive helper: walks a block list, close each block that's still
 * marked streaming, recurses into nested subBlocks on Task tool_use
 * parents. Returns a new array only if anything changed.
 */
function closeBlocks(blocks: AssistantBlock[]): {
  nextBlocks: AssistantBlock[];
  changed: boolean;
} {
  let changed = false;
  const nextBlocks = blocks.map((b): AssistantBlock => {
    if (b.kind === 'text') return b; // text has no streaming flag
    if (b.kind === 'thinking') {
      if (!b.streaming) return b;
      changed = true;
      return { ...b, streaming: false };
    }
    // tool_result / todo / inkdom_view / boundary / parallel_group blocks
    // have no streaming flag — return as-is. inkdom_view's lifecycle is
    // driven by ui_close from the daemon; the assistant-message close
    // sweep doesn't touch it. boundary and parallel_group are virtual
    // blocks (boundary has no children; parallel_group's children are
    // grouped by the renderer, not flagged streaming individually).
    if (
      b.kind === 'tool_result' ||
      b.kind === 'todo' ||
      b.kind === 'inkdom_view' ||
      b.kind === 'boundary' ||
      b.kind === 'parallel_group'
    ) return b;
    // tool_use
    const t = b;
    let innerChanged = false;
    let nextSub = t.subBlocks;
    if (t.subBlocks && t.subBlocks.length > 0) {
      const sub = closeBlocks(t.subBlocks);
      if (sub.changed) {
        innerChanged = true;
        nextSub = sub.nextBlocks;
      }
    }
    // Parse partialInputJson one last time in case the delta stream
    // ended without a content_block_stop for this tool.
    const nextInput =
      t.input !== undefined ? t.input : tryParseInput(t.partialInputJson);

    const needsClose = t.streaming || (nextInput && !t.input) || innerChanged;
    if (!needsClose) return t;
    changed = true;
    return {
      ...t,
      streaming: false,
      input: nextInput ?? t.input,
      subBlocks: nextSub,
    };
  });
  return { nextBlocks, changed };
}

/**
 * Force-close every assistant message in a list that is still flagged
 * `streaming: true`. Defensive sweep that runs on result/error so the
 * UI never shows the inline activity heartbeat after a turn ends, even
 * if the per-id match in the reducer missed (gpt-oss:20b sometimes
 * emits a result whose match-id differs from the in-flight message_start
 * id; without this sweep the heartbeat hangs forever).
 *
 * Returns the SAME reference when nothing changed so React identity
 * comparison still skips re-renders for callers that rely on it.
 */
export function closeAllStreamingAssistants(
  messages: ChatMessage[],
): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.role !== 'assistant') return m;
    const am = m as AssistantChatMessage;
    if (!am.streaming) return m;
    changed = true;
    return forceCloseMessageBlocks(am);
  });
  return changed ? next : messages;
}

/**
 * Returns true if the top-level event marks the end of the current
 * assistant turn. Mirrors claude-code's
 * `/home/trent/anthropic/src/remote/sdkMessageAdapter.ts::isSessionEndMessage`.
 *
 * Openagentic emits two terminal envelopes:
 *   - `{ type: 'result', subtype: 'success' | 'error' | 'error_max_turns' }`
 *   - `{ type: 'error', message: string }` (transport/daemon errors)
 * Both release the in-flight assistant message from streaming state.
 */
export function isSessionEndEvent(event: { type: string }): boolean {
  return event.type === 'result' || event.type === 'error';
}

/**
 * Human-readable elapsed-time label used by the running tool card.
 * Below 60 seconds: `12s`. Below an hour: `2m 05s`. Otherwise: `1h 23m`.
 * Matches the label density claude.ai/code shows for long-running
 * Bash/Task cards (no sub-second precision — the indicator is a
 * liveness signal, not a stopwatch).
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const minRem = m % 60;
  return minRem === 0 ? `${h}h` : `${h}h ${minRem}m`;
}

/**
 * System event envelopes emitted by openagentic during a live turn that
 * aren't the `init` banner. Each carries a subtype discriminator.
 * Shape mirrors claude-code's SDKSystemMessage union
 * (/home/trent/anthropic/src/entrypoints/sdk/coreTypes.generated.ts).
 */
export interface StatusSystemEvent {
  type: 'system';
  subtype: 'status';
  /** 'compacting' during context compression, or other short-lived states. */
  status?: string;
  uuid?: string;
}

export interface CompactBoundarySystemEvent {
  type: 'system';
  subtype: 'compact_boundary';
  compact_metadata?: {
    pre_tokens?: number;
    post_tokens?: number;
    trigger?: string; // 'auto' | 'manual'
  };
  uuid?: string;
}

/**
 * Convert a mid-turn system-status event into a user-facing summary
 * string. Returns null when the event is unknown or has no actionable
 * payload — caller should not inject a SystemChatMessage in that case.
 *
 * Mirrors the string choices in claude-code's
 * `sdkMessageAdapter.convertStatusMessage` +
 * `convertCompactBoundaryMessage` so the UX reads identically to
 * claude.ai/code.
 */
export function summarizeSystemEvent(event: {
  type: string;
  subtype?: string;
  status?: string;
  compact_metadata?: { pre_tokens?: number; post_tokens?: number; trigger?: string };
}): string | null {
  if (event.type !== 'system') return null;
  if (event.subtype === 'status') {
    if (event.status === 'compacting') return 'Compacting conversation…';
    if (!event.status) return null;
    return `Status: ${event.status}`;
  }
  if (event.subtype === 'compact_boundary') {
    const meta = event.compact_metadata;
    if (meta?.pre_tokens != null && meta?.post_tokens != null) {
      const trimmed = meta.pre_tokens - meta.post_tokens;
      if (trimmed > 0) {
        const fmt = (n: number) =>
          n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
        return `Conversation compacted — trimmed ${fmt(trimmed)} tokens`;
      }
    }
    return 'Conversation compacted';
  }
  return null;
}

/**
 * Map a daemon `system/init` (a.k.a. session_info) event payload onto
 * the UI's sessionMeta shape. Pure; tested directly.
 *
 * The input is intentionally typed loosely — the daemon adds new
 * fields over time (budget_cap_usd, _detail, etc.) and we want this
 * helper to remain forward-compatible. Anything missing maps to the
 * type-appropriate empty value, NEVER a hardcoded sentinel like
 * `/app` or `$5`. Cells that genuinely have no data render an
 * em-dash downstream.
 */
export interface SessionMetaShape {
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
  agents: string[];
  skills: string[];
  plugins: string[];
  slashCommands: string[];
  cwd: string;
  permissionMode: string;
  openagenticVersion: string;
  budgetCapUsd: number | null | undefined;
  /**
   * Rich init payload from the daemon's `_detail` field. Carries the
   * full per-section listings (tools[].description, mcp_servers[].url,
   * agents[].path, etc.) the React modals render. Pinned to the SDK
   * `SDKSystemInitDetail` shape so consumer modals (CodeModeChatView's
   * ToolsModal, MCPModal, etc.) see fully-typed properties.
   */
  detail?: import('../types/_sdk-bindings').SystemInitDetail;
}

/**
 * Legacy/rich plugin shape: openagentic v0.6.3 emits `string[]` (the
 * plugin name list); newer daemons emit `Array<{ name, path, source? }>`
 * via `SDKSystemMessage`. The session-meta projection accepts both —
 * the metadata strip downstream renders names only, so the richer
 * objects collapse via `extractPluginName()`.
 */
type PluginInitItem = string | { name: string; path?: string; source?: string };

export interface SystemInitLike {
  type?: string;
  subtype?: string;
  cwd?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  permissionMode?: string;
  slash_commands?: string[];
  openagentic_version?: string;
  agents?: string[];
  skills?: string[];
  plugins?: PluginInitItem[];
  budget_cap_usd?: number | null;
  _detail?: unknown;
}

function extractPluginName(item: PluginInitItem): string {
  return typeof item === 'string' ? item : item.name;
}

export function sessionMetaFromInit(sys: SystemInitLike): SessionMetaShape {
  return {
    tools: sys.tools ?? [],
    mcpServers: sys.mcp_servers ?? [],
    agents: sys.agents ?? [],
    skills: sys.skills ?? [],
    plugins: (sys.plugins ?? []).map(extractPluginName),
    slashCommands: sys.slash_commands ?? [],
    cwd: sys.cwd ?? '',
    permissionMode: sys.permissionMode ?? '',
    openagenticVersion: sys.openagentic_version ?? '',
    budgetCapUsd: sys.budget_cap_usd,
    // The daemon's `_detail` is opaque on the wire (typed `unknown` in
    // SystemInitLike) but in practice carries the SDKSystemInitDetail
    // shape. Cast at the boundary; consumers downstream deconstruct
    // by field with optional chaining so a malformed payload doesn't
    // crash — it just renders empty modal lists.
    detail: sys._detail as import('../types/_sdk-bindings').SystemInitDetail | undefined,
  };
}
