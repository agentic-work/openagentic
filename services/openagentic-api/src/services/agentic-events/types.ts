/**
 * OpenAgentic canonical event taxonomy — superset of common LLM streaming patterns + platform-specific events we own.
 *
 * THIS IS THE CONTRACT every service in the platform must speak. Provider
 * normalizers emit a subset (model-driven events). The platform layer
 * emits the rest (sub-agents, RAG, HITL, cost, artifacts, viz, MCP,
 * trust/audit, session/durability).
 *
 * Layers:
 *   1. Model-stream (provider-agnostic core) (model-driven):
 *      message_start / content_block_start / content_block_delta /
 *      content_block_stop / message_delta / message_stop / ping / error
 *
 *   2. OpenAgentic stream envelope (transport-level):
 *      stream_start, stream_end, delta_resume_marker
 *
 *   3. Tool execution (platform-driven, not model-driven):
 *      tool_executing, tool_completed, tool_failed, tool_input_delta,
 *      tool_output_chunk, tool_status
 *
 *   4. Sub-agents (Task tool / orchestrator):
 *      agent_start, agent_step, agent_stop, parallel_fanout_header,
 *      sub_agent_started, sub_agent_completed, agent_tree_update
 *
 *   5. HITL (human-in-the-loop approval):
 *      hitl_request, hitl_response
 *
 *   6. Artifacts (chatmode T1/T2/T3 outputs):
 *      artifact_start, artifact_delta, artifact_complete,
 *      compose_visual, compose_app
 *
 *   7. Viz hints / chrome:
 *      viz_head, tool_shortlist_chip, streaming_table
 *
 *   8. Trust / observability:
 *      dlp_block, audit_event, policy_violation, request_clarification,
 *      cost_pulse, cost_record, usage
 *
 *   9. Data layers (RAG / memory / embeddings):
 *      rag_citation, doc_chunk, memory_write, embedding_indexed,
 *      vector_probe
 *
 *  10. MCP fabric:
 *      mcp_connect, mcp_disconnect, mcp_capability_delta
 *
 *  11. Codemode (UI virtual DOM via InkVdom):
 *      ui_open, ui_patch, ui_close, ui_event, kube_event,
 *      file_panel_update, slash_command_synthetic, session_info
 *
 *  12. Flows:
 *      flow_node_start, flow_node_end, node_progress,
 *      flow_canvas_state, late_subscriber_catchup
 *
 *  13. Session durability:
 *      session_resume, replay_pacing, agentic_cli_parity
 *
 *  14. Platform error (catch-all for non-fatal misbehavior):
 *      platform_error
 *
 * Every event carries a `type` string discriminator. Use the type guards
 * in `./guards.ts` for narrowing.
 *
 * Compatibility: events are append-only across SDK versions. Removing or
 * changing the shape of an existing event is a MAJOR version bump.
 * Adding new events / fields is MINOR.
 */

// =============================================================================
// 1. Model-stream (provider-agnostic core) (model-driven, mirrors RawMessageStreamEvent)
// =============================================================================

export interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: ContentBlock[];
    stop_reason: StopReason | null;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
    | {
        type: 'citations_delta';
        citation: {
          type: string;
          cited_text: string;
          document_index?: number;
          document_title?: string | null;
          start_char_index?: number;
          end_char_index?: number;
          url?: string;
        };
      };
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: StopReason | null;
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

export interface ModelPingEvent {
  type: 'ping';
}

export interface ModelErrorEvent {
  type: 'error';
  error: { type: string; message: string };
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'thinking'; thinking: string; signature?: string };

export type ModelStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ModelPingEvent
  | ModelErrorEvent;

// =============================================================================
// 2. Stream envelope (transport-level)
// =============================================================================

export interface StreamStartEvent {
  type: 'stream_start';
  stream_id: string;
  session_id?: string;
  user_id?: string;
  ttft_ms?: number;
  /** Server-emitted timestamp (ms since epoch) for replay reconstruction. */
  ts: number;
}

export interface StreamEndEvent {
  type: 'stream_end';
  stream_id: string;
  ttl_ms?: number;
  ts: number;
}

export interface DeltaResumeMarkerEvent {
  type: 'delta_resume_marker';
  /** Sequence number — clients reconnecting send this back to resume. */
  seq: number;
  ts: number;
}

// =============================================================================
// 3. Tool execution (platform-driven)
// =============================================================================

export interface ToolExecutingEvent {
  type: 'tool_executing';
  tool_use_id: string;
  tool_name: string;
  /** OpenAI-shape preview of input args (≤200 chars) for UI display. */
  args_preview: string;
  /** Where the tool runs: 'mcp', 'meta', 'subagent', 'sandbox'. */
  surface: 'mcp' | 'meta' | 'subagent' | 'sandbox';
  ts: number;
}

export interface ToolCompletedEvent {
  type: 'tool_completed';
  tool_use_id: string;
  tool_name: string;
  duration_ms: number;
  ok: boolean;
  /** Output preview for UI (≤500 chars). Full output is in tool_output_chunk events. */
  output_preview?: string;
  /** Number of bytes in the full result. */
  bytes?: number;
  ts: number;
}

export interface ToolFailedEvent {
  type: 'tool_failed';
  tool_use_id: string;
  tool_name: string;
  duration_ms: number;
  error: string;
  /** Was the tool rejected at HITL? policy? auth? rate-limit? */
  reason?: 'hitl_denied' | 'policy' | 'auth' | 'rate_limit' | 'timeout' | 'remote_error' | 'unknown';
  ts: number;
}

export interface ToolInputDeltaEvent {
  type: 'tool_input_delta';
  tool_use_id: string;
  /** Incremental JSON arg fragment (concatenates into full input). */
  partial_json: string;
  ts: number;
}

export interface ToolOutputChunkEvent {
  type: 'tool_output_chunk';
  tool_use_id: string;
  /** Sequential chunk number (0-indexed). */
  seq: number;
  /** Raw chunk content — could be text, JSON, base64-encoded binary. */
  content: string;
  /** True on the final chunk. */
  done: boolean;
  ts: number;
}

export interface ToolStatusEvent {
  type: 'tool_status';
  tool_use_id: string;
  status: 'queued' | 'running' | 'cancelled' | 'retrying';
  attempt?: number;
  ts: number;
}

// =============================================================================
// 4. Sub-agents
// =============================================================================

export interface AgentStartEvent {
  type: 'agent_start';
  agent_id: string;
  agent_type: string;
  description?: string;
  parent_agent_id?: string;
  model?: string;
  ts: number;
}

export interface AgentStepEvent {
  type: 'agent_step';
  agent_id: string;
  iteration: number;
  /** Human-readable summary of what the step did. */
  summary: string;
  ts: number;
}

export interface AgentStopEvent {
  type: 'agent_stop';
  agent_id: string;
  ok: boolean;
  iterations: number;
  duration_ms: number;
  tokens_used?: number;
  output?: string;
  error?: string;
  ts: number;
}

export interface ParallelFanoutHeaderEvent {
  type: 'parallel_fanout_header';
  /** Number of tool calls in this parallel batch. */
  count: number;
  /** The tool_use_ids that fan out together. */
  tool_use_ids: string[];
  ts: number;
}

export interface SubAgentStartedEvent {
  type: 'sub_agent_started';
  task_id: string;
  agent_role: string;
  description: string;
  parent_session_id?: string;
  parent_user_id?: string;
  ts: number;
}

export interface SubAgentCompletedEvent {
  type: 'sub_agent_completed';
  task_id: string;
  ok: boolean;
  output?: string;
  error?: string;
  turns: number;
  tokens: number;
  duration_ms: number;
  tools_used: string[];
  ts: number;
}

export interface AgentTreeUpdateEvent {
  type: 'agent_tree_update';
  /** Tree of agents in this turn for the AGENT TREE sidebar. */
  tree: Array<{
    id: string;
    role: string;
    description?: string;
    state: 'running' | 'done' | 'error';
    children: string[];
  }>;
  ts: number;
}

// =============================================================================
// 5. HITL
// =============================================================================

export interface HitlRequestEvent {
  type: 'hitl_request';
  request_id: string;
  tool_name: string;
  args_preview: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  /** Policy reason if known. */
  reason?: string;
  /** Approval expires at ts (ms). */
  expires_at?: number;
  ts: number;
}

export interface HitlResponseEvent {
  type: 'hitl_response';
  request_id: string;
  approved: boolean;
  approver?: string;
  reason?: string;
  /** Time from request to response (ms). */
  wait_ms: number;
  ts: number;
}

// =============================================================================
// 6. Artifacts
// =============================================================================

export interface ArtifactStartEvent {
  type: 'artifact_start';
  artifact_id: string;
  /** Document type — html, svg, react, python_plot, sankey, arch_diagram,
   *  bar_chart, line_chart, kpi_grid, table, etc. Open-ended for future
   *  templates; mermaid is removed platform-wide. */
  artifact_type: string;
  title?: string;
  ts: number;
}

export interface ArtifactDeltaEvent {
  type: 'artifact_delta';
  artifact_id: string;
  /** Streaming content fragment. */
  content: string;
  ts: number;
}

export interface ArtifactCompleteEvent {
  type: 'artifact_complete';
  artifact_id: string;
  bytes: number;
  /** Optional URL where the rendered artifact can be fetched. */
  url?: string;
  ts: number;
}

export interface ComposeVisualEvent {
  type: 'compose_visual';
  /** Template id from COMPOSE_VISUAL_TEMPLATES — e.g. 'sankey', 'sankey_3col',
   *  'bar_chart', 'line_chart', 'table', 'kpi_grid', 'arch_diagram', 'treemap',
   *  'heatmap', 'sunburst', 'chord', 'svg_raw', 'html_raw'. Mermaid is removed. */
  template: string;
  /** Template input data. */
  data: Record<string, unknown>;
  /** Optional pre-rendered SVG/HTML string. */
  rendered?: string;
  ts: number;
}

export interface ComposeAppEvent {
  type: 'compose_app';
  /** Sandboxed mini-app id. */
  app_id: string;
  /** Allow-listed library imports. */
  imports: string[];
  /** App entry source. */
  source: string;
  ts: number;
}

// =============================================================================
// 7. Viz hints / chrome
// =============================================================================

export interface VizHeadEvent {
  type: 'viz_head';
  /** Title shown in the .viz-head band above the visualization. */
  title: string;
  /** Optional subtitle / metadata. */
  subtitle?: string;
  /** Source attribution (e.g. "azure_cost_query · 6mo · by service"). */
  source?: string;
  ts: number;
}

export interface ToolShortlistChipEvent {
  type: 'tool_shortlist_chip';
  /** "Azure / subscription → 5 of 270" — the cascade trail. */
  trail: string;
  /** Number of tools that passed the cascade. */
  shortlisted: number;
  /** Total MCP tools in the registry. */
  total: number;
  ts: number;
}

export interface StreamingTableEvent {
  type: 'streaming_table';
  table_id: string;
  /** Column definitions. */
  columns: Array<{ key: string; label: string; type?: 'string' | 'number' | 'date' | 'currency' }>;
  /** Row deltas — appended incrementally as the underlying tool returns. */
  rows: Array<Record<string, unknown>>;
  /** True on the final chunk; lets UI lock the table. */
  done: boolean;
  ts: number;
}

// =============================================================================
// 8. Trust / observability
// =============================================================================

export interface DlpBlockEvent {
  type: 'dlp_block';
  /** Why DLP blocked this content. */
  reason: 'pii_detected' | 'secret_leak' | 'policy_violation' | 'classification_mismatch';
  /** Field where the violation was found. */
  field?: string;
  /** Redacted preview of the offending content. */
  preview?: string;
  ts: number;
}

export interface AuditEventEvent {
  type: 'audit_event';
  /** Audit subsystem name (FedRAMP AU control mapping). */
  subsystem: string;
  action: string;
  actor: string;
  resource?: string;
  outcome: 'success' | 'failure' | 'denied';
  /** AU-2 / AU-12 mapping. */
  control?: string;
  ts: number;
}

export interface PolicyViolationEvent {
  type: 'policy_violation';
  policy_id: string;
  policy_name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  description: string;
  ts: number;
}

export interface RequestClarificationEvent {
  type: 'request_clarification';
  clarification_id: string;
  question: string;
  options?: string[];
  ts: number;
}

export interface CostPulseEvent {
  type: 'cost_pulse';
  /** Running session cost in USD. */
  total_usd: number;
  /** Cost from the last completion (USD). */
  last_turn_usd: number;
  /** Tokens used in the last turn. */
  last_turn_tokens: number;
  ts: number;
}

export interface CostRecordEvent {
  type: 'cost_record';
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Cached token count for cache-discount accounting. */
  cached_tokens?: number;
  thinking_tokens?: number;
  cost_usd: number;
  ts: number;
}

export interface UsageEvent {
  type: 'usage';
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  thinking_tokens?: number;
  ts: number;
}

// =============================================================================
// 9. Data layers
// =============================================================================

export interface RagCitationEvent {
  type: 'rag_citation';
  /** Citation index (1-based) referenced in the assistant's prose as [1], [2], etc. */
  index: number;
  doc_id: string;
  doc_title?: string;
  /** Excerpt that supports the citation. */
  excerpt: string;
  /** Source URL or system path. */
  source?: string;
  /** Cosine similarity / BM25 relevance score (0-1). */
  score?: number;
  ts: number;
}

export interface DocChunkEvent {
  type: 'doc_chunk';
  doc_id: string;
  chunk_id: string;
  /** 0-indexed chunk position within the doc. */
  position: number;
  content: string;
  ts: number;
}

export interface MemoryWriteEvent {
  type: 'memory_write';
  /** Memory namespace (user / session / global). */
  scope: 'user' | 'session' | 'global';
  key: string;
  /** Hash-only preview to avoid leaking PII into NDJSON. */
  value_preview: string;
  ts: number;
}

export interface EmbeddingIndexedEvent {
  type: 'embedding_indexed';
  collection: string;
  count: number;
  /** Embedding model used. */
  model: string;
  duration_ms: number;
  ts: number;
}

export interface VectorProbeEvent {
  type: 'vector_probe';
  collection: string;
  query_preview: string;
  hits: number;
  duration_ms: number;
  ts: number;
}

// =============================================================================
// 10. MCP fabric
// =============================================================================

export interface McpConnectEvent {
  type: 'mcp_connect';
  server: string;
  /** Number of tools the server exposes. */
  tool_count: number;
  ts: number;
}

export interface McpDisconnectEvent {
  type: 'mcp_disconnect';
  server: string;
  reason?: string;
  ts: number;
}

export interface McpCapabilityDeltaEvent {
  type: 'mcp_capability_delta';
  server: string;
  /** Tools added since last connect. */
  added: string[];
  /** Tools removed since last connect. */
  removed: string[];
  ts: number;
}

// =============================================================================
// 11. Codemode (UI virtual DOM)
// =============================================================================

export interface UiOpenEvent {
  type: 'ui_open';
  ui_id: string;
  /** React virtual DOM root. */
  root: unknown;
  ts: number;
}

export interface UiPatchEvent {
  type: 'ui_patch';
  ui_id: string;
  /** JSON patch ops. */
  ops: unknown[];
  ts: number;
}

export interface UiCloseEvent {
  type: 'ui_close';
  ui_id: string;
  ts: number;
}

export interface UiEventEvent {
  type: 'ui_event';
  ui_id: string;
  /** User input event: click, keypress, etc. */
  event: { kind: string; target?: string; value?: unknown };
  ts: number;
}

export interface KubeEventEvent {
  type: 'kube_event';
  /** k8s pod/event level. */
  level: 'normal' | 'warning';
  source: string;
  reason: string;
  message: string;
  ts: number;
}

export interface FilePanelUpdateEvent {
  type: 'file_panel_update';
  /** Codemode file-panel updated. */
  files: Array<{ path: string; status: 'new' | 'modified' | 'deleted'; size?: number }>;
  ts: number;
}

export interface SlashCommandSyntheticEvent {
  type: 'slash_command_synthetic';
  /** Synthetic assistant frame from openagentic CLI's headless slash dispatcher. */
  command: string;
  result: string;
  ts: number;
}

export interface SessionInfoEvent {
  type: 'session_info';
  session_id: string;
  model: string;
  /** Codemode session metadata. */
  openagentic_version: string;
  permission_mode?: string;
  ts: number;
}

// =============================================================================
// 12. Flows
// =============================================================================

export interface FlowNodeStartEvent {
  type: 'flow_node_start';
  flow_id: string;
  node_id: string;
  node_type: string;
  ts: number;
}

export interface FlowNodeEndEvent {
  type: 'flow_node_end';
  flow_id: string;
  node_id: string;
  ok: boolean;
  duration_ms: number;
  ts: number;
}

export interface NodeProgressEvent {
  type: 'node_progress';
  flow_id: string;
  node_id: string;
  /** 0-1 fraction. */
  progress: number;
  message?: string;
  ts: number;
}

export interface FlowCanvasStateEvent {
  type: 'flow_canvas_state';
  flow_id: string;
  /** Snapshot of node states (for late subscribers). */
  nodes: Array<{ id: string; state: 'queued' | 'running' | 'done' | 'error' }>;
  ts: number;
}

export interface LateSubscriberCatchupEvent {
  type: 'late_subscriber_catchup';
  /** Number of historical events the subscriber missed. */
  missed: number;
  /** All those events follow this envelope (replayed in order). */
  ts: number;
}

// =============================================================================
// 13. Session durability
// =============================================================================

export interface SessionResumeEvent {
  type: 'session_resume';
  session_id: string;
  /** Sequence number to resume from. */
  resume_from_seq: number;
  ts: number;
}

export interface ReplayPacingEvent {
  type: 'replay_pacing';
  /** Number of events being replayed. */
  events: number;
  /** Pacing delay between replays (ms). */
  pacing_ms: number;
  ts: number;
}

export interface AgenticCliParityEvent {
  type: 'agentic_cli_parity';
  /** Parity envelope from openagentic CLI for codemode UI display. */
  payload: unknown;
  ts: number;
}

// =============================================================================
// 14. Platform error catch-all
// =============================================================================

export interface PlatformErrorEvent {
  type: 'platform_error';
  source: string;
  message: string;
  /** Optional structured details. */
  details?: Record<string, unknown>;
  /** Severity. */
  severity: 'info' | 'warning' | 'error' | 'fatal';
  ts: number;
}

// =============================================================================
// THE UNION
// =============================================================================

export type AgenticEvent =
  // Layer 1: Model-stream (provider-agnostic)
  | ModelStreamEvent
  // Layer 2: stream envelope
  | StreamStartEvent
  | StreamEndEvent
  | DeltaResumeMarkerEvent
  // Layer 3: tool execution
  | ToolExecutingEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolInputDeltaEvent
  | ToolOutputChunkEvent
  | ToolStatusEvent
  // Layer 4: sub-agents
  | AgentStartEvent
  | AgentStepEvent
  | AgentStopEvent
  | ParallelFanoutHeaderEvent
  | SubAgentStartedEvent
  | SubAgentCompletedEvent
  | AgentTreeUpdateEvent
  // Layer 5: HITL
  | HitlRequestEvent
  | HitlResponseEvent
  // Layer 6: artifacts
  | ArtifactStartEvent
  | ArtifactDeltaEvent
  | ArtifactCompleteEvent
  | ComposeVisualEvent
  | ComposeAppEvent
  // Layer 7: viz / chrome
  | VizHeadEvent
  | ToolShortlistChipEvent
  | StreamingTableEvent
  // Layer 8: trust / observability
  | DlpBlockEvent
  | AuditEventEvent
  | PolicyViolationEvent
  | RequestClarificationEvent
  | CostPulseEvent
  | CostRecordEvent
  | UsageEvent
  // Layer 9: data layers
  | RagCitationEvent
  | DocChunkEvent
  | MemoryWriteEvent
  | EmbeddingIndexedEvent
  | VectorProbeEvent
  // Layer 10: MCP fabric
  | McpConnectEvent
  | McpDisconnectEvent
  | McpCapabilityDeltaEvent
  // Layer 11: codemode
  | UiOpenEvent
  | UiPatchEvent
  | UiCloseEvent
  | UiEventEvent
  | KubeEventEvent
  | FilePanelUpdateEvent
  | SlashCommandSyntheticEvent
  | SessionInfoEvent
  // Layer 12: flows
  | FlowNodeStartEvent
  | FlowNodeEndEvent
  | NodeProgressEvent
  | FlowCanvasStateEvent
  | LateSubscriberCatchupEvent
  // Layer 13: session durability
  | SessionResumeEvent
  | ReplayPacingEvent
  | AgenticCliParityEvent
  // Layer 14: platform error
  | PlatformErrorEvent;

/**
 * String-literal union of every type discriminator. Useful for runtime
 * validation and exhaustive switch checks.
 */
export type AgenticEventType = AgenticEvent['type'];
