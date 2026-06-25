/**
 * AgenticActivityStream Type Definitions
 *
 * Types for the agentic activity visualization system that transforms
 * monolithic thinking blocks into structured, progressive displays.
 */

// =============================================================================
// Content Blocks
// =============================================================================

export type ContentBlockType =
  | 'thinking'
  | 'text'
  | 'tool_call'
  | 'tool_use'     // Added for Anthropic API compatibility
  | 'tool_result'
  | 'tool_round'   // Wire-in D (#82) — parallel fan-out container
  | 'task_update'
  | 'summary'
  | 'viz_render'   // Typed-block artifact path (compose_visual + render_artifact svg)
  | 'app_render'   // Typed-block artifact path (compose_app + render_artifact react/html/python_plot)
  | 'image_render'; // Typed-block artifact path (generate_image — inline generated raster image)

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  timestamp: number;
  content: string;
  metadata?: ContentBlockMetadata;
  // Extended properties for streaming/interleaved mode
  isComplete?: boolean;   // Whether the block has finished streaming
  toolId?: string;        // For tool_use blocks - the tool call ID
  toolName?: string;      // For tool_use blocks - the tool name
  agentId?: string;       // Sub-agent ID (for spawn_parallel_agents children)
  parentToolId?: string;  // Parent tool call ID (nesting)
  agentRole?: string;     // Agent role description
  startTime?: number;     // ms epoch when this block began streaming
  duration?: number;      // ms elapsed from startTime to isComplete
  result?: unknown;       // For tool_use — the resolved tool result JSON
  error?: string;         // For tool_use — error message if the tool failed
  /**
   * Task #131 (Phase F₂) — parallel tool-call round grouping key.
   * When the backend's executeToolCalls helper fires N tool_executing
   * events in a tight burst (one parallel fan-out), useChatStream stamps
   * the same integer on all of them so AgenticActivityStream can route
   * the group to the premium ToolCallGroup under UnifiedAgentActivity/.
   * Optional so existing paths that don't stamp it still type-check.
   */
  toolCallRound?: number;
  /**
   * Task #131 — stable slot index within a parallel round. Used by
   * ToolCallGroup to preserve DOM emit-order (cards don't reorder when
   * tool_result events arrive out of order; the visual completion-order
   * reveal comes from each card flipping its own isComplete flag).
   */
  parallelSlotIndex?: number;
  /**
   * Wire-in D (#82) — tool_round container fields. Populated only for
   * blocks of type 'tool_round' so AgenticActivityStream can render
   * them via ToolParallelGroup. Optional here so every other block path
   * keeps type-checking without change.
   */
  roundId?: string;
  toolIds?: string[];
  children?: ContentBlock[];
  durationMs?: number;
  succeeded?: number;
  failed?: number;
  // ─────────────────────────────────────────────────────────────────────
  // Typed-block artifact path. Kept in sync with the hooks/useChatStream
  // ContentBlock so the AgenticActivityStream render switch can read these
  // optional fields without a type-cast.
  // ─────────────────────────────────────────────────────────────────────
  index?: number;
  input?: unknown;
  resultRaw?: unknown;
  outputTemplate?: string;
  toolUseId?: string;
  groupId?: string;
  template?: string;
  kind?: 'svg' | 'html' | 'reactflow_arch' | 'arch_diagram' | 'chart' | 'react' | 'python_plot';
  title?: string;
  caption?: string;
  loadingMessages?: string[];
  html?: string;
  pyodideRequired?: boolean;
  nonce?: string | null;
  // image_render only — generate_image inline image fields. `imageUrl` is
  // ALWAYS a same-origin /api/images/:id path (the generate_image tool refuses
  // external hosts; the SDK reducer drops external URLs defensively).
  imageUrl?: string;
  prompt?: string;
  model?: string;
  provider?: string;
}

export interface ContentBlockMetadata {
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  taskId?: string;
  sectionTitle?: string;
  isRepetitive?: boolean;
  repetitionCount?: number;
  duration?: number;
  status?: 'pending' | 'executing' | 'success' | 'error';
}

// =============================================================================
// Activity Sections
// =============================================================================

export interface ActivitySection {
  id: string;
  title: string;
  content: string;
  type: 'thinking' | 'analysis' | 'planning' | 'executing';
  isCollapsed: boolean;
  isRepetitive: boolean;
  repetitionCount?: number;
  timestamp: number;
}

// =============================================================================
// Tasks
// =============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AgenticTask {
  id: string;
  title: string;
  status: TaskStatus;
  progress?: number; // 0-100 for partial progress
  subtasks?: AgenticTask[];
  startedAt?: number;
  completedAt?: number;
  activeForm?: string; // Present tense version shown when in progress
}

// =============================================================================
// Tool Calls
// =============================================================================

export type ToolCallStatus = 'calling' | 'success' | 'error' | 'abandoned';

export interface ToolCall {
  id: string;
  toolName: string;
  displayName: string;
  input: unknown;
  output?: unknown;
  status: ToolCallStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  progressMessage?: string;  // Live progress message from heartbeat
  isCollapsed: boolean;
  agentId?: string;       // Sub-agent ID (for spawn_parallel_agents children)
  parentToolId?: string;  // Parent tool call ID (nesting)
  agentRole?: string;     // Agent role description
}

// =============================================================================
// Response Summary
// =============================================================================

export interface KeyFinding {
  label: string;
  value: string;
  icon?: string;
}

export interface SuggestedAction {
  id: string;
  label: string;
  description?: string;
  prompt?: string; // Pre-filled prompt when clicked
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

export interface ResponseSummary {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
}

// =============================================================================
// Parsed Activity
// =============================================================================

export interface ParsedActivity {
  sections: ActivitySection[];
  tasks: AgenticTask[];
  toolCalls: ToolCall[];
  summary: ResponseSummary | null;
}

// =============================================================================
// Streaming State
// =============================================================================

export type StreamingState =
  | 'idle'
  | 'thinking'
  | 'tool_use'
  | 'streaming'
  | 'complete'
  | 'error';

// =============================================================================
// Component Props
// =============================================================================

// Thinking progress data for real progress indicator
export interface ThinkingProgress {
  tokensUsed: number;
  tokenBudget: number;
  percentage: number;
  phase: 'thinking' | 'tools' | 'generating';
}

export interface AgenticActivityStreamProps {
  // Streaming state
  isStreaming: boolean;
  streamingState: StreamingState;

  // Content blocks (thinking, text, etc.)
  contentBlocks: ContentBlock[];

  // Tasks/todos from the AI
  tasks?: AgenticTask[];

  // Tool calls
  toolCalls?: ToolCall[];

  // Theme
  theme?: 'light' | 'dark';

  // Thinking progress for real progress indicator
  thinkingProgress?: ThinkingProgress;

  // Callbacks
  onInterrupt?: () => void;
  onToggleSection?: (sectionId: string) => void;

  // Display options
  showTimestamps?: boolean;
  autoCollapseRepetitive?: boolean;
  maxVisibleLines?: number;

  // Additional class names
  className?: string;

  /**
   * #646 Option B — sub-agent lifecycle entries (sub_agent_started /
   * sub_agent_completed). When an agent block in the timeline has an
   * `agentRole` matching one of these entries, AgenticActivityStream
   * renders the rich SubAgentCard at THAT timeline position (matching
   * mock 01:1077-1140) instead of the lightweight inline agent badge.
   *
   * Falls through to the legacy inline render when the list is empty
   * or the role doesn't match — so existing behaviour is preserved
   * for chats without sub-agents.
   */
  subAgents?: ReadonlyArray<SubAgentEntry>;

  /**
   * Sev-1 #922 — HITL approval entries scoped to THIS assistant turn.
   * Each entry's `toolName` correlates to one tool_use block in
   * `contentBlocks`. AAS renders the approval card INLINE immediately
   * after the matching tool_use, in chronological order. The previous
   * footer-strip render in `ChatMessages` was ripped because it
   * "appeared to move" — as the model streamed more content after a
   * tool fired, the strip stayed anchored to the message footer while
   * the tool card scrolled up out of view.
   *
   * Correlation strategy: earliest-unrendered-pending. Server does not
   * emit `toolUseId` on the hitl_approval frame; we pair the i-th
   * pending approval with `toolName=T` against the i-th tool_use block
   * with `toolName=T` in the activity stream. Orphan approvals (no
   * matching tool_use yet — race with tool_executing) render at the
   * end of the stream so the user can always act on them.
   */
  hitlApprovals?: ReadonlyArray<HitlApprovalEntry>;
  onApproveHitl?: (requestId: string) => void;
  onDenyHitl?: (requestId: string) => void;

  /**
   * Sev-0 dup-render rip (2026-05-21) — structured streaming-table data
   * scoped to THIS message. When a `viz_render` ContentBlock has
   * `template:'table'` AND a matching `StreamingTable` lives here keyed
   * by `artifactId === block.id`, AAS renders the native React
   * `<StreamingTable>` INLINE at the wire-emit position instead of the
   * iframe-srcdoc HTML table. This kills three duplicate renders in one
   * shot:
   *   (a) the iframe-with-baked-HTML path (CLAUDE.md rule 8b violation —
   *       iframe doesn't inherit `--cm-*` theme tokens),
   *   (b) the sibling `<StreamingTable>` strip that used to render below
   *       the message bubble in ChatMessages.tsx,
   *   (c) the ToolCard auto-expand JSON wall (collapsed by default when
   *       `outputTemplate` is table/streaming_table — see ToolCard.tsx).
   *
   * Live DOM evidence:
   *   reports/verify-cadence/one-shot-redeploy-2026-05-21/07-table-dup-fullpage.png
   *
   * Lightweight clone of `StreamingTable` from `useChatStream` so this
   * types file doesn't pull in the hook layer. Field set kept in sync.
   */
  streamingTables?: ReadonlyArray<StreamingTableEntry>;
}

/**
 * Sev-0 dup-render rip — clone of `StreamingTable` shape from
 * `useChatStream`. Field set kept in sync; AAS reads only these fields
 * when correlating a `viz_render(template=table)` block to its native
 * `<StreamingTable>` render.
 */
export interface StreamingTableEntry {
  artifactId: string;
  title: string;
  countText?: string;
  columns: ReadonlyArray<{
    key: string;
    label: string;
    align?: 'left' | 'right';
    cellClass?: 'mono' | 'tnum';
    colorize?: 'delta-currency';
    dim?: boolean;
  }>;
  rows: ReadonlyArray<Record<string, unknown>>;
  filter?: { column: string; default?: string };
}

/**
 * Sev-1 #922 — HITL approval entry passed through to AgenticActivityStream.
 * Field set mirrors `hitlApprovalsByMessageId` in `ChatMessages` props
 * (kept in sync; that table is the single point of truth populated by
 * the `hitl_approval` / `mcp_approval_required` envelope in
 * `useChatStream`).
 */
export interface HitlApprovalEntry {
  requestId: string;
  toolName: string;
  serverName?: string;
  reason: string;
  timeoutMs: number;
  arguments?: unknown;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  /**
   * HITL.3 — the tool_use_id of the Task (sub-agent delegation) block that
   * spawned the sub-agent which triggered this approval. Set when the
   * mcp_approval_required frame arrives from openagentic-proxy via the
   * stream.handler bridge (HITL.2). Used by AAS for refined HITL chip
   * positioning: when present, prefer to render the chip adjacent to
   * the matching sub-agent's tool card rather than any tool_use with
   * the same toolName.
   */
  parentToolUseId?: string;
}

/**
 * Lightweight clone of `SubAgentEntry` from `useChatStream` so the type
 * file doesn't pull in the hook layer. Field set must stay in sync
 * with `services/openagentic-ui/src/features/chat/hooks/useChatStream.ts`
 * `SubAgentEntry` — the SubAgentCard render in AgenticActivityStream
 * reads only these fields.
 */
export interface SubAgentEntry {
  role: string;
  description?: string;
  model?: string | null;
  status: 'running' | 'ok' | 'error';
  stats?: {
    turns: number;
    tokens: number;
    wallMs: number;
    toolsUsed?: string[];
  };
  error?: string | null;
  output?: string;
}

export interface ThinkingSectionProps {
  content: string;
  isStreaming: boolean;
  autoCollapse?: boolean;
  maxVisibleLines?: number;
  onToggle?: () => void;
  isCollapsed?: boolean;
  className?: string;
  variant?: 'natural' | 'boxed';
}

export interface TaskProgressProps {
  tasks: AgenticTask[];
  animate?: boolean;
  showTimestamps?: boolean;
  collapsible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export interface ToolCallCardProps {
  toolName: string;
  displayName?: string;
  toolInput: unknown;
  toolOutput?: unknown;
  status: ToolCallStatus;
  duration?: number;
  startTime?: number;
  progressMessage?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  theme?: 'light' | 'dark';
  className?: string;
  /**
   * v0.6.7 fix 4 — partial JSON stream (input_json_delta). When present
   * and status === 'calling', the card shows a character-by-character
   * typing cursor on the live args pane. Replaced by `toolInput` once
   * the block stops.
   */
  inputDeltaContent?: string;
  /**
   * Audit L1-2 / Phase A3 — FrameRendererRegistry slug from the wire
   * `_meta.outputTemplate`. When present and the slug is registered,
   * ToolCard renders the resolved component instead of raw JsonView.
   */
  outputTemplate?: string;
}

export interface ResponseSummaryProps {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}

export interface SuggestedActionsProps {
  actions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}

// =============================================================================
// Legacy InlineStep Type (migrated from InlineSteps.tsx)
// =============================================================================

/**
 * InlineStep represents a single step in the agent activity display.
 * Used by useInlineStepsAdapter to bridge legacy step data to ContentBlock format.
 */
export interface InlineStep {
  id: string;
  type: 'thinking' | 'tool' | 'search' | 'read' | 'write' | 'bash' | 'edit' | 'glob' | 'grep' | 'handoff' | 'web_search' | 'mcp';
  status: 'pending' | 'running' | 'complete' | 'completed' | 'error';
  content?: string;
  title?: string;
  summary?: string;
  detail?: string;
  request?: string;
  response?: string;
  details?: {
    args?: any;
    result?: any;
    command?: string;
    output?: string;
    content?: string;
  };
  model?: string;
  round?: number;
  duration?: number;
  startTime?: number;
  endTime?: number;
  // For web search results
  resultCount?: number;
  searchResults?: Array<{ title: string; url: string; favicon?: string }>;
  // For nested thinking
  thinkingContent?: string;
  // For live progress updates on running tools
  progressMessage?: string;
  // Agent delegation sub-results
  agentId?: string;
  agentRole?: string;
}

export type DisplayMode = 'verbose' | 'compact';
