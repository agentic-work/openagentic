/**
 * streamTypes — shared type definitions for the chat streaming engine.
 *
 * Pure, leaf module: declares the ContentBlock alias, the wire frame
 * shapes, and the hook options contract. Imports nothing from
 * `useChatStream` (which re-exports these names for back-compat) so there
 * is no import cycle. Extracted from `useChatStream.ts` (behaviour-preserving
 * decomposition; the stateful hook body is unchanged).
 */
import type { UIContentBlock } from '@agentic-work/llm-sdk';
import type { ChatMessage } from '@/types/index';

// Pipeline stages from ChatPipeline backend
export type PipelineStage = 'auth' | 'validation' | 'prompt' | 'mcp' | 'completion' | 'response';

// Pipeline state to track current processing phase
export interface PipelineState {
  currentStage: PipelineStage | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Animation modes for streaming - simplified
export type AnimationMode = 'smooth' | 'none';
/**
 * Content block for interleaved thinking. F1 (2026-05-18) — this is now a
 * strict re-export of `UIContentBlock` from `@agentic-work/llm-sdk`. The
 * SDK owns the SoT shape; the alias here keeps the ~30 existing call sites
 * importing `ContentBlock` from `useChatStream` working with zero source
 * changes. New code should import `UIContentBlock` directly from
 * `@agentic-work/llm-sdk`.
 *
 * The SDK shape is a structural superset of the legacy local interface —
 * every previously-typed field exists on `UIContentBlock` with identical
 * semantics. See:
 *   - SDK SoT:   openagentic-sdk/src/lib/ui-stream/types.ts (UIContentBlock)
 *   - Follow-up: the design notes
 *                §"Follow-up tickets" (F1+F2 deeper rip)
 */
export type ContentBlock = UIContentBlock;
/**
 * Wire-in D (#82) — tool_round container block. The chat pipeline wraps
 * a batch of parallel tool_executing / tool_complete frames with a
 * tool_round_start / tool_round_end envelope so the UI can render them
 * as children of a single .tool-parallel card (mock 01-cloud-ops).
 */
export interface ToolRoundBlock extends ContentBlock {
  type: 'tool_round';
  roundId: string;
  toolIds: string[];
  children: ContentBlock[];
  isComplete: boolean;
  startTime?: number;
  durationMs?: number;
  succeeded?: number;
  failed?: number;
}

/**
 * Minimal structural type for the frames applyRoundFrame consumes. The
 * real NDJSON payloads carry more fields (timestamp, toolNames, _seq,
 * etc.) but only these are load-bearing for the correlation reducer.
 */
export type RoundFrame =
  | {
      type: 'tool_round_start';
      roundId: string;
      toolCount?: number;
      toolIds?: string[];
      toolNames?: string[];
      timestamp?: string;
    }
  | {
      type: 'tool_round_end';
      roundId: string;
      succeeded?: number;
      failed?: number;
      durationMs?: number;
      timestamp?: string;
    }
  | {
      type: 'tool_executing';
      roundId?: string;
      toolCallId?: string;
      name?: string;
      arguments?: unknown;
    }
  | {
      type: 'tool_complete' | 'tool_result' | 'tool_error';
      roundId?: string;
      toolCallId?: string;
      name?: string;
      result?: unknown;
      error?: string;
      durationMs?: number;
      /**
       * Phase 4 — two-channel envelope UI side. Carries outputTemplate
       * + size / elapsed / cost / artifactHandle so the reducer can
       * stamp the slug onto the matching ContentBlock for downstream
       * FrameRendererRegistry lookup.
       */
      _meta?: {
        outputTemplate?: string;
        size?: number;
        elapsed?: number;
        cost?: number;
        artifactHandle?: string;
      };
    };
// Pipeline-aware event types that match backend ChatPipeline
interface PipelineEvents {
  'pipeline:start': { messageId: string; stage: PipelineStage };
  'pipeline:stage': { stage: PipelineStage; data: unknown };
  'pipeline:tool_round': { round: number; maxRounds: number };
  'pipeline:content_suppressed': { stage: PipelineStage; reason: string };
  'pipeline:complete': { metrics: unknown };
}
/**
 * Model identifier split for the assistant message header pill.
 *
 * Mock 01 (mocks/UX/01-cloud-ops.html:206-212) shows the model in two
 * halves — the family `tag` in accent color, the rest in muted color:
 *
 *   <span class="model"><span class="tag">claude</span>3.5 sonnet</span>
 *
 * The wire frame `message_received` carries a single string like
 * `claude-opus-4-7`; we split on the FIRST hyphen so the family stays
 * a single word. Returns null for empty / whitespace / leading-hyphen
 * inputs so the consumer can suppress the badge entirely.
 */
export interface ModelIdentifier {
  tag: string;
  id: string;
}
export interface EmptyCompletionInputs {
  assistantMessage: string;
  mcpCallsLength: number;
  hasToolUseBlocks: boolean;
}

export interface EmptyCompletionResolution {
  shouldRender: boolean;
  content: string;
  usedFallback: boolean;
}
/**
 * P1-6 — streaming-table primitive (mock 01:385-462).
 *
 * Server emits one `streaming_table` frame per table; the UI keys by
 * `artifact_id` (hot-swap on re-emit) and renders inline. Mirrors the
 * compose_visual / compose_app append-or-hot-swap pattern.
 */
export type SevSeverity = 'ok' | 'warn' | 'err';

export interface SevCell {
  kind: 'sev';
  value: string;
  severity: SevSeverity;
}

export type StreamingTableCell = string | SevCell;

export interface StreamingTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  cellClass?: 'mono' | 'tnum';
  /**
   * Mock-07 (tri-cloud cost spikes) — when a numeric column carries
   * `colorize: 'delta-currency'`, the renderer applies cm-red / cm-amber /
   * cm-green class to each cell based on the absolute-value threshold:
   *   |v| >= 5000 → red
   *   |v| >= 2000 → amber
   *   otherwise   → green
   * Backwards-compat: absent flag → no coloring (existing behavior).
   */
  colorize?: 'delta-currency';
  /**
   * Mock-07 line 110 — when a column has `dim:true`, its cells render in
   * the dim-fg colour (cm-fg-3). Used for "root cause" / inline annotation
   * columns. Optional.
   */
  dim?: boolean;
}

export interface StreamingTableFilter {
  /** Column key the filter pill selects on. */
  column: string;
  /** Default option label (e.g. "all clouds"). Defaults to "all". */
  default?: string;
}

export interface StreamingTable {
  artifactId: string;
  title: string;
  countText?: string;
  columns: StreamingTableColumn[];
  rows: Array<Record<string, StreamingTableCell>>;
  /** Optional filter pill (mock-07 line 219). */
  filter?: StreamingTableFilter;
}

export interface StreamingTableFrame {
  type: 'streaming_table';
  artifact_id: string;
  title: string;
  count_text?: string;
  columns: Array<{
    key: string;
    label: string;
    align?: 'left' | 'right';
    cell_class?: 'mono' | 'tnum';
    /** Mock-07 — numeric column coloring (currently 'delta-currency'). */
    colorize?: 'delta-currency';
    /** Mock-07 — dim-styled column. */
    dim?: boolean;
  }>;
  rows: Array<Record<string, StreamingTableCell>>;
  /** Mock-07 — optional filter pill spec. */
  filter?: {
    column: string;
    default?: string;
  };
}
/**
 * Phase 27 — findings_emit NDJSON frame. Severity-tagged audit/review
 * lists rendered inline by v2/Findings (mocks 03, 07, 08, 09).
 */
export type FindingSeverityWire =
  | 'critical' | 'high' | 'med' | 'low' | 'info' | 'ok';

export interface FindingsItem {
  id: string;
  title: string;
  severity: FindingSeverityWire;
  body?: string;
}

export interface FindingsArtifact {
  artifactId: string;
  title?: string;
  items: FindingsItem[];
}

export interface FindingsFrame {
  type: 'findings_emit';
  artifact_id: string;
  title?: string;
  items: Array<{
    id: string;
    title: string;
    severity: FindingSeverityWire;
    body?: string;
  }>;
}
/**
 * #502 unified inline-widget primitive — one NDJSON frame carries the
 * v2 primitives that don't already have a dedicated wire (KpiGrid,
 * SavingsCard, StagesStrip, WaveTimeline, Runbook, StackGrid,
 * AnnotatedCode). The model emits these via the `compose_widget`
 * meta-tool; the API forwards `inline_widget` frames keyed by
 * `artifact_id`.
 *
 * Each `data` payload mirrors the corresponding v2 primitive's prop
 * shape one-to-one, so renderers can pass `data` straight through.
 */
export type InlineWidgetKind =
  | 'kpi_grid'
  | 'savings_card'
  | 'stages_strip'
  | 'wave_timeline'
  | 'runbook'
  | 'stack_grid'
  | 'annotated_code';
export interface InlineWidgetFrame {
  type: 'inline_widget';
  artifact_id: string;
  kind: InlineWidgetKind;
  title?: string;
  data: unknown;
}

export interface InlineWidget {
  artifactId: string;
  kind: InlineWidgetKind;
  title?: string;
  data: unknown;
}
/**
 * AC-D1 — artifact_emit. Server emits this when a tool finishes writing
 * bytes to UserStorageService. The UI renders one <DownloadTile> per
 * entry, click → presigned MinIO URL.
 */
export interface ArtifactEmit {
  artifactId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  producedBy?: string;
}

export interface ArtifactEmitFrame {
  type: 'artifact_emit';
  artifact_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  download_url: string;
  produced_by?: string;
}
// ════════════════════════════════════════════════════════════════════
// Wave 3 (#525) — intent_classified + tool_shortlist NDJSON consumers.
//
// Server emits these ONCE per assistant turn from prompt.stage (Wave 2):
//   intent_classified: { intent, confidence, ms, classifierCacheHit }
//   tool_shortlist:    { total_available, count, intent, kept[] }
//
// Both frames emit BEFORE the assistant's message_saved arrives
// (#473 ordering — frame fires from prompt.stage, message_saved from
// response.stage). The buffer-then-flush pattern below keys the maps
// by the React placeholder id (NOT the DB CUID — same gotcha #473
// fixed earlier).
// ════════════════════════════════════════════════════════════════════

/** IntentClassified state — one entry per assistant message. */
export interface IntentClassification {
  intent: string;
  confidence: number;
  ms: number;
  classifierCacheHit: boolean;
}

/** ToolShortlist state — one entry per assistant message. */
export interface ToolShortlist {
  totalAvailable: number;
  count: number;
  intent: string;
  kept: string[];
}

/** Wire shape for `intent_classified` (camelCase per Wave 2 spec). */
export type IntentClassifiedFrame = {
  type: 'intent_classified';
  intent: string;
  confidence: number;
  ms: number;
  classifierCacheHit: boolean;
};

/** Wire shape for `tool_shortlist` (snake_case per Wave 2 spec). */
export type ToolShortlistFrame = {
  type: 'tool_shortlist';
  total_available: number;
  count: number;
  intent: string;
  kept: string[];
};
// ════════════════════════════════════════════════════════════════════
// #502 — sub_agent_started / sub_agent_completed NDJSON consumers.
//
// Server emits these from services/openagentic-api/src/services/TaskTool.ts
// (Phase E2). Each Task tool dispatch produces:
//   sub_agent_started:   { role, description, model, session_id }
//   sub_agent_completed: { role, ok, error, turns, tokens, durationMs, toolsUsed }
//
// The pure reducers below convert to camelCase for in-state storage and
// expose a flat `subAgents` array consumed by ChatMessages -> SubAgentCard.
// Reference UX: mocks/UX/01-cloud-ops.html lines 1083-1133.
// ════════════════════════════════════════════════════════════════════

export interface SubAgentStats {
  turns: number;
  tokens: number;
  wallMs: number;
  toolsUsed?: string[];
}

export interface SubAgentEntry {
  role: string;
  description?: string;
  model: string | null;
  status: 'running' | 'ok' | 'error';
  stats?: SubAgentStats;
  error?: string | null;
  sessionId?: string;
  /**
   * Phase 16 — the sub-agent's actual return content from
   * `SubagentRunResult.output`. Written by sub_agent_completed when ok.
   * Drives the SubAgentCard's cm-sa-return strip text. When absent, the
   * card falls back to the legacy stats-string so older api versions
   * keep working.
   */
  output?: string;
}

/** Wire shape (snake_case) for `sub_agent_started`. */
export type SubAgentStartedFrame = {
  type: 'sub_agent_started';
  role: string;
  description?: string;
  model?: string | null;
  session_id?: string | null;
};

/** Wire shape (snake_case) for `sub_agent_completed`. */
export type SubAgentCompletedFrame = {
  type: 'sub_agent_completed';
  role: string;
  ok: boolean;
  error?: string | null;
  turns: number;
  tokens: number;
  durationMs: number;
  toolsUsed?: string[];
  /**
   * Phase 16 — the sub-agent's full return content (from
   * SubagentRunResult.output on the api side). Optional; older api
   * versions don't emit this and the UI degrades to stats-only render.
   */
  output?: string;
};
export interface McpApprovalRequest {
  requestId: string;
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  timeoutMs: number;
}

// Mutating-tool approval gate (backend commit 7e6637539). Distinct from
// McpApprovalRequest — keyed by an append-only `auditId`, resolved via
// POST /api/approvals/:auditId/{approve,deny}. OSS-only audit surface.
export interface AuditApprovalRequest {
  auditId: string;
  toolName: string;
  serverName?: string;
  args?: Record<string, unknown> | string;
  preview?: string;
}

// Multi-model orchestration event - flexible type for various event shapes
export interface MultiModelEvent {
  type: string;
  orchestrationId?: string;
  executionPlan?: string[];
  fromModel?: string;
  toModel?: string;
  role?: string;
  rolesExecuted?: string[];
  totalCost?: number;
  model?: string;
  content?: string;
  fromRole?: string;
  toRole?: string;
  handoffCount?: number;
  totalDuration?: number;
  error?: string;
  agents?: Array<{ role?: string; agentId?: string; [k: string]: unknown }>;
  strategy?: string;
  metrics?: unknown;
  [key: string]: unknown; // Allow additional properties for extensibility
}

export interface UseSSEChatOptions {
  sessionId: string;
  onMessage?: (message: ChatMessage) => void;
  onToolExecution?: (tool: unknown) => void;
  onToolApprovalRequest?: (data: { tools: unknown[]; toolCallRound: number; messageId: string }) => void;
  onMcpApprovalRequest?: (data: McpApprovalRequest) => void;
  onAuditApprovalRequired?: (data: AuditApprovalRequest) => void;  // OSS-only mutating-tool gate
  onError?: (error: Error) => void;
  onThinking?: (status: string) => void;
  onThinkingContent?: (content: string, tokens?: number) => void;  // For actual thinking content
  onThinkingComplete?: () => void;  // When thinking finishes
  onMultiModel?: (event: MultiModelEvent) => void;  // Multi-model orchestration events
  onStream?: (content: string) => void;
  onPipelineStage?: (stage: PipelineStage, data?: { model?: string; complete?: boolean }) => void;
  onToolRound?: (round: number, maxRounds: number) => void;
  onSessionTitleUpdated?: (sessionId: string, title: string) => void;  // AI-generated session title
  autoApproveTools?: boolean;
  // #473 — caller (ChatContainer) supplies the client-side placeholder id
  // for the in-flight assistant message. Wave 3 (#525) intent_classified
  // / tool_shortlist frames flush into per-message maps under this id so
  // ChatMessages can find them via message.id (which is the placeholder,
  // NOT the DB CUID from message_saved). Optional for back-compat — when
  // absent, flush falls back to the wire messageId (legacy behavior).
  getAssistantPlaceholderId?: () => string | null;
}
