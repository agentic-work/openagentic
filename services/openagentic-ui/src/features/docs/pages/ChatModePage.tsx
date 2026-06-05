import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsBrainIcon, DocsAgentIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// DIAGRAMS
// ============================================================================

const chatPipelineDiagram: DiagramDefinition = {
  type: 'process',
  title: 'Chat Pipeline — 10 Stages',
  description: 'Every message passes through this sequence',
  layout: 'horizontal',
  nodes: [
    { id: 'auth', label: 'Auth', description: 'Token validation', shape: 'rounded', color: 'gray' },
    { id: 'validation', label: 'Validation', description: 'Input + rate limit', shape: 'rounded', color: 'gray' },
    { id: 'rag', label: 'RAG', description: 'Vector search', shape: 'rounded', color: 'cyan' },
    { id: 'memory', label: 'Memory', description: 'Context window', shape: 'rounded', color: 'purple' },
    { id: 'prompt', label: 'Prompt', description: 'System + user', shape: 'rounded', color: 'indigo' },
    { id: 'mcp', label: 'MCP', description: 'Tool matching', shape: 'rounded', color: 'orange' },
    { id: 'agents', label: 'Agents', description: 'Delegation', shape: 'rounded', color: 'purple' },
    { id: 'msg-prep', label: 'MessagePreparation', description: 'Dedup + validate', shape: 'rounded', color: 'blue' },
    { id: 'completion', label: 'Completion', description: 'Streaming', shape: 'rounded', color: 'green' },
    { id: 'response', label: 'Response', description: 'SSE stream', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'auth', target: 'validation', animated: true },
    { source: 'validation', target: 'rag' },
    { source: 'rag', target: 'memory' },
    { source: 'memory', target: 'prompt' },
    { source: 'prompt', target: 'mcp' },
    { source: 'mcp', target: 'agents' },
    { source: 'agents', target: 'msg-prep' },
    { source: 'msg-prep', target: 'completion' },
    { source: 'completion', target: 'response', animated: true },
  ],
};

const agentDelegationDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Agent Delegation',
  description: 'How the orchestrator spawns specialist agents',
  layout: 'vertical',
  nodes: [
    { id: 'orchestrator', label: 'Orchestrator', description: 'Primary agent', shape: 'rounded', color: 'primary' },
    { id: 'reasoning', label: 'reasoning', description: 'Multi-step reasoning', shape: 'rounded', color: 'blue' },
    { id: 'code_execution', label: 'code_execution', description: 'Code gen & execution', shape: 'rounded', color: 'green' },
    { id: 'data_query', label: 'data_query', description: 'Dataset queries', shape: 'rounded', color: 'cyan' },
    { id: 'tool_orchestration', label: 'tool_orchestration', description: 'Tool selection', shape: 'rounded', color: 'purple' },
    { id: 'summarization', label: 'summarization', description: 'Content summarization', shape: 'rounded', color: 'orange' },
  ],
  edges: [
    { source: 'orchestrator', target: 'reasoning', label: 'delegate', style: 'dashed' },
    { source: 'orchestrator', target: 'code_execution', label: 'delegate', style: 'dashed' },
    { source: 'orchestrator', target: 'data_query', label: 'delegate', style: 'dashed' },
    { source: 'orchestrator', target: 'tool_orchestration', label: 'delegate', style: 'dashed' },
    { source: 'orchestrator', target: 'summarization', label: 'delegate', style: 'dashed' },
  ],
};

const toolSelectionDiagram: DiagramDefinition = {
  type: 'flowchart',
  title: 'MCP Tool Selection — Three-Tier Fallback',
  description: 'pgvector, Milvus GPU, Redis cache',
  layout: 'horizontal',
  nodes: [
    { id: 'query', label: 'User Query', description: 'Embedded as vector', shape: 'rounded', color: 'primary' },
    { id: 'pgvector', label: 'pgvector', description: 'Primary search', shape: 'database', color: 'blue' },
    { id: 'milvus', label: 'Milvus GPU', description: 'Fallback search', shape: 'database', color: 'cyan' },
    { id: 'redis', label: 'Redis Cache', description: 'Cached results', shape: 'database', color: 'red' },
    { id: 'ranked', label: 'Ranked Tools', description: 'Top-k results', shape: 'rounded', color: 'green' },
  ],
  edges: [
    { source: 'query', target: 'pgvector', animated: true },
    { source: 'pgvector', target: 'milvus', label: 'fallback', style: 'dashed' },
    { source: 'pgvector', target: 'redis', label: 'cache hit', style: 'dashed' },
    { source: 'milvus', target: 'ranked' },
    { source: 'redis', target: 'ranked' },
    { source: 'pgvector', target: 'ranked' },
  ],
};

// ============================================================================
// PIPELINE STAGES
// ============================================================================

const pipelineStages = [
  {
    name: 'Auth',
    desc: 'Every request is validated against the session token or API key. SSO tokens from Microsoft Entra ID, Google Workspace, or OIDC providers are verified. Invalid tokens receive a 401 before any processing begins.',
  },
  {
    name: 'Validation',
    desc: 'Input is sanitized and validated. Per-user and per-organization rate limits are enforced using a sliding-window algorithm backed by Redis. Limits are configurable per tier and include both request count and token budget constraints. DLP scanning also runs within this stage.',
  },
  {
    name: 'RAG',
    desc: 'The user query is embedded using the configured embedding model and searched against pgvector (primary) and Milvus (GPU-accelerated fallback). Relevant document chunks are injected into the prompt context.',
  },
  {
    name: 'Memory',
    desc: 'Conversation history is loaded from Redis and trimmed to fit the model context window. A sliding-window strategy preserves the most recent turns while keeping the system prompt and RAG context intact.',
  },
  {
    name: 'Prompt',
    desc: 'The system prompt, RAG context, memory, user message, and any tool definitions are assembled into the final prompt payload. Token counting ensures the assembled prompt fits within model limits.',
  },
  {
    name: 'MCP',
    desc: 'The query is matched against available MCP tool descriptions using vector similarity. The top-k tools are attached to the prompt as function definitions, enabling the model to invoke them during generation.',
  },
  {
    name: 'Agents',
    desc: 'If the orchestrator determines that a specialist agent would handle the request better, it delegates to one or more sub-agents. Each agent has its own system prompt and tool set. Background agent results are injected into context.',
  },
  {
    name: 'MessagePreparation',
    desc: 'Messages are deduplicated and validated before being sent to the LLM. This stage ensures the final message array is clean and well-formed.',
  },
  {
    name: 'Completion',
    desc: 'The assembled prompt is sent to the selected LLM provider. The SmartModelRouter scores each request and picks the model — balancing capability against per-user and per-model budget caps. Responses stream via SSE.',
  },
  {
    name: 'Response',
    desc: 'The generated response streams back to the client in real-time via Server-Sent Events. Token usage is logged for cost tracking, the conversation memory is updated, and audit records are written.',
  },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-textMuted)',
  marginBottom: '8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: '16px',
  lineHeight: 1.2,
};

const proseStyle: React.CSSProperties = {
  fontSize: '15px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.7,
  maxWidth: '680px',
};

// ============================================================================
// COMPONENT
// ============================================================================

const ChatModePage: React.FC = () => {
  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* HEADER */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ marginBottom: '56px' }}
      >
        <div style={{ marginBottom: '20px' }}>
          <DocsBrainIcon size={40} />
        </div>
        <h1
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          How Chat Works
        </h1>
        <p style={proseStyle}>
          The OpenAgentic chat interface is more than a simple LLM wrapper. Every message
          passes through a 10-stage pipeline that handles authentication, validation,
          knowledge retrieval, tool matching, agent delegation, and intelligent model routing — all before
          a single token is generated.
        </p>
      </motion.div>

      {/* PIPELINE DIAGRAM */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Pipeline</p>
        <h2 style={sectionTitleStyle}>The Chat Pipeline</h2>
        <p style={{ ...proseStyle, marginBottom: '28px' }}>
          Each stage is a discrete middleware function. Stages can short-circuit the
          pipeline (e.g., DLP blocking a message) or enrich the context for downstream
          stages (e.g., RAG adding document chunks).
        </p>

        <ReactFlowDiagram
          diagram={chatPipelineDiagram}
          height={320}
          interactive
          showControls
        />
      </motion.section>

      {/* STAGE DETAILS */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Stage Details</p>
        <h2 style={sectionTitleStyle}>What Happens at Each Stage</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {pipelineStages.map((stage, i) => (
            <div
              key={stage.name}
              style={{
                display: 'flex',
                gap: '20px',
                padding: '20px 24px',
                background: i % 2 === 0 ? 'var(--color-surface)' : 'transparent',
                borderRadius: '10px',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-textMuted)',
                }}
              >
                {i + 1}
              </div>
              <div>
                <h4
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    marginBottom: '4px',
                  }}
                >
                  {stage.name}
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.65 }}>
                  {stage.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      {/* SMART MODEL ROUTING */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Model Routing</p>
        <h2 style={sectionTitleStyle}>Smart Model Routing</h2>
        <p style={{ ...proseStyle, marginBottom: '28px' }}>
          Every message is routed automatically. The SmartModelRouter scores each request by
          capability requirements and routes it to the best-fit model across the configured
          providers — balancing reasoning depth against per-user and per-model budget caps.
          There are no hardcoded model IDs in the routing path; the model registry is the source
          of truth.
        </p>

        <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
          The router considers message complexity, conversation history length, and whether
          tools or agents will be needed. A simple factual question may be routed to a fast
          model even when a larger one is available if the router determines that the larger
          model would not produce meaningfully better output.
        </p>
      </motion.section>

      {/* AGENT DELEGATION */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Orchestration</p>
        <h2 style={sectionTitleStyle}>Agent Delegation</h2>
        <p style={{ ...proseStyle, marginBottom: '28px' }}>
          The primary orchestrator agent analyzes each request and decides whether to handle
          it directly or delegate to a specialist. Delegation is transparent to the user —
          the orchestrator synthesizes sub-agent responses into a coherent reply.
        </p>

        <ReactFlowDiagram
          diagram={agentDelegationDiagram}
          height={420}
          interactive
          showControls
        />
      </motion.section>

      {/* TOOL SELECTION */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Tool Integration</p>
        <h2 style={sectionTitleStyle}>MCP Tool Selection</h2>
        <p style={{ ...proseStyle, marginBottom: '28px' }}>
          When the user query implies a tool is needed, the system embeds the query and
          searches for matching MCP tool descriptions. A three-tier fallback ensures
          reliability: pgvector (primary), Milvus GPU (large-scale), and Redis (cached results).
        </p>

        <ReactFlowDiagram
          diagram={toolSelectionDiagram}
          height={300}
          interactive
          showControls
        />
      </motion.section>

      {/* TIPS */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Best Practices</p>
        <h2 style={sectionTitleStyle}>Tips for Effective Use</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            {
              title: 'Be specific about your goal',
              body: 'The orchestrator makes better delegation decisions when the intent is clear. "Analyze the Q3 revenue data and create a chart" triggers the data agent; "help me with data" may not.',
            },
            {
              title: 'Let the router pick the model',
              body: 'Quick questions (definitions, simple lookups) are routed to fast, inexpensive models automatically. Complex reasoning, code review, and long-form writing are routed to stronger models by the SmartModelRouter.',
            },
            {
              title: 'Leverage tool context',
              body: 'Mention specific systems ("check our Kubernetes pods", "look at the GitHub PR") to help the tool selector match the right MCP server on the first pass.',
            },
            {
              title: 'Build on conversation context',
              body: 'The memory system maintains context across turns. Follow-up questions like "now do the same for Q4" work naturally without re-explaining the full context.',
            },
          ].map((tip) => (
            <div
              key={tip.title}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                padding: '20px 24px',
              }}
            >
              <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>
                {tip.title}
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
                {tip.body}
              </p>
            </div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default ChatModePage;
