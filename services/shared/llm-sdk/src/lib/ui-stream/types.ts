/**
 * UI Stream Frame + Content Block types — the wire+persistence SoT for the
 * OpenAgentic chat UI streaming pipeline (StreamEngine, applyCanonicalFrame
 * reducer, chat_messages.content_blocks Json column).
 *
 * Why this exists alongside the canonical `CanonicalEvent` / `AgenticEvent`
 * unions:
 *
 *   - `CanonicalEvent` (`./normalizers/CanonicalEvent.ts`) — the canonical
 *     Anthropic-shape event union every provider normalizer emits. Strict
 *     model-output subset (message_start, content_block_start/delta/stop,
 *     message_delta, message_stop). This is what the SDK's normalizers
 *     produce; downstream services can consume this directly.
 *
 *   - `AgenticEvent` (`./agentic-events/types.ts`) — the 14-layer SUPERSET
 *     of canonical + tool execution + sub-agents + HITL + artifacts + RAG
 *     + cost + flows + session events. Names match what the
 *     SDK would emit if the SDK owned the entire platform-wide event
 *     taxonomy.
 *
 *   - `UIStreamFrame` (this file) — the ACTUAL wire shape the
 *     openagentic-api emits today on `/api/chat/stream` NDJSON, AND the
 *     reduce-target the chat UI consumes via `applyCanonicalFrame` /
 *     `StreamEngine.applyFrame`. It's a structural superset of
 *     `CanonicalEvent` plus OpenAgentic's platform-specific extensions
 *     (`tool_result`, `tool_error`, `thinking_complete`, `stream_complete`,
 *     `visual_render`, `app_render`, `artifact_render`, `follow_up`,
 *     `tool_round_*`). The naming differs from `AgenticEvent` because the
 *     UI's wire dialect predates the AgenticEvent rename pass — see
 *     follow-up rip tickets in
 * the design notes
 *     §"Follow-up tickets".
 *
 *   - `UIContentBlock` (this file) — the persistence shape held in
 *     `chat_messages.content_blocks` Json column AND the in-memory
 *     accumulator the UI reducer produces. Each block represents one
 *     CHRONOLOGICAL slot in the assistant's interleaved narrative
 *     (thinking → text → tool_use → text → viz → text → ...). The
 *     persistence shape is what makes "live render == reload render"
 *     possible.
 *
 * Discipline (CLAUDE.md rule 8a — interleave invariant):
 *
 *   text/thinking blocks coalesce sibling deltas; a tool_use frame between
 *   two text bursts opens a NEW text block (does NOT merge with the
 *   previous one). The reducer enforces this via `closeOpenAccumulators`.
 *
 * the design notes
 */

import type { CanonicalContentBlock, CanonicalEvent } from '../normalizers/CanonicalEvent.js';

// ───────────────────────────────────────────────────────────────────────────
// Frame extensions — OpenAgentic wire-dialect frames that are not part of
// the strict-canonical event union but ARE part of the wire the api emits.
// ───────────────────────────────────────────────────────────────────────────

/** Server-emitted stream start (UI dialect). The strict-canonical equivalent
 *  is `message_start`; both carry the same lifecycle semantics. */
export interface UIStreamStartFrame {
  type: 'stream_start';
  /** Optional turn id. Carried through for replay / wire-capture analysis. */
  turn_id?: string;
  /** Optional ms-since-epoch timestamp. */
  _ts?: number;
}

/** Implicit close-current-thinking-block signal. Emitted by api between
 *  `content_block_delta { thinking_delta }` rounds when the model commits to
 *  prose / tool dispatch. The reducer closes the open thinking block. */
export interface UIThinkingCompleteFrame {
  type: 'thinking_complete';
  _ts?: number;
}

/** Implicit close-all-open-accumulators signal at end of stream. The
 *  strict-canonical equivalent is `message_stop`; the api emits both. */
export interface UIStreamCompleteFrame {
  type: 'stream_complete';
  _ts?: number;
}

/** Tool execution kickoff (UI dialect of `AgenticEvent.tool_executing`).
 *  The api emits this with `tool_use_id` AND `name` AND optional `input`.
 *  Note: the strict-canonical path uses `content_block_start { tool_use }`
 *  to open the same DB row; this frame is the platform-layer counterpart
 *  emitted when the executor (not the model) declares dispatch. */
export interface UIToolExecutingFrame {
  type: 'tool_executing';
  tool_use_id: string;
  name?: string;
  input?: unknown;
  /** Optional preview args string for UI display while args are still streaming. */
  args_preview?: string;
  _ts?: number;
}

/** Tool result envelope. UI's wire-dialect name for the SDK's
 *  `tool_completed` AgenticEvent. The `content` field carries the canonical
 *  `{ summary?, data? }` envelope shape the api stamps on every tool result.
 *  The reducer reads `content.summary` for the human-readable line AND
 *  `content.data` for the structured payload (rendered via JsonView). */
export interface UIToolResultFrame {
  type: 'tool_result';
  tool_use_id: string;
  content?: { summary?: string; data?: unknown } | string;
  /** Optional Phase-4 envelope slug — drives FrameRendererRegistry lookup. */
  outputTemplate?: string;
  /** Optional duration in ms (api stamps this when known). */
  durationMs?: number;
  _ts?: number;
}

/** Tool error envelope. UI's wire-dialect name for the SDK's `tool_failed`
 *  AgenticEvent. */
export interface UIToolErrorFrame {
  type: 'tool_error';
  tool_use_id: string;
  error?: string;
  durationMs?: number;
  _ts?: number;
}

/** Legacy tool-call-complete frame — older code path that emits the full
 *  resolved tool input in one shot AFTER all `input_json_delta`s. Newer
 *  pipeline uses `content_block_start { tool_use }` + `input_json_delta`
 *  + `content_block_stop`; this frame remains supported for back-compat. */
export interface UIToolCallCompleteFrame {
  type: 'tool_call_complete';
  id: string;
  name: string;
  input?: unknown;
  _ts?: number;
}

/** Inline visualization frame (UI dialect of `AgenticEvent.compose_visual`).
 *  Emitted as a single-shot frame; the `group_id` is the hot-swap key — a
 *  re-emit with the same `group_id` REPLACES the existing block at its
 *  current index (preserves chronological position). */
export interface UIVisualRenderFrame {
  type: 'visual_render';
  artifact_id: string;
  template?: string;
  /** Discriminant — drives renderer selection.
   *  Allowed: 'svg', 'html', 'reactflow_arch', 'arch_diagram', 'chart'. */
  kind?: string;
  /** The rendered payload — SVG string, chart-spec JSON-as-string, or HTML. */
  content: string;
  title?: string;
  caption?: string;
  group_id?: string;
  /** 1-3 short strings rotated while content is rendering. */
  loading_messages?: string[];
  _ts?: number;
}

/** Inline mini-app frame (UI dialect of `AgenticEvent.compose_app`).
 *  Emitted with the FULL validated HTML payload (CSP-nonce-gated by the
 *  api's composeAppValidator). Iframe srcdoc is the render target. */
export interface UIAppRenderFrame {
  type: 'app_render';
  artifact_id: string;
  html: string;
  title?: string;
  group_id?: string;
  /** True when the app requires the Pyodide bootstrap loaded inside the iframe. */
  pyodide_required?: boolean;
  /** Per-render CSP nonce supplied by the api validator; null when CSP-free. */
  nonce?: string | null;
  _ts?: number;
}

/** Inline generated-image frame (UI dialect of `AgenticEvent.generate_image`).
 *  Emitted single-shot AFTER the platform's image model generates a raster
 *  image and ImageStorageService persists it. `image_url` is ALWAYS a
 *  same-origin `/api/images/:id` path — NEVER an external host (the
 *  generate_image tool refuses to emit external URLs). */
export interface UIImageRenderFrame {
  type: 'image_render';
  artifact_id: string;
  /** Same-origin path served by routes/images.ts — e.g. /api/images/img_xxx.png */
  image_url: string;
  /** The prompt the image was generated from. Doubles as alt text. */
  prompt?: string;
  /** Resolved imageGen default model id. */
  model?: string;
  /** Provider that owns the imageGen model. */
  provider?: string;
  /** Raster format. */
  format?: string;
  /** Explicit alt text (defaults to prompt when absent). */
  alt?: string;
  group_id?: string;
  _ts?: number;
}

/** Generic artifact-render frame — discriminates to viz_render OR app_render
 *  based on `kind`. Kept as a separate frame type so the api can emit a
 *  single envelope and the reducer routes it. */
export interface UIArtifactRenderFrame {
  type: 'artifact_render';
  artifact_id: string;
  /** Discriminant — `react`/`html`/`python_plot` → app_render block;
   *  `svg` → viz_render block. */
  kind: string;
  content: string;
  title?: string;
  group_id?: string;
  _ts?: number;
}

/** End-of-turn follow-up chip row. Single-shot per turn (re-emit REPLACES
 *  the existing block). 0-5 items enforced by the reducer. */
export interface UIFollowUpFrame {
  type: 'follow_up';
  items: string[];
  _ts?: number;
}

/** Parallel-tool-call round envelope start. Wraps a burst of N
 *  `tool_executing` frames so the UI can render them as children of a
 *  single .tool-parallel card. */
export interface UIToolRoundStartFrame {
  type: 'tool_round_start';
  roundId: string;
  toolCount?: number;
  toolIds?: string[];
  toolNames?: string[];
  _ts?: number;
}

/** Parallel-tool-call round envelope end. Stamps duration + success counts. */
export interface UIToolRoundEndFrame {
  type: 'tool_round_end';
  roundId: string;
  succeeded?: number;
  failed?: number;
  durationMs?: number;
  _ts?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// UIStreamFrame — the discriminated union the chat UI's reducer + the
// StreamEngine consume directly.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Optional `_ts` (ms-since-epoch) is stamped on every frame the reducer
 * sees so block-startTime / duration math is replay-deterministic. The api
 * does NOT add `_ts` to the canonical-shape events it forwards (those are
 * pure Anthropic shape); the reducer falls back to `Date.now()`.
 *
 * Frames marked with `_ts?` here are the OpenAgentic-dialect extensions —
 * stamping these on the api side helps wire-capture reproducibility.
 */
export type UIStreamFrame =
  // Strict canonical model events — exact-shape matches from the SDK's
  // `CanonicalEvent` union. The UI reducer accepts them as-is + an
  // optional `_ts` stamp for replay determinism.
  | (CanonicalEvent & { _ts?: number })
  // OpenAgentic wire-dialect extensions (UI naming).
  | UIStreamStartFrame
  | UIThinkingCompleteFrame
  | UIStreamCompleteFrame
  | UIToolExecutingFrame
  | UIToolResultFrame
  | UIToolErrorFrame
  | UIToolCallCompleteFrame
  | UIVisualRenderFrame
  | UIAppRenderFrame
  | UIImageRenderFrame
  | UIArtifactRenderFrame
  | UIFollowUpFrame
  | UIToolRoundStartFrame
  | UIToolRoundEndFrame;

/**
 * Pragmatic loose superset — the UI reducer's `applyCanonicalFrame` accepts
 * `WireFrame { type: string; [k: string]: unknown }` so unknown future frame
 * types are forwarded through as no-ops rather than crashing the reducer.
 * Callers that want the strict discriminated form should narrow on `type`
 * via the `UIStreamFrame` union.
 */
export interface UIStreamFrameLoose {
  type: string;
  [k: string]: unknown;
}

// ───────────────────────────────────────────────────────────────────────────
// UIContentBlock — the persistence + render shape
// ───────────────────────────────────────────────────────────────────────────

/**
 * `UIContentBlock` is the SoT shape held in:
 *
 *   1. The UI reducer's in-memory `contentBlocks[]` slot — what
 *      `applyCanonicalFrame` produces.
 *   2. `chat_messages.content_blocks` Json column — what the api persists
 *      on `message_saved`.
 *   3. The reload-from-DB hydrate path — what `useChatHistory` reads back
 *      into `AgenticActivityStream`.
 *   4. The StreamEngine's `finalize().contentBlocks` return value.
 *
 * All four call sites speak the SAME shape, which is what makes "live
 * render == reload render" parity provable (see
 * `services/openagentic-ui/src/features/chat/streamEngine/__tests__/persistence-parity.test.ts`).
 *
 * Discriminant: `type`. Most fields are optional because different block
 * types use different subsets — kept as an open struct rather than a strict
 * discriminated union so callers don't need a switch-narrow on every read.
 * The `kind` literal union (svg | html | reactflow_arch | ...) IS strict
 * because the renderer dispatch table keys on it.
 *
 * Constructed inside the SDK so downstream services (api, ui, agenticode
 * CLI) all reference the SAME shape — no second SoT.
 */
export type UIContentBlockType =
  // Layer 1 — model-driven blocks
  | 'thinking'
  | 'text'
  | 'tool_use'
  // Legacy synonym for tool_use (kept for back-compat; new code uses tool_use).
  | 'tool_call'
  // Layer 2 — platform-driven rounded tool group
  | 'tool_round'
  // Layer 3 — artifact blocks (compose_visual / compose_app analogues)
  | 'viz_render'
  | 'app_render'
  // Inline generated raster image (generate_image analogue)
  | 'image_render'
  // Layer 4 — end-of-turn UI chips
  | 'follow_up';

/** Allowed kind discriminants for viz/app render dispatch. */
export type UIArtifactKind =
  | 'svg'
  | 'html'
  | 'reactflow_arch'
  | 'arch_diagram'
  | 'chart'
  | 'react'
  | 'python_plot';

export interface UIContentBlock {
  /** Unique ID for React key + DOM data-block-id (`block-{index}-{timestamp}`). */
  id: string;

  /** Server block index + reducer offset. Optional for synthesized blocks. */
  index?: number;

  /** Discriminant — drives renderer selection. */
  type: UIContentBlockType;

  /** Streaming prose content (text/thinking) OR JSON-stringified args
   *  (tool_use). On `tool_result`, the reducer overwrites this with
   *  `content.summary` for human-readable rendering. */
  content: string;

  /** Set to true on close (text/thinking via close-accumulator signals;
   *  tool_use on tool_result/tool_error; artifact blocks on emit). */
  isComplete: boolean;

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle metadata — used by the inline-thinking duration badge AND
  // the wall-clock-elapsed slot under each tool card.
  // ─────────────────────────────────────────────────────────────────────

  /** ms-since-epoch when the block started streaming. */
  startTime?: number;
  /** ms-since-epoch when the block was added. Same as startTime in practice. */
  timestamp?: number;
  /** ms elapsed from startTime to isComplete. Stamped on close. */
  duration?: number;

  // ─────────────────────────────────────────────────────────────────────
  // Tool-use block fields
  // ─────────────────────────────────────────────────────────────────────

  /** Server-side tool_use_id (`toolu_*`). */
  toolId?: string;
  /** Tool name (`aws_cost_query`, `azure_list_subs`, ...). */
  toolName?: string;
  /** Raw structured input args (object). Parallel to `content` (which is
   *  the JSON-stringified form). The UI's ToolCard JsonView reads from
   *  this directly to avoid a parse round-trip. */
  input?: unknown;
  /** Canonical `{summary?, data?}` envelope. */
  result?: unknown;
  /** Raw structured data payload (parallel to JSON-stringified `result`). */
  resultRaw?: unknown;
  /** Error string on tool_error. */
  error?: string;
  /** Most-recent tool_progress heartbeat message. */
  progressMessage?: string;
  /** Seconds since tool call started. */
  progressElapsed?: number;

  // ─────────────────────────────────────────────────────────────────────
  // Parallel tool-call round membership (#131 / #82)
  // ─────────────────────────────────────────────────────────────────────

  /** Round sequence number — incremented per parallel fan-out batch. */
  toolCallRound?: number;
  /** Stable slot index within a parallel round. DOM order is derived
   *  from this so cards don't reorder when tool_result events arrive
   *  out of order. */
  parallelSlotIndex?: number;

  // ─────────────────────────────────────────────────────────────────────
  // Sub-agent membership (spawn_parallel_agents children)
  // ─────────────────────────────────────────────────────────────────────

  /** Sub-agent id when this block was emitted under a spawned sub-agent. */
  agentId?: string;
  /** Sub-agent role description ("data_query", "synthesis", ...). */
  agentRole?: string;
  /** Parent tool_use block id (nesting). */
  parentToolId?: string;

  // ─────────────────────────────────────────────────────────────────────
  // tool_round container block fields (type: 'tool_round')
  // ─────────────────────────────────────────────────────────────────────

  /** Server-issued round id. */
  roundId?: string;
  /** Tool_use_ids contained in this round. */
  toolIds?: string[];
  /** Child blocks (tool_use members of the round). */
  children?: UIContentBlock[];
  /** Total wall-clock duration of the round. */
  durationMs?: number;
  /** Number of tool_use children that succeeded. */
  succeeded?: number;
  /** Number of tool_use children that errored. */
  failed?: number;

  // ─────────────────────────────────────────────────────────────────────
  // Phase 4 two-channel envelope outputTemplate slug
  // ─────────────────────────────────────────────────────────────────────

  /** FrameRendererRegistry lookup key for matching primitive
   *  (StreamingTable / Findings / SavingsCard / ...). */
  outputTemplate?: string;

  // ─────────────────────────────────────────────────────────────────────
  // Artifact-block fields (type: 'viz_render' | 'app_render')
  // ─────────────────────────────────────────────────────────────────────

  /** Owning tool_use id when the artifact was emitted alongside a tool call. */
  toolUseId?: string;
  /** Hot-swap key — replaces an existing block with the same groupId. */
  groupId?: string;
  /** Viz template name (sankey, arch_diagram, kpi_grid, ...). */
  template?: string;
  /** Kind discriminant — drives renderer selection. */
  kind?: UIArtifactKind;
  /** Display title for the badge / expanded chrome. */
  title?: string;
  /** Prose caption rendered under the expanded viz. */
  caption?: string;
  /** 1-3 short strings rotated while content is streaming. */
  loadingMessages?: string[];
  /** app_render only — full validated HTML payload for AppRenderer srcdoc. */
  html?: string;
  /** app_render only — Pyodide bootstrap required in the iframe. */
  pyodideRequired?: boolean;
  /** app_render only — per-render CSP nonce supplied by composeAppValidator. */
  nonce?: string | null;

  // ─────────────────────────────────────────────────────────────────────
  // image_render block fields (type: 'image_render')
  // ─────────────────────────────────────────────────────────────────────

  /** image_render only — same-origin /api/images/:id url for the <img> src.
   *  NEVER an external host (the generate_image tool refuses external URLs). */
  imageUrl?: string;
  /** image_render only — prompt the image was generated from (alt text). */
  prompt?: string;
  /** image_render only — resolved imageGen default model id. */
  model?: string;
  /** image_render only — provider that owns the imageGen model. */
  provider?: string;

  // ─────────────────────────────────────────────────────────────────────
  // follow_up block fields (type: 'follow_up')
  // ─────────────────────────────────────────────────────────────────────

  /** End-of-turn follow-up chip strings. 0..5 items (reducer-clamped). */
  items?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// Re-export the strict-canonical types so consumers of this module get a
// single import surface for "everything I need to render a chat stream".
// ───────────────────────────────────────────────────────────────────────────

export type { CanonicalContentBlock, CanonicalEvent };
