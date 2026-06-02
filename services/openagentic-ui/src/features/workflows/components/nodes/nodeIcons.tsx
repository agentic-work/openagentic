/**
 * nodeIcons.tsx - Custom SVG icons for each workflow node type
 * Replaces Lottie animations with crisp, lightweight SVGs.
 * All icons render at 18x18 by default, white fill for dark icon circles.
 */
// theme-allow: node-TYPE icon artwork. Every `#fff` here is the icon glyph rendered
// on the node's saturated category-color disc (legit on-accent/on-disc contrast — it
// must stay white regardless of theme), plus a handful of vendor brand logo SVGs
// (OpenAI etc.) and the node-TYPE category accent hues. Same carve-out as the workflow
// node-type identity palette + the "legit on-accent #fff" allowlist item.
import React from 'react';

const S = 18; // default icon size

// Helper: wrap common svg props
const svg = (children: React.ReactNode, vb = '0 0 24 24') => (
  <svg width={S} height={S} viewBox={vb} fill="none" xmlns="http://www.w3.org/2000/svg">
    {children}
  </svg>
);

// ── Trigger: lightning bolt ──
const TriggerIcon = () => svg(
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#fff" stroke="#fff" strokeWidth="0.5" strokeLinejoin="round" />
);

// ── LLM Completion: brain/neural ──
const LLMIcon = () => svg(
  <>
    <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17a1 1 0 001 1h6a1 1 0 001-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9 21h6M10 17v2M14 17v2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="10" cy="9" r="1" fill="#fff" />
    <circle cx="14" cy="9" r="1" fill="#fff" />
    <path d="M10 9l2 2 2-2" stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── A2A: two agents handshake ──
const A2AIcon = () => svg(
  <>
    <circle cx="7" cy="8" r="3" stroke="#fff" strokeWidth="1.5" />
    <circle cx="17" cy="8" r="3" stroke="#fff" strokeWidth="1.5" />
    <path d="M4 18c0-2.5 1.5-4 3-4s3 1.5 3 4M14 18c0-2.5 1.5-4 3-4s3 1.5 3 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 12h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="2 2" />
  </>
);

// ── Agent Spawn: forking arrows ──
const AgentSpawnIcon = () => svg(
  <>
    <circle cx="12" cy="6" r="3" stroke="#fff" strokeWidth="1.5" />
    <path d="M12 9v3M12 12l-5 5M12 12l5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="7" cy="18" r="2" stroke="#fff" strokeWidth="1.3" />
    <circle cx="17" cy="18" r="2" stroke="#fff" strokeWidth="1.3" />
  </>
);

// ── OpenAgentic LLM: branded sparkle ──
const OpenAgenticLLMIcon = () => svg(
  <>
    <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.15)" />
    <circle cx="12" cy="12" r="2.5" fill="#fff" />
  </>
);

// ── Multi-Agent: connected nodes ──
const MultiAgentIcon = () => svg(
  <>
    <circle cx="12" cy="5" r="2.5" stroke="#fff" strokeWidth="1.5" />
    <circle cx="6" cy="18" r="2.5" stroke="#fff" strokeWidth="1.5" />
    <circle cx="18" cy="18" r="2.5" stroke="#fff" strokeWidth="1.5" />
    <path d="M12 7.5v3.5l-6 4.5M12 11l6 4.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
  </>
);

// ── Reasoning: thought chain ──
const ReasoningIcon = () => svg(
  <>
    <circle cx="6" cy="12" r="2.5" stroke="#fff" strokeWidth="1.5" />
    <circle cx="12" cy="6" r="2" stroke="#fff" strokeWidth="1.5" />
    <circle cx="18" cy="12" r="2.5" stroke="#fff" strokeWidth="1.5" />
    <circle cx="12" cy="18" r="2" stroke="#fff" strokeWidth="1.5" />
    <path d="M8.2 10.5L10.5 7.5M13.5 7.5L15.8 10.5M15.8 13.5L13.5 16.5M10.5 16.5L8.2 13.5" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// ── MCP Tool: wrench/tool ──
const MCPToolIcon = () => svg(
  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3-3A5 5 0 0114.7 14l-6.3 6.3a2 2 0 01-2.8 0l-.6-.6a2 2 0 010-2.8L11.3 10.6A5 5 0 016.3 3.3l3 3z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
);

// ── Code: angle brackets ──
const CodeIcon = () => svg(
  <>
    <polyline points="16,18 22,12 16,6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="8,6 2,12 8,18" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="14" y1="4" x2="10" y2="20" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </>
);

// ── Openagentic: terminal prompt ──
const OpenagenticIcon = () => svg(
  <>
    <rect x="2" y="3" width="20" height="18" rx="2" stroke="#fff" strokeWidth="1.5" />
    <polyline points="6,10 10,13 6,16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="13" y1="16" x2="18" y2="16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </>
);

// ── HTTP Request: globe with arrow ──
const HTTPRequestIcon = () => svg(
  <>
    <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.5" />
    <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#fff" strokeWidth="1" />
    <line x1="3" y1="9" x2="21" y2="9" stroke="#fff" strokeWidth="1" />
    <line x1="3" y1="15" x2="21" y2="15" stroke="#fff" strokeWidth="1" />
    <path d="M17 7l3-3m0 0l-3-3m3 3h-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Webhook Response: return arrow ──
const WebhookResponseIcon = () => svg(
  <>
    <path d="M9 10l-5 5 5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 4v7a4 4 0 01-4 4H4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Condition: diamond/branch ──
const ConditionIcon = () => svg(
  <>
    <path d="M12 3l8 9-8 9-8-9 8-9z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <path d="M9 12h6M12 9v6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </>
);

// ── Switch: multi-way branch ──
const SwitchIcon = () => svg(
  <>
    <path d="M12 3l7 8-7 8-7-8 7-8z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <path d="M8 11h8M8 13h8M12 8v8" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// ── Loop: circular arrows ──
const LoopIcon = () => svg(
  <>
    <path d="M17 3a9 9 0 01.9 12.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 21a9 9 0 01-.9-12.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M21 3l-4 2 2-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 21l4-2-2 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Wait: hourglass ──
const WaitIcon = () => svg(
  <>
    <path d="M6 2h12M6 22h12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 2v4c0 2.8 2.2 5 5 5s5-2.2 5-5V2M7 22v-4c0-2.8 2.2-5 5-5s5 2.2 5 5v4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="1" fill="#fff" />
  </>
);

// ── Parallel: fork/fan-out ──
const SubWorkflowIcon = () => svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fff" strokeWidth="1.5" fill="none" />
    <rect x="7" y="7" width="10" height="10" rx="2" stroke="#fff" strokeWidth="1.2" fill="none" strokeDasharray="2 1.5" />
    <circle cx="10" cy="12" r="1.5" fill="#fff" />
    <line x1="11.5" y1="12" x2="14" y2="12" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" markerEnd="url(#arrowhead)" />
    <circle cx="14" cy="12" r="1.5" fill="#fff" />
  </>
);

const ParallelIcon = () => svg(
  <>
    <line x1="12" y1="2" x2="12" y2="8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="5" y1="8" x2="19" y2="8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="5" y1="8" x2="5" y2="14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="12" y1="8" x2="12" y2="14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="19" y1="8" x2="19" y2="14" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="5" y1="16" x2="19" y2="16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="12" y1="16" x2="12" y2="22" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="5" cy="14" r="1.5" fill="#fff" />
    <circle cx="12" cy="14" r="1.5" fill="#fff" />
    <circle cx="19" cy="14" r="1.5" fill="#fff" />
  </>
);

// ── Transform: funnel/filter ──
const TransformIcon = () => svg(
  <>
    <path d="M3 4h18l-7 8v6l-4 2V12L3 4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
  </>
);

// ── Merge: converging arrows ──
const MergeIcon = () => svg(
  <>
    <path d="M6 4v4c0 4 6 6 6 8M18 4v4c0 4-6 6-6 8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="12" y1="16" x2="12" y2="22" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="6" cy="4" r="1.5" fill="#fff" />
    <circle cx="18" cy="4" r="1.5" fill="#fff" />
    <path d="M9 20l3 2 3-2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── RAG Query: vector database search ──
const RAGQueryIcon = () => svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fff" strokeWidth="1.5" />
    <circle cx="8" cy="8" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="16" cy="8" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="8" cy="16" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="16" cy="16" r="1.5" fill="#fff" opacity="0.7" />
    <circle cx="12" cy="12" r="2" fill="#fff" />
    <path d="M8 8l4 4M16 8l-4 4M8 16l4-4M16 16l-4-4" stroke="#fff" strokeWidth="0.8" opacity="0.5" />
  </>
);

// ── File Upload: folder with arrow ──
const FileUploadIcon = () => svg(
  <>
    <path d="M4 20V6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 10v6M9 13l3-3 3 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Approval: shield check ──
const ApprovalIcon = () => svg(
  <>
    <path d="M12 2l8 4v5c0 5.5-3.8 10.7-8 12-4.2-1.3-8-6.5-8-12V6l8-4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Human Approval: hand raised ──
const HumanApprovalIcon = () => svg(
  <>
    <path d="M18 11V6a2 2 0 00-4 0" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 11V4a2 2 0 00-4 0v7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 11V6a2 2 0 00-4 0v7l-1.7 1.7a1 1 0 000 1.4l3 3a5 5 0 003.5 1.4h3.4a4 4 0 004-4v-4a2 2 0 00-4 0" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Agent Single: person with spark ──
const AgentSingleIcon = () => svg(
  <>
    <circle cx="12" cy="8" r="4" stroke="#fff" strokeWidth="1.5" />
    <path d="M4 21v-2a6 6 0 0112 0v2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M19 4l1 3 1-3-1-1-1 1z" fill="#fff" />
    <path d="M21 8l-1-1-1 1" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// ── Agent Pool: multiple agents ──
const AgentPoolIcon = () => svg(
  <>
    <circle cx="9" cy="7" r="3" stroke="#fff" strokeWidth="1.3" />
    <circle cx="16" cy="9" r="2.5" stroke="#fff" strokeWidth="1.3" />
    <path d="M2 20v-1.5a5 5 0 0110 0V20" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M14 20v-1a4 4 0 018 0v1" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
  </>
);

// ── Agent Supervisor: eye/overseer ──
const AgentSupervisorIcon = () => svg(
  <>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="1" fill="#fff" />
  </>
);

// ── Synth: waveform ──
const SynthIcon = () => svg(
  <>
    <path d="M2 12h3l2-6 3 12 3-8 2 4h2l3-6 2 4h2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Error Handler: alert triangle ──
const ErrorHandlerIcon = () => svg(
  <>
    <path d="M12 2L2 20h20L12 2z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <line x1="12" y1="9" x2="12" y2="14" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="17" r="1" fill="#fff" />
  </>
);

// ── User Context: person with data ──
const UserContextIcon = () => svg(
  <>
    <circle cx="12" cy="7" r="4" stroke="#fff" strokeWidth="1.5" />
    <path d="M5 21v-2a7 7 0 0114 0v2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="15" y="15" width="7" height="5" rx="1" stroke="#fff" strokeWidth="1.2" />
    <line x1="17" y1="17" x2="20" y2="17" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
    <line x1="17" y1="18.5" x2="19" y2="18.5" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// ── Send Email: envelope ──
const SendEmailIcon = () => svg(
  <>
    <rect x="2" y="4" width="20" height="16" rx="2" stroke="#fff" strokeWidth="1.5" />
    <polyline points="2,4 12,13 22,4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Text Splitter: scissors cutting text ──
const TextSplitterIcon = () => svg(
  <>
    <path d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6z" stroke="#fff" strokeWidth="1.5" />
    <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </>
);

// ── Embedding: magnetic/vector field ──
const EmbeddingIcon = () => svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" stroke="#fff" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="1.5" fill="#fff" />
    <circle cx="16" cy="8" r="1.5" fill="#fff" />
    <circle cx="8" cy="16" r="1.5" fill="#fff" />
    <circle cx="16" cy="16" r="1.5" fill="#fff" />
    <circle cx="12" cy="12" r="1.5" fill="#fff" />
    <path d="M8 8l4 4M16 8l-4 4M8 16l4-4M16 16l-4-4" stroke="#fff" strokeWidth="0.8" strokeDasharray="2 1" />
  </>
);

// ── Vector Store: database with vector arrows ──
const VectorStoreIcon = () => svg(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="3" stroke="#fff" strokeWidth="1.5" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" stroke="#fff" strokeWidth="1.5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke="#fff" strokeWidth="1.5" />
    <path d="M10 9l2 2 2-2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Document Loader: document with download arrow ──
const DocumentLoaderIcon = () => svg(
  <>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <polyline points="14,2 14,8 20,8" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 12v5M9 15l3 3 3-3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// ── Structured Output: JSON schema brackets ──
const StructuredOutputIcon = () => svg(
  <>
    <path d="M4 7c0-1.1.9-2 2-2h2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M4 17c0 1.1.9 2 2 2h2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M20 7c0-1.1-.9-2-2-2h-2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M20 17c0 1.1-.9 2-2 2h-2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="9" y1="9" x2="15" y2="9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="9" y1="12" x2="13" y2="12" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="9" y1="15" x2="15" y2="15" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
  </>
);

// ── Guardrails: shield with warning ──
const GuardrailsIcon = () => svg(
  <>
    <path d="M12 2l8 4v5c0 5.5-3.8 10.7-8 12-4.2-1.3-8-6.5-8-12V6l8-4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <line x1="12" y1="8" x2="12" y2="13" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1" fill="#fff" />
  </>
);

// ── Default/fallback: generic process ──
const DefaultNodeIcon = () => svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" stroke="#fff" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="1.5" />
    <line x1="12" y1="3" x2="12" y2="9" stroke="#fff" strokeWidth="1" />
    <line x1="12" y1="15" x2="12" y2="21" stroke="#fff" strokeWidth="1" />
    <line x1="3" y1="12" x2="9" y2="12" stroke="#fff" strokeWidth="1" />
    <line x1="15" y1="12" x2="21" y2="12" stroke="#fff" strokeWidth="1" />
  </>
);

// ── Master lookup ──
const NODE_ICONS: Record<string, () => React.ReactElement> = {
  trigger: TriggerIcon,
  llm_completion: LLMIcon,
  a2a: A2AIcon,
  agent_spawn: AgentSpawnIcon,
  openagentic_llm: OpenAgenticLLMIcon,
  multi_agent: MultiAgentIcon,
  reasoning: ReasoningIcon,
  mcp_tool: MCPToolIcon,
  code: CodeIcon,
  openagentic: OpenagenticIcon,
  http_request: HTTPRequestIcon,
  webhook_response: WebhookResponseIcon,
  condition: ConditionIcon,
  switch: SwitchIcon,
  loop: LoopIcon,
  wait: WaitIcon,
  sub_workflow: SubWorkflowIcon,
  parallel: ParallelIcon,
  transform: TransformIcon,
  merge: MergeIcon,
  rag_query: RAGQueryIcon,
  file_upload: FileUploadIcon,
  approval: ApprovalIcon,
  human_approval: HumanApprovalIcon,
  agent_single: AgentSingleIcon,
  agent_pool: AgentPoolIcon,
  agent_supervisor: AgentSupervisorIcon,
  synth: SynthIcon,
  synth_synthesize: SynthIcon,
  error_handler: ErrorHandlerIcon,
  user_context: UserContextIcon,
  send_email: SendEmailIcon,
  // Data pipeline nodes
  text_splitter: TextSplitterIcon,
  embedding: EmbeddingIcon,
  vector_store: VectorStoreIcon,
  document_loader: DocumentLoaderIcon,
  structured_output: StructuredOutputIcon,
  guardrails: GuardrailsIcon,
  // AI Builder fallback types — map to closest icon
  output: TransformIcon,
  output_result: TransformIcon,
  result: TransformIcon,
  input: TriggerIcon,
  start: TriggerIcon,
  end: TransformIcon,
  prompt: LLMIcon,
  chat: LLMIcon,
  completion: LLMIcon,
  api: HTTPRequestIcon,
  rest: HTTPRequestIcon,
  fetch: HTTPRequestIcon,
  branch: ConditionIcon,
  if: ConditionIcon,
  filter: TransformIcon,
  email: SendEmailIcon,
  notification: SendEmailIcon,
  // Integrations covered by vendor SVGs in getVendorIcon — no duplication needed
};

/**
 * Get the SVG icon component for a given node type.
 * Returns null if no icon defined (caller should check vendor icons first).
 */
export function getNodeIcon(nodeType: string): React.ReactElement {
  const factory = NODE_ICONS[nodeType];
  return factory ? factory() : DefaultNodeIcon();
}

// ═══════════════════════════════════════════════════════════════════
// Agent Type Icons — unique SVG per agent role, used in sidebar,
// canvas nodes, and admin console. Single source of truth for
// agent visual identity.
// ═══════════════════════════════════════════════════════════════════

// Data Query: magnifying glass over data rows
const AgentDataQueryIcon = () => svg(
  <>
    <rect x="3" y="4" width="12" height="3" rx="1" stroke="#fff" strokeWidth="1.3" />
    <rect x="3" y="9" width="12" height="3" rx="1" stroke="#fff" strokeWidth="1.3" />
    <rect x="3" y="14" width="8" height="3" rx="1" stroke="#fff" strokeWidth="1.3" />
    <circle cx="17" cy="17" r="4" stroke="#fff" strokeWidth="1.5" />
    <line x1="20" y1="20" x2="22" y2="22" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </>
);

// Data Extraction: funnel/filter extracting data
const AgentDataExtractionIcon = () => svg(
  <>
    <path d="M3 4h18l-6 7v5l-4 3V11L3 4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
    <circle cx="7" cy="6" r="1" fill="#fff" />
    <circle cx="12" cy="6" r="1" fill="#fff" />
    <circle cx="17" cy="6" r="1" fill="#fff" />
  </>
);

// Tool Orchestration: wrench + gears connected
const AgentToolOrchIcon = () => svg(
  <>
    <circle cx="7" cy="7" r="3" stroke="#fff" strokeWidth="1.3" />
    <circle cx="7" cy="7" r="1" fill="#fff" />
    <circle cx="17" cy="7" r="2.5" stroke="#fff" strokeWidth="1.3" />
    <circle cx="17" cy="7" r="0.8" fill="#fff" />
    <path d="M10 7h4" stroke="#fff" strokeWidth="1.2" />
    <path d="M6 17l3-2 3 2 3-4 3 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="4" y1="20" x2="20" y2="20" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// Reasoning: chain of connected thought bubbles
const AgentReasoningIcon = () => svg(
  <>
    <circle cx="6" cy="8" r="3.5" stroke="#fff" strokeWidth="1.3" />
    <circle cx="18" cy="8" r="3.5" stroke="#fff" strokeWidth="1.3" />
    <path d="M9.5 8h5" stroke="#fff" strokeWidth="1.2" strokeDasharray="2 1.5" />
    <path d="M12 14l-2 4h4l-2-4z" fill="#fff" />
    <circle cx="12" cy="20" r="1.5" stroke="#fff" strokeWidth="1.2" />
    <path d="M6 11.5v1M18 11.5v1" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
  </>
);

// Summarization: document with condensed lines
const AgentSummarizationIcon = () => svg(
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" stroke="#fff" strokeWidth="1.3" fill="rgba(255,255,255,0.05)" />
    <line x1="7" y1="6" x2="17" y2="6" stroke="#fff" strokeWidth="0.8" opacity="0.4" />
    <line x1="7" y1="8.5" x2="17" y2="8.5" stroke="#fff" strokeWidth="0.8" opacity="0.4" />
    <line x1="7" y1="11" x2="14" y2="11" stroke="#fff" strokeWidth="0.8" opacity="0.4" />
    <line x1="7" y1="15" x2="17" y2="15" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="7" y1="18" x2="13" y2="18" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </>
);

// Code Execution: terminal with cursor
const AgentCodeExecIcon = () => svg(
  <>
    <rect x="2" y="3" width="20" height="18" rx="2" stroke="#fff" strokeWidth="1.3" fill="rgba(255,255,255,0.05)" />
    <path d="M6 9l3 3-3 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="12" y1="15" x2="18" y2="15" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </>
);

// Planning: clipboard with checkboxes
const AgentPlanningIcon = () => svg(
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" stroke="#fff" strokeWidth="1.3" />
    <path d="M9 2h6v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V2z" stroke="#fff" strokeWidth="1.2" fill="rgba(255,255,255,0.1)" />
    <rect x="8" y="9" width="2" height="2" rx="0.5" stroke="#fff" strokeWidth="1" />
    <line x1="12" y1="10" x2="16" y2="10" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M8.5 14l0.7 0.7 1.3-1.4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="12" y1="14" x2="16" y2="14" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    <rect x="8" y="17" width="2" height="2" rx="0.5" stroke="#fff" strokeWidth="1" />
    <line x1="12" y1="18" x2="16" y2="18" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
  </>
);

// Validation: shield with checkmark
const AgentValidationIcon = () => svg(
  <>
    <path d="M12 2l8 4v6c0 5.5-3.8 9.7-8 11-4.2-1.3-8-5.5-8-11V6l8-4z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.05)" />
    <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>
);

// Synthesis: merging streams into one
const AgentSynthesisIcon = () => svg(
  <>
    <circle cx="5" cy="5" r="2" stroke="#fff" strokeWidth="1.3" />
    <circle cx="5" cy="19" r="2" stroke="#fff" strokeWidth="1.3" />
    <circle cx="19" cy="12" r="3" stroke="#fff" strokeWidth="1.5" />
    <path d="M7 5h4l5 7M7 19h4l5-7" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="19" cy="12" r="1" fill="#fff" />
  </>
);

// Artifact Creation: paintbrush/canvas
const AgentArtifactIcon = () => svg(
  <>
    <rect x="3" y="3" width="14" height="18" rx="1" stroke="#fff" strokeWidth="1.3" fill="rgba(255,255,255,0.05)" />
    <path d="M21 3l-4 4 2 2 4-4-2-2z" fill="#fff" opacity="0.9" />
    <path d="M17 7l-6 6v2h2l6-6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="7" cy="17" r="1.5" fill="#fff" opacity="0.5" />
    <circle cx="11" cy="7" r="1" fill="#fff" opacity="0.5" />
  </>
);

// OAT Function Builder: function braces f(x)
const AgentOatFunctionIcon = () => svg(
  <>
    <path d="M8 3c-2 0-2 2-2 4s0 3-2 4c2 1 2 3 2 5s0 4 2 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 3c2 0 2 2 2 4s0 3 2 4c-2 1-2 3-2 5s0 4-2 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.5 9.5h2M11.5 9.5v5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="13.6" cy="14" r="0.9" fill="#fff" />
  </>
);

// Cloud Operations: cloud with a gear
const AgentCloudOpsIcon = () => svg(
  <>
    <path d="M7 18a4 4 0 01-.4-7.98A5 5 0 0116 9.5a3.5 3.5 0 01.2 6.99" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.05)" />
    <circle cx="13" cy="17.5" r="2.4" stroke="#fff" strokeWidth="1.3" />
    <path d="M13 14.4v-1M13 21.6v-1M16.1 17.5h-1M10.9 17.5h-1" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    <circle cx="13" cy="17.5" r="0.8" fill="#fff" />
  </>
);

// Custom: puzzle piece
const AgentCustomIcon = () => svg(
  <>
    <path d="M4 7h3a2 2 0 110 4H4v6h6v-3a2 2 0 114 0v3h6V7h-6v3a2 2 0 11-4 0V7H4z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" fill="rgba(255,255,255,0.05)" />
  </>
);

/** Maps agent_type (from DB) → SVG icon component. Used in sidebar, canvas, and admin. */
export const AGENT_TYPE_ICONS: Record<string, () => React.ReactElement> = {
  data_query: AgentDataQueryIcon,
  data_extraction: AgentDataExtractionIcon,
  tool_orchestration: AgentToolOrchIcon,
  reasoning: AgentReasoningIcon,
  summarization: AgentSummarizationIcon,
  code_execution: AgentCodeExecIcon,
  planning: AgentPlanningIcon,
  validation: AgentValidationIcon,
  synthesis: AgentSynthesisIcon,
  artifact_creation: AgentArtifactIcon,
  oat_function_builder: AgentOatFunctionIcon,
  cloud_operations: AgentCloudOpsIcon,
  custom: AgentCustomIcon,
};

/** Canonical colors per agent type — matches admin console badge colors */
export const AGENT_TYPE_COLORS: Record<string, string> = {
  data_query: '#3b82f6',        // blue
  data_extraction: '#06b6d4',   // cyan
  tool_orchestration: '#f59e0b',// amber
  reasoning: '#7c3aed',         // violet
  summarization: '#8b5cf6',     // purple
  code_execution: '#10b981',    // emerald
  planning: '#6366f1',          // indigo
  validation: '#ef4444',        // red
  synthesis: '#a855f7',         // purple-500
  artifact_creation: '#ec4899', // pink
  oat_function_builder: '#14b8a6', // teal
  cloud_operations: '#0ea5e9',  // sky
  custom: '#64748b',            // slate
};

/**
 * Get the SVG icon for an agent type.
 * Falls back to AgentCustomIcon if type is unknown.
 */
export function getAgentTypeIcon(agentType: string): React.ReactElement {
  const factory = AGENT_TYPE_ICONS[agentType] || AGENT_TYPE_ICONS.custom;
  return factory();
}

/**
 * Get the color for an agent type.
 */
export function getAgentTypeColor(agentType: string): string {
  return AGENT_TYPE_COLORS[agentType] || AGENT_TYPE_COLORS.custom;
}
