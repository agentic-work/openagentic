import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsInfraIcon } from '../components/DocsIcons';

// ============================================================================
// FULL ARCHITECTURE DIAGRAM
// ============================================================================

const fullArchitectureDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'OpenAgentic System Architecture',
  description: 'End-to-end request flow across all services',
  layout: 'vertical',
  nodes: [
    // Frontend tier
    { id: 'frontend', label: 'openagentic-ui', description: 'React SPA', shape: 'rounded', color: 'blue' },
    // API tier
    { id: 'api', label: 'openagentic-api', description: 'Express + WebSocket', shape: 'server', color: 'primary' },
    // Pipeline
    { id: 'pipeline', label: 'Chat Pipeline', description: 'Auth / DLP / RAG / Prompt', shape: 'rounded', color: 'indigo' },
    { id: 'provider-mgr', label: 'ProviderManager', description: 'Model routing', shape: 'diamond', color: 'orange' },
    // LLM Providers
    { id: 'azure', label: 'Azure OpenAI', shape: 'cloud', color: 'azure' },
    { id: 'aws', label: 'AWS Bedrock', shape: 'cloud', color: 'aws' },
    { id: 'google', label: 'Google Vertex', shape: 'cloud', color: 'gcp' },
    { id: 'anthropic', label: 'Anthropic', shape: 'cloud', color: 'purple' },
    { id: 'openai', label: 'OpenAI', shape: 'cloud', color: 'green' },
    { id: 'ollama', label: 'Ollama', shape: 'cloud', color: 'gray' },
    // MCP Proxy
    { id: 'mcp-proxy', label: 'MCP Proxy', description: '14 MCP servers', shape: 'server', color: 'orange' },
    // Agent Proxy
    { id: 'openagentic-proxy', label: 'Agent Proxy', description: 'Sub-agents', shape: 'server', color: 'purple' },
    // Workflow Engine
    { id: 'workflow', label: 'Workflow Engine', description: '30+ node types', shape: 'server', color: 'teal' },
    // OAT Executor
    { id: 'oat', label: 'OAT Executor', description: 'Autonomous tasks', shape: 'server', color: 'cyan' },
    // Databases
    { id: 'pg', label: 'PostgreSQL', description: 'pgvector + RLS', shape: 'database', color: 'blue' },
    { id: 'redis', label: 'Redis', description: 'Cache + sessions', shape: 'database', color: 'red' },
    { id: 'milvus', label: 'Milvus', description: 'GPU vector search', shape: 'database', color: 'cyan' },
    { id: 'minio', label: 'MinIO', description: 'Object storage', shape: 'database', color: 'orange' },
    // Auth
    { id: 'azure-ad', label: 'Azure AD', description: 'SSO / OIDC', shape: 'rounded', color: 'azure' },
    { id: 'google-oauth', label: 'Google OAuth', shape: 'rounded', color: 'gcp' },
    { id: 'api-keys', label: 'API Keys', description: 'oa_ prefix', shape: 'rounded', color: 'gray' },
    // Observability
    { id: 'prometheus', label: 'Prometheus', description: 'Metrics', shape: 'rounded', color: 'red' },
    { id: 'grafana', label: 'Grafana', description: '12 dashboards', shape: 'rounded', color: 'orange' },
    { id: 'loki', label: 'Loki', description: 'Logs', shape: 'rounded', color: 'yellow' },
  ],
  edges: [
    { source: 'frontend', target: 'api', label: 'HTTPS / WSS', animated: true },
    { source: 'api', target: 'pipeline' },
    { source: 'pipeline', target: 'provider-mgr' },
    { source: 'provider-mgr', target: 'azure', style: 'dashed', color: 'azure' },
    { source: 'provider-mgr', target: 'aws', style: 'dashed', color: 'aws' },
    { source: 'provider-mgr', target: 'google', style: 'dashed', color: 'gcp' },
    { source: 'provider-mgr', target: 'anthropic', style: 'dashed', color: 'purple' },
    { source: 'provider-mgr', target: 'openai', style: 'dashed', color: 'green' },
    { source: 'provider-mgr', target: 'ollama', style: 'dashed', color: 'gray' },
    { source: 'api', target: 'mcp-proxy', label: 'tools', style: 'dashed', color: 'orange' },
    { source: 'api', target: 'openagentic-proxy', label: 'delegate', style: 'dashed', color: 'purple' },
    { source: 'api', target: 'workflow', style: 'dashed', color: 'teal' },
    { source: 'api', target: 'oat', style: 'dashed', color: 'cyan' },
    { source: 'pipeline', target: 'pg', style: 'dashed', color: 'blue' },
    { source: 'pipeline', target: 'redis', style: 'dashed', color: 'red' },
    { source: 'pipeline', target: 'milvus', style: 'dashed', color: 'cyan' },
    { source: 'api', target: 'minio', style: 'dashed', color: 'orange' },
    { source: 'api', target: 'azure-ad', style: 'dashed', color: 'azure' },
    { source: 'api', target: 'google-oauth', style: 'dashed', color: 'gcp' },
    { source: 'api', target: 'api-keys', style: 'dashed', color: 'gray' },
    { source: 'api', target: 'prometheus', style: 'dashed', color: 'red' },
    { source: 'prometheus', target: 'grafana', color: 'orange' },
    { source: 'api', target: 'loki', style: 'dashed', color: 'yellow' },
  ],
};

// ============================================================================
// INDUSTRY COMPARISON DATA
// ============================================================================

const industryComparisons = [
  {
    title: 'Model Context Protocol (MCP)',
    description:
      'OpenAgentic implements the MCP specification by Anthropic, providing a standardized interface for AI models to interact with external tools and data sources. This ensures interoperability and future-proofing as the ecosystem grows.',
    link: 'https://modelcontextprotocol.io',
    linkLabel: 'MCP Specification',
  },
  {
    title: 'Multi-Agent Patterns',
    description:
      'Agent orchestration follows proven multi-agent patterns: parallel execution, sequential chaining, supervisor delegation, and hierarchical task decomposition. The Agent Proxy manages lifecycle and coordination across 11 specialist agent types.',
  },
  {
    title: 'Dual Vector Store RAG',
    description:
      'RAG retrieval uses both pgvector (PostgreSQL extension) and Milvus (GPU-accelerated) for resilience. If one store is unavailable, the other continues serving queries. This dual-store pattern provides both low-latency and high-throughput vector search.',
  },
  {
    title: 'On-Behalf-Of (OBO) Auth',
    description:
      'Every tool invocation runs as the authenticated user, not a service account. OBO tokens propagate through the MCP Proxy to downstream services, ensuring audit trails accurately reflect who performed each action and enforcing per-user access control.',
  },
];

// ============================================================================
// SECRETS MANAGEMENT DATA
// ============================================================================

const secretsSteps = [
  {
    title: 'HashiCorp Vault',
    description:
      'Primary secrets backend. All sensitive configuration (API keys, database credentials, OAuth secrets) is stored in Vault with path-based access policies and automatic rotation.',
  },
  {
    title: 'External Secrets Operator (ESO)',
    description:
      'ESO watches Vault paths and syncs secrets into Kubernetes Secrets objects. This bridges Vault with the Kubernetes-native deployment model, keeping secrets out of Helm values and Git.',
  },
  {
    title: 'Ephemeral Fallback',
    description:
      'If Vault is unreachable at startup, the runtime generates ephemeral secrets and logs a CRITICAL warning. This prevents hard failures during development but should never occur in production.',
  },
  {
    title: 'Per-Tool Credential Scoping',
    description:
      'Each MCP tool only receives the credentials it needs. The Azure DevOps tool gets Azure PATs; the GitHub tool gets GitHub tokens. No tool has access to credentials outside its scope.',
  },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionStyle: React.CSSProperties = {
  marginBottom: '64px',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
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

const sectionDescStyle: React.CSSProperties = {
  fontSize: '16px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.65,
  maxWidth: '640px',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '12px',
  padding: '24px',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--color-text)',
  marginBottom: '8px',
};

const cardDescStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.6,
};

// ============================================================================
// COMPONENT
// ============================================================================

const ArchitecturePage: React.FC = () => {
  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
    []
  );

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* ================================================================
          HERO
          ================================================================ */}
      <motion.section style={{ marginBottom: '80px', textAlign: 'center' }} {...fadeUp}>
        <div style={{ marginBottom: '24px' }}>
          <DocsInfraIcon size={48} />
        </div>
        <h1
          style={{
            fontSize: '42px',
            fontWeight: 700,
            color: 'var(--color-text)',
            lineHeight: 1.15,
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          System Architecture
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.6,
            maxWidth: '600px',
            margin: '0 auto',
          }}
        >
          A comprehensive reference for the OpenAgentic platform architecture,
          covering service topology, data flow, secrets management, and
          industry-standard protocol alignment.
        </p>
      </motion.section>

      {/* ================================================================
          INTERACTIVE ARCHITECTURE DIAGRAM
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>System Topology</p>
        <h2 style={sectionTitleStyle}>Full Architecture Diagram</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          The diagram below shows the complete service graph. The frontend connects to the
          API over HTTPS and WebSocket. The API orchestrates the chat pipeline, delegates
          to MCP servers for tool execution, routes to LLM providers via the ProviderManager,
          and coordinates sub-agents through the Agent Proxy. All data persists across
          PostgreSQL, Redis, Milvus, and MinIO.
        </p>

        <ReactFlowDiagram
          diagram={fullArchitectureDiagram}
          height={700}
          interactive
          showControls
          showMiniMap
        />
      </motion.section>

      {/* ================================================================
          INDUSTRY COMPARISON
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Standards Alignment</p>
        <h2 style={sectionTitleStyle}>Industry Comparison</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          OpenAgentic adopts open protocols and proven patterns from the broader
          AI ecosystem rather than inventing proprietary alternatives.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {industryComparisons.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={cardTitleStyle}>{item.title}</h4>
              <p style={cardDescStyle}>{item.description}</p>
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--color-primary)',
                    textDecoration: 'none',
                    borderBottom: '1px solid var(--color-primary)',
                    paddingBottom: '1px',
                  }}
                >
                  {item.linkLabel}
                </a>
              )}
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          SECRETS MANAGEMENT
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Credential Lifecycle</p>
        <h2 style={sectionTitleStyle}>Secrets Management</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          Secrets flow from HashiCorp Vault through the External Secrets Operator
          into Kubernetes, with a runtime fallback for development environments.
          Each tool only receives the credentials it needs.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {secretsSteps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.08, duration: 0.35 }}
              style={{
                ...cardStyle,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                }}
              >
                {i + 1}
              </div>
              <div>
                <h4 style={cardTitleStyle}>{step.title}</h4>
                <p style={cardDescStyle}>{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          EXTERNAL LINKS
          ================================================================ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Resources</p>
        <h2 style={sectionTitleStyle}>External Links</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[
            { label: 'MCP Specification', href: 'https://modelcontextprotocol.io', desc: 'Model Context Protocol by Anthropic' },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...cardStyle,
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
              }}
            >
              <h4 style={{ ...cardTitleStyle, color: 'var(--color-primary)' }}>{link.label}</h4>
              <p style={cardDescStyle}>{link.desc}</p>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: '8px',
                  fontSize: '12px',
                  color: 'var(--color-textMuted)',
                  fontFamily: 'monospace',
                }}
              >
                {link.href}
              </span>
            </a>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default ArchitecturePage;
