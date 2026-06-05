import React, { useEffect, useMemo } from 'react';
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

/**
 * KeyConceptsPage — conceptual narrative stays hand-written, but every embedded
 * COUNT (agent types, MCP servers, node types) is SOURCE-READ from the generated
 * manifests (agent-types.json / mcp-servers.json / node-types.json), and the
 * agent-types reference table is rendered straight from agent-types.json so it
 * always reflects the real built-in agent set on disk.
 */

// ============================================================================
// CONCEPTS DATA — `detail` is a builder so embedded counts come from source
// ============================================================================

interface Concept {
  title: string;
  slug: string;
  icon: React.FC<{ size?: number }>;
  summary: string;
  detail: string;
  linkPage: string;
}

function buildConcepts(agentCount: number, mcpCount: number, nodeCount: number): Concept[] {
  return [
  {
    title: 'Agents',
    slug: 'agents',
    icon: DocsAgentIcon,
    summary: 'Specialized AI personas that handle different types of tasks.',
    detail:
      `OpenAgentic ships ${agentCount} built-in agent types, each with its own system prompt and tool access. All agents use the SmartRouter for dynamic model selection based on configured providers. The orchestrator analyzes incoming requests and delegates to the right specialist — a reasoning agent for complex tasks, a code-execution agent for programming, a data-query agent for analysis, and so on. Agents can invoke MCP tools and return structured results.`,
    linkPage: 'agent-delegation',
  },
  {
    title: 'MCP (Model Context Protocol)',
    slug: 'mcp',
    icon: DocsToolIcon,
    summary: 'A standardized protocol for connecting AI models to external tools and data sources.',
    detail:
      `MCP is an open protocol that defines how language models discover, invoke, and receive results from external tools. OpenAgentic ships ${mcpCount} MCP servers that provide access to Azure, AWS, GCP, Kubernetes, GitHub, Prometheus, Loki, web search, and more. Tools are selected automatically via vector similarity matching.`,
    linkPage: 'what-is-mcp',
  },
  {
    title: 'Chat Pipeline',
    slug: 'pipeline',
    icon: DocsBrainIcon,
    summary: 'The multi-stage request processing chain that every message traverses.',
    detail:
      'Every chat message passes through discrete pipeline stages: Auth, Validation, RAG, Memory, Prompt, MCP, Agents, MessagePreparation, Completion, and Response. Each stage can enrich context, short-circuit with an error, or transform the request.',
    linkPage: 'how-chat-works',
  },
  {
    title: 'Workflows / Flows',
    slug: 'flows',
    icon: DocsFlowIcon,
    summary: `Visual drag-and-drop automation pipelines with ${nodeCount} node types.`,
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
}

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

interface AgentRow {
  name: string;
  purpose: string;
  model: string;
}

const KeyConceptsPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  // Load the source-derived manifests that back the counts + the agent table.
  useEffect(() => {
    for (const d of ['agent-types', 'mcp-servers', 'node-types']) {
      if (!loadedManifests.has(d)) loadManifest(d).catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const agentManifest = loadedManifests.get('agent-types');
  const mcpManifest = loadedManifests.get('mcp-servers');
  const nodeManifest = loadedManifests.get('node-types');

  const agentCount =
    agentManifest?.sections.reduce((n, s) => n + s.items.length, 0) ?? 8;
  const mcpCount = mcpManifest?.sections.length ?? 14;
  const nodeCount =
    nodeManifest?.sections.reduce((n, s) => n + s.items.length, 0) ?? 71;

  const concepts = useMemo(
    () => buildConcepts(agentCount, mcpCount, nodeCount),
    [agentCount, mcpCount, nodeCount],
  );

  // Agent-types table rendered straight from the generated manifest.
  const agentTypes = useMemo<AgentRow[]>(() => {
    const items = agentManifest?.sections.flatMap((s) => s.items) ?? [];
    return items.map((it) => ({
      name: it.name,
      purpose: (it.description ?? '').replace(/^USE WHEN\s*/i, '').split('.')[0].slice(0, 120),
      model: 'Auto (SmartRouter)',
    }));
  }, [agentManifest]);

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
          The platform includes {agentCount} built-in agent types. Each has a tuned system prompt
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
