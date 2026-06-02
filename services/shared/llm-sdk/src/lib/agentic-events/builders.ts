/**
 * Event-builder helpers — typed constructors for the OpenAgentic canonical
 * event taxonomy. Every emit site in the platform (api / workflows /
 * code-manager / openagentic) should call these helpers
 * INSTEAD of constructing object literals.
 *
 * Pattern: each builder takes `Omit<Event, 'type' | 'ts'>` and stamps the
 * `type` discriminant + `ts` timestamp automatically. That way:
 *   - When we add a field to a type, every emit site picks it up via TS.
 *   - When we add a NEW event type, we add a builder here once.
 *   - Arch-grep regression test bans `controller.enqueue({type:'X',...})`
 *     anywhere outside this module.
 *
 * Layout: one builder per event type, grouped by layer (mirrors types.ts).
 */

import type {
  // Layer 1
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  ModelPingEvent,
  ModelErrorEvent,
  // Layer 2
  StreamStartEvent,
  StreamEndEvent,
  DeltaResumeMarkerEvent,
  // Layer 3
  ToolExecutingEvent,
  ToolCompletedEvent,
  ToolFailedEvent,
  ToolInputDeltaEvent,
  ToolOutputChunkEvent,
  ToolStatusEvent,
  // Layer 4
  AgentStartEvent,
  AgentStepEvent,
  AgentStopEvent,
  ParallelFanoutHeaderEvent,
  SubAgentStartedEvent,
  SubAgentCompletedEvent,
  AgentTreeUpdateEvent,
  // Layer 5
  HitlRequestEvent,
  HitlResponseEvent,
  // Layer 6
  ArtifactStartEvent,
  ArtifactDeltaEvent,
  ArtifactCompleteEvent,
  ComposeVisualEvent,
  ComposeAppEvent,
  // Layer 7
  TierHintEvent,
  ModelHandoffOfferEvent,
  VizHeadEvent,
  ToolShortlistChipEvent,
  StreamingTableEvent,
  // Layer 8
  DlpBlockEvent,
  AuditEventEvent,
  PolicyViolationEvent,
  RequestClarificationEvent,
  CostPulseEvent,
  CostRecordEvent,
  UsageEvent,
  // Layer 9
  RagCitationEvent,
  DocChunkEvent,
  MemoryWriteEvent,
  EmbeddingIndexedEvent,
  VectorProbeEvent,
  // Layer 10
  McpConnectEvent,
  McpDisconnectEvent,
  McpCapabilityDeltaEvent,
  // Layer 11
  UiOpenEvent,
  UiPatchEvent,
  UiCloseEvent,
  UiEventEvent,
  KubeEventEvent,
  FilePanelUpdateEvent,
  SlashCommandSyntheticEvent,
  SessionInfoEvent,
  // Layer 12
  FlowNodeStartEvent,
  FlowNodeEndEvent,
  NodeProgressEvent,
  FlowCanvasStateEvent,
  LateSubscriberCatchupEvent,
  // Layer 13
  SessionResumeEvent,
  ReplayPacingEvent,
  AgenticCliParityEvent,
  // Layer 14
  PlatformErrorEvent,
} from './types.js';

/**
 * Internal helper: returns `Date.now()` so callers can override in tests
 * via the `nowOverride` parameter. We use ms-since-epoch (number) to match
 * the `ts: number` field shape used throughout types.ts.
 */
function now(nowOverride?: number): number {
  return nowOverride ?? Date.now();
}

/** Args type for any event builder — strip the discriminator + timestamp. */
type Args<E extends { type: string; ts: number }> = Omit<E, 'type' | 'ts'>;

// =============================================================================
// Layer 1 — Model-stream
// =============================================================================
// Layer-1 events from types.ts intentionally do NOT carry `ts` (they mirror
// the on-the-wire model SSE shape). Their builders therefore differ from
// the platform-event pattern below — they don't stamp `ts`.

export function buildMessageStart(args: Omit<MessageStartEvent, 'type'>): MessageStartEvent {
  return { type: 'message_start', ...args };
}

export function buildContentBlockStart(
  args: Omit<ContentBlockStartEvent, 'type'>,
): ContentBlockStartEvent {
  return { type: 'content_block_start', ...args };
}

export function buildContentBlockDelta(
  args: Omit<ContentBlockDeltaEvent, 'type'>,
): ContentBlockDeltaEvent {
  return { type: 'content_block_delta', ...args };
}

export function buildContentBlockStop(
  args: Omit<ContentBlockStopEvent, 'type'>,
): ContentBlockStopEvent {
  return { type: 'content_block_stop', ...args };
}

export function buildMessageDelta(args: Omit<MessageDeltaEvent, 'type'>): MessageDeltaEvent {
  return { type: 'message_delta', ...args };
}

export function buildMessageStop(args: Omit<MessageStopEvent, 'type'> = {}): MessageStopEvent {
  return { type: 'message_stop', ...args };
}

export function buildModelPing(args: Omit<ModelPingEvent, 'type'> = {}): ModelPingEvent {
  return { type: 'ping', ...args };
}

export function buildModelError(args: Omit<ModelErrorEvent, 'type'>): ModelErrorEvent {
  return { type: 'error', ...args };
}

// =============================================================================
// Layer 2 — Stream envelope
// =============================================================================

export function buildStreamStart(
  args: Args<StreamStartEvent>,
  nowOverride?: number,
): StreamStartEvent {
  return { type: 'stream_start', ts: now(nowOverride), ...args };
}

export function buildStreamEnd(
  args: Args<StreamEndEvent>,
  nowOverride?: number,
): StreamEndEvent {
  return { type: 'stream_end', ts: now(nowOverride), ...args };
}

export function buildDeltaResumeMarker(
  args: Args<DeltaResumeMarkerEvent>,
  nowOverride?: number,
): DeltaResumeMarkerEvent {
  return { type: 'delta_resume_marker', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 3 — Tool execution
// =============================================================================

export function buildToolExecuting(
  args: Args<ToolExecutingEvent>,
  nowOverride?: number,
): ToolExecutingEvent {
  return { type: 'tool_executing', ts: now(nowOverride), ...args };
}

export function buildToolCompleted(
  args: Args<ToolCompletedEvent>,
  nowOverride?: number,
): ToolCompletedEvent {
  return { type: 'tool_completed', ts: now(nowOverride), ...args };
}

export function buildToolFailed(
  args: Args<ToolFailedEvent>,
  nowOverride?: number,
): ToolFailedEvent {
  return { type: 'tool_failed', ts: now(nowOverride), ...args };
}

export function buildToolInputDelta(
  args: Args<ToolInputDeltaEvent>,
  nowOverride?: number,
): ToolInputDeltaEvent {
  return { type: 'tool_input_delta', ts: now(nowOverride), ...args };
}

export function buildToolOutputChunk(
  args: Args<ToolOutputChunkEvent>,
  nowOverride?: number,
): ToolOutputChunkEvent {
  return { type: 'tool_output_chunk', ts: now(nowOverride), ...args };
}

export function buildToolStatus(
  args: Args<ToolStatusEvent>,
  nowOverride?: number,
): ToolStatusEvent {
  return { type: 'tool_status', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 4 — Sub-agents
// =============================================================================

export function buildAgentStart(
  args: Args<AgentStartEvent>,
  nowOverride?: number,
): AgentStartEvent {
  return { type: 'agent_start', ts: now(nowOverride), ...args };
}

export function buildAgentStep(
  args: Args<AgentStepEvent>,
  nowOverride?: number,
): AgentStepEvent {
  return { type: 'agent_step', ts: now(nowOverride), ...args };
}

export function buildAgentStop(
  args: Args<AgentStopEvent>,
  nowOverride?: number,
): AgentStopEvent {
  return { type: 'agent_stop', ts: now(nowOverride), ...args };
}

export function buildParallelFanoutHeader(
  args: Args<ParallelFanoutHeaderEvent>,
  nowOverride?: number,
): ParallelFanoutHeaderEvent {
  return { type: 'parallel_fanout_header', ts: now(nowOverride), ...args };
}

export function buildSubAgentStarted(
  args: Args<SubAgentStartedEvent>,
  nowOverride?: number,
): SubAgentStartedEvent {
  return { type: 'sub_agent_started', ts: now(nowOverride), ...args };
}

export function buildSubAgentCompleted(
  args: Args<SubAgentCompletedEvent>,
  nowOverride?: number,
): SubAgentCompletedEvent {
  return { type: 'sub_agent_completed', ts: now(nowOverride), ...args };
}

export function buildAgentTreeUpdate(
  args: Args<AgentTreeUpdateEvent>,
  nowOverride?: number,
): AgentTreeUpdateEvent {
  return { type: 'agent_tree_update', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 5 — HITL
// =============================================================================

export function buildHitlRequest(
  args: Args<HitlRequestEvent>,
  nowOverride?: number,
): HitlRequestEvent {
  return { type: 'hitl_request', ts: now(nowOverride), ...args };
}

export function buildHitlResponse(
  args: Args<HitlResponseEvent>,
  nowOverride?: number,
): HitlResponseEvent {
  return { type: 'hitl_response', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 6 — Artifacts
// =============================================================================

export function buildArtifactStart(
  args: Args<ArtifactStartEvent>,
  nowOverride?: number,
): ArtifactStartEvent {
  return { type: 'artifact_start', ts: now(nowOverride), ...args };
}

export function buildArtifactDelta(
  args: Args<ArtifactDeltaEvent>,
  nowOverride?: number,
): ArtifactDeltaEvent {
  return { type: 'artifact_delta', ts: now(nowOverride), ...args };
}

export function buildArtifactComplete(
  args: Args<ArtifactCompleteEvent>,
  nowOverride?: number,
): ArtifactCompleteEvent {
  return { type: 'artifact_complete', ts: now(nowOverride), ...args };
}

export function buildComposeVisual(
  args: Args<ComposeVisualEvent>,
  nowOverride?: number,
): ComposeVisualEvent {
  return { type: 'compose_visual', ts: now(nowOverride), ...args };
}

export function buildComposeApp(
  args: Args<ComposeAppEvent>,
  nowOverride?: number,
): ComposeAppEvent {
  return { type: 'compose_app', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 7 — Viz hints / model handoff
// =============================================================================

export function buildTierHint(
  args: Args<TierHintEvent>,
  nowOverride?: number,
): TierHintEvent {
  return { type: 'tier_hint', ts: now(nowOverride), ...args };
}

export function buildModelHandoffOffer(
  args: Args<ModelHandoffOfferEvent>,
  nowOverride?: number,
): ModelHandoffOfferEvent {
  return { type: 'model_handoff_offer', ts: now(nowOverride), ...args };
}

export function buildVizHead(
  args: Args<VizHeadEvent>,
  nowOverride?: number,
): VizHeadEvent {
  return { type: 'viz_head', ts: now(nowOverride), ...args };
}

export function buildToolShortlistChip(
  args: Args<ToolShortlistChipEvent>,
  nowOverride?: number,
): ToolShortlistChipEvent {
  return { type: 'tool_shortlist_chip', ts: now(nowOverride), ...args };
}

export function buildStreamingTable(
  args: Args<StreamingTableEvent>,
  nowOverride?: number,
): StreamingTableEvent {
  return { type: 'streaming_table', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 8 — Trust / observability
// =============================================================================

export function buildDlpBlock(
  args: Args<DlpBlockEvent>,
  nowOverride?: number,
): DlpBlockEvent {
  return { type: 'dlp_block', ts: now(nowOverride), ...args };
}

export function buildAuditEvent(
  args: Args<AuditEventEvent>,
  nowOverride?: number,
): AuditEventEvent {
  return { type: 'audit_event', ts: now(nowOverride), ...args };
}

export function buildPolicyViolation(
  args: Args<PolicyViolationEvent>,
  nowOverride?: number,
): PolicyViolationEvent {
  return { type: 'policy_violation', ts: now(nowOverride), ...args };
}

export function buildRequestClarification(
  args: Args<RequestClarificationEvent>,
  nowOverride?: number,
): RequestClarificationEvent {
  return { type: 'request_clarification', ts: now(nowOverride), ...args };
}

export function buildCostPulse(
  args: Args<CostPulseEvent>,
  nowOverride?: number,
): CostPulseEvent {
  return { type: 'cost_pulse', ts: now(nowOverride), ...args };
}

export function buildCostRecord(
  args: Args<CostRecordEvent>,
  nowOverride?: number,
): CostRecordEvent {
  return { type: 'cost_record', ts: now(nowOverride), ...args };
}

export function buildUsage(args: Args<UsageEvent>, nowOverride?: number): UsageEvent {
  return { type: 'usage', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 9 — Data layers
// =============================================================================

export function buildRagCitation(
  args: Args<RagCitationEvent>,
  nowOverride?: number,
): RagCitationEvent {
  return { type: 'rag_citation', ts: now(nowOverride), ...args };
}

export function buildDocChunk(
  args: Args<DocChunkEvent>,
  nowOverride?: number,
): DocChunkEvent {
  return { type: 'doc_chunk', ts: now(nowOverride), ...args };
}

export function buildMemoryWrite(
  args: Args<MemoryWriteEvent>,
  nowOverride?: number,
): MemoryWriteEvent {
  return { type: 'memory_write', ts: now(nowOverride), ...args };
}

export function buildEmbeddingIndexed(
  args: Args<EmbeddingIndexedEvent>,
  nowOverride?: number,
): EmbeddingIndexedEvent {
  return { type: 'embedding_indexed', ts: now(nowOverride), ...args };
}

export function buildVectorProbe(
  args: Args<VectorProbeEvent>,
  nowOverride?: number,
): VectorProbeEvent {
  return { type: 'vector_probe', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 10 — MCP fabric
// =============================================================================

export function buildMcpConnect(
  args: Args<McpConnectEvent>,
  nowOverride?: number,
): McpConnectEvent {
  return { type: 'mcp_connect', ts: now(nowOverride), ...args };
}

export function buildMcpDisconnect(
  args: Args<McpDisconnectEvent>,
  nowOverride?: number,
): McpDisconnectEvent {
  return { type: 'mcp_disconnect', ts: now(nowOverride), ...args };
}

export function buildMcpCapabilityDelta(
  args: Args<McpCapabilityDeltaEvent>,
  nowOverride?: number,
): McpCapabilityDeltaEvent {
  return { type: 'mcp_capability_delta', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 11 — Codemode (UI virtual DOM)
// =============================================================================

export function buildUiOpen(args: Args<UiOpenEvent>, nowOverride?: number): UiOpenEvent {
  return { type: 'ui_open', ts: now(nowOverride), ...args };
}

export function buildUiPatch(args: Args<UiPatchEvent>, nowOverride?: number): UiPatchEvent {
  return { type: 'ui_patch', ts: now(nowOverride), ...args };
}

export function buildUiClose(args: Args<UiCloseEvent>, nowOverride?: number): UiCloseEvent {
  return { type: 'ui_close', ts: now(nowOverride), ...args };
}

export function buildUiEvent(args: Args<UiEventEvent>, nowOverride?: number): UiEventEvent {
  return { type: 'ui_event', ts: now(nowOverride), ...args };
}

export function buildKubeEvent(
  args: Args<KubeEventEvent>,
  nowOverride?: number,
): KubeEventEvent {
  return { type: 'kube_event', ts: now(nowOverride), ...args };
}

export function buildFilePanelUpdate(
  args: Args<FilePanelUpdateEvent>,
  nowOverride?: number,
): FilePanelUpdateEvent {
  return { type: 'file_panel_update', ts: now(nowOverride), ...args };
}

export function buildSlashCommandSynthetic(
  args: Args<SlashCommandSyntheticEvent>,
  nowOverride?: number,
): SlashCommandSyntheticEvent {
  return { type: 'slash_command_synthetic', ts: now(nowOverride), ...args };
}

export function buildSessionInfo(
  args: Args<SessionInfoEvent>,
  nowOverride?: number,
): SessionInfoEvent {
  return { type: 'session_info', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 12 — Flows
// =============================================================================

export function buildFlowNodeStart(
  args: Args<FlowNodeStartEvent>,
  nowOverride?: number,
): FlowNodeStartEvent {
  return { type: 'flow_node_start', ts: now(nowOverride), ...args };
}

export function buildFlowNodeEnd(
  args: Args<FlowNodeEndEvent>,
  nowOverride?: number,
): FlowNodeEndEvent {
  return { type: 'flow_node_end', ts: now(nowOverride), ...args };
}

export function buildNodeProgress(
  args: Args<NodeProgressEvent>,
  nowOverride?: number,
): NodeProgressEvent {
  return { type: 'node_progress', ts: now(nowOverride), ...args };
}

export function buildFlowCanvasState(
  args: Args<FlowCanvasStateEvent>,
  nowOverride?: number,
): FlowCanvasStateEvent {
  return { type: 'flow_canvas_state', ts: now(nowOverride), ...args };
}

export function buildLateSubscriberCatchup(
  args: Args<LateSubscriberCatchupEvent>,
  nowOverride?: number,
): LateSubscriberCatchupEvent {
  return { type: 'late_subscriber_catchup', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 13 — Session durability
// =============================================================================

export function buildSessionResume(
  args: Args<SessionResumeEvent>,
  nowOverride?: number,
): SessionResumeEvent {
  return { type: 'session_resume', ts: now(nowOverride), ...args };
}

export function buildReplayPacing(
  args: Args<ReplayPacingEvent>,
  nowOverride?: number,
): ReplayPacingEvent {
  return { type: 'replay_pacing', ts: now(nowOverride), ...args };
}

export function buildAgenticCliParity(
  args: Args<AgenticCliParityEvent>,
  nowOverride?: number,
): AgenticCliParityEvent {
  return { type: 'agentic_cli_parity', ts: now(nowOverride), ...args };
}

// =============================================================================
// Layer 14 — Platform error
// =============================================================================

export function buildPlatformError(
  args: Args<PlatformErrorEvent>,
  nowOverride?: number,
): PlatformErrorEvent {
  return { type: 'platform_error', ts: now(nowOverride), ...args };
}
