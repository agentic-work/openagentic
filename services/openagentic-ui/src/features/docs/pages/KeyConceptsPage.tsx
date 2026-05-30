import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';
import {
  DocsAgentIcon,
  DocsToolIcon,
  DocsBrainIcon,
  DocsFlowIcon,
  DocsShieldIcon,
  DocsBookIcon,
  DocsCodeIcon,
} from '../components/DocsIcons';

// ============================================================================
// CONCEPTS DATA
// ============================================================================

interface Concept {
  title: string;
  slug: string;
  icon: React.FC<{ size?: number }>;
  summary: string;
  detail: string;
  linkPage: string;
}

const concepts: Concept[] = [
  {
    title: 'Agents',
    slug: 'agents',
    icon: DocsAgentIcon,
    summary: 'Specialized AI personas that handle different types of tasks.',
    detail:
      'OpenAgentic has 11 agent types, each with its own system prompt and tool access. All agents use the SmartRouter for dynamic model selection based on configured providers. The orchestrator analyzes incoming requests and delegates to the right specialist — a reasoning agent for complex tasks, a code_execution agent for programming, a data_query agent for analysis, and so on. Agents can invoke MCP tools and return structured results.',
    linkPage: 'agent-delegation',
  },
  {
    title: 'MCP (Model Context Protocol)',
    slug: 'mcp',
    icon: DocsToolIcon,
    summary: 'A standardized protocol for connecting AI models to external tools and data sources.',
    detail:
      'MCP is an open protocol that defines how language models discover, invoke, and receive results from external tools. OpenAgentic runs 16 MCP servers that provide access to Azure, AWS, Kubernetes, GitHub, Jira, databases, web search, file systems, and more. Tools are selected automatically via vector similarity matching.',
    linkPage: 'what-is-mcp',
  },
  {
    title: 'Chat Pipeline',
    slug: 'pipeline',
    icon: DocsBrainIcon,
    summary: 'The multi-stage request processing chain that every message traverses.',
    detail:
      'Every chat message passes through 10 discrete stages: Auth, Validation, RAG, Memory, Prompt, MCP, Agents, MessagePreparation, Completion, and Response. Each stage can enrich context, short-circuit with an error, or transform the request.',
    linkPage: 'how-chat-works',
  },
  {
    title: 'Workflows / Flows',
    slug: 'flows',
    icon: DocsFlowIcon,
    summary: 'Visual drag-and-drop automation pipelines with 34 node types.',
    detail:
      'Flows let you build multi-step automation without code. Connect AI tasks, data transformations, API calls, conditional branches, loops, and human approval gates in a visual canvas. Flows can be triggered on a schedule (cron), via webhooks, or through the API. The engine supports parallel execution and error handling.',
    linkPage: 'flow-builder',
  },
  {
    title: 'OAT (Tool Synthesis)',
    slug: 'oat',
    icon: DocsCodeIcon,
    summary: 'On-the-fly generation of new MCP tools when existing ones cannot fulfill a request.',
    detail:
      'When the model determines that no existing tool matches the user intent, OAT (On-demand Agentic Tooling) can synthesize a new tool implementation. The generated tool code runs in a sandboxed environment, is validated for safety, and can be promoted to a permanent tool if useful. This extends the platform capabilities dynamically.',
    linkPage: 'tool-execution',
  },
  {
    title: 'HITL (Human-in-the-Loop)',
    slug: 'hitl',
    icon: DocsShieldIcon,
    summary: 'Approval gates that require human confirmation before sensitive actions execute.',
    detail:
      'HITL gates can be configured on any tool invocation, agent delegation, or workflow node. When triggered, the pipeline pauses and sends an approval request to designated reviewers. Approvals can be required for actions like deploying code, modifying infrastructure, sending emails, or accessing sensitive data. Timeouts and escalation paths are configurable.',
    linkPage: 'hitl-approvals',
  },
  {
    title: 'DLP (Data Loss Prevention)',
    slug: 'dlp',
    icon: DocsShieldIcon,
    summary: 'Real-time scanning of messages for sensitive data patterns.',
    detail:
      'The DLP scanner runs on both inbound and outbound messages, checking for PII (names, emails, phone numbers, SSNs), credentials (API keys, passwords, tokens), and custom patterns defined by administrators. When a match is found, the system can redact the data, warn the user, or block the message entirely.',
    linkPage: 'dlp-scanner',
  },
];

// ============================================================================
// AGENT TYPES (static fallback; enriched by manifest when loaded)
// ============================================================================

const agentTypes = [
  { name: 'data_query', purpose: 'Queries stored datasets (fast, simple)', model: 'Auto (SmartRouter)' },
  { name: 'data_extraction', purpose: 'Extracts/filters data from large responses', model: 'Auto (SmartRouter)' },
  { name: 'tool_orchestration', purpose: 'Decides which tools to call', model: 'Auto (SmartRouter)' },
  { name: 'reasoning', purpose: 'Complex multi-step reasoning', model: 'Auto (SmartRouter)' },
  { name: 'summarization', purpose: 'Summarizes large content', model: 'Auto (SmartRouter)' },
  { name: 'code_execution', purpose: 'Code generation/execution', model: 'Auto (SmartRouter)' },
  { name: 'planning', purpose: 'Plans multi-step tasks', model: 'Auto (SmartRouter)' },
  { name: 'validation', purpose: 'Validates tool outputs', model: 'Auto (SmartRouter)' },
  { name: 'synthesis', purpose: 'Synthesizes final response', model: 'Auto (SmartRouter)' },
  { name: 'artifact_creation', purpose: 'Visual artifact generation (dashboards, reports, diagrams)', model: 'Auto (SmartRouter)' },
  { name: 'custom', purpose: 'Custom agent type', model: 'Auto (SmartRouter)' },
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

const KeyConceptsPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  // Attempt to load agent manifest for enriched data
  useEffect(() => {
    if (!loadedManifests.has('agents')) {
      loadManifest('agents').catch(() => {
        /* manifest may not exist yet */
      });
    }
  }, [loadManifest, loadedManifests]);

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
          <DocsBookIcon size={40} />
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
          Key Concepts
        </h1>
        <p style={proseStyle}>
          These are the foundational ideas behind OpenAgentic. Understanding them will
          help you make the most of the platform — whether you are chatting, writing code,
          or building automated workflows.
        </p>
      </motion.div>

      {/* CONCEPT CARDS */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {concepts.map((concept, i) => (
            <motion.div
              key={concept.slug}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05, duration: 0.35 }}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '14px',
                padding: '28px',
                display: 'flex',
                gap: '20px',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                <concept.icon size={28} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    marginBottom: '6px',
                  }}
                >
                  {concept.title}
                </h3>
                <p
                  style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--color-primary)',
                    marginBottom: '10px',
                  }}
                >
                  {concept.summary}
                </p>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--color-textSecondary)',
                    lineHeight: 1.65,
                  }}
                >
                  {concept.detail}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* AGENT TYPES TABLE */}
      <motion.section
        style={{ marginBottom: '64px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Reference</p>
        <h2 style={sectionTitleStyle}>Agent Types</h2>
        <p style={{ ...proseStyle, marginBottom: '24px' }}>
          The platform includes 11 agent types. Each has a tuned system prompt
          and curated tool access. All agents use the SmartRouter for model selection.
        </p>

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '14px',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: 'var(--color-surfaceSecondary)',
                }}
              >
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Purpose</th>
                <th style={thStyle}>Default Model</th>
              </tr>
            </thead>
            <tbody>
              {agentTypes.map((agent, i) => (
                <tr
                  key={agent.name}
                  style={{
                    borderBottom: i < agentTypes.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--color-text)' }}>{agent.name}</td>
                  <td style={tdStyle}>{agent.purpose}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{agent.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 20px',
  fontWeight: 600,
  color: 'var(--color-textMuted)',
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 20px',
  color: 'var(--color-textSecondary)',
};

export default KeyConceptsPage;
