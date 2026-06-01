import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsFlowIcon } from '../components/DocsIcons';

// ============================================================================
// TIMELINE DIAGRAM
// ============================================================================

const timelineDiagram: DiagramDefinition = {
  type: 'timeline',
  title: 'OpenAgentic Roadmap Timeline',
  description: 'Milestones from v0.7 through v1.0',
  layout: 'horizontal',
  nodes: [
    { id: 'v071', label: `v${import.meta.env.VITE_APP_VERSION || '0.7.1'}`, description: `Current: ${import.meta.env.VITE_CODENAME || 'AGENTICHAT'}`, shape: 'rounded', color: 'green' },
    { id: 'v08', label: 'v0.8.0', description: 'A2A + Marketplace', shape: 'rounded', color: 'primary' },
    { id: 'v09', label: 'v0.9.0', description: 'FedRAMP + SOC 2', shape: 'rounded', color: 'purple' },
    { id: 'v10', label: 'v1.0.0', description: 'General Availability', shape: 'rounded', color: 'cyan' },
  ],
  edges: [
    { source: 'v071', target: 'v08', animated: true },
    { source: 'v08', target: 'v09' },
    { source: 'v09', target: 'v10' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const currentReleaseHighlights: ReadonlyArray<{ title: string; description: string }> = [
  {
    title: 'Enterprise chatmode (Claude-Code-grade)',
    description:
      'Single chatmode pipeline, 12 T1 primitives (tool_search, agent_search, Task, agent_send/list/stop, read_large_result, web_search, web_fetch, synth, pattern_save, pattern_recall), per-T1 description builders, full SDK canonical events.',
  },
  {
    title: 'Glob-based permissions UI',
    description:
      "Claude-Code allow/deny/ask rules replace the legacy regex-tier ToolApprovalGate. Admin editor at /admin#tool-permissions. 48/48 TDD'd.",
  },
  {
    title: 'Inline tool-result summary',
    description:
      'Completed tool cards now show "· N items" / "· N subscriptions" inline in the header (mock 01 §863 contract). Drillable INPUT/RESULT body preserved.',
  },
  {
    title: 'Learned patterns memory',
    description:
      'learned_patterns Milvus collection (model-write-only via pattern_save, RBAC-filtered recall via pattern_recall). Exemplars, not prescriptions. DLP-redacted at write.',
  },
  {
    title: 'LargeResultStorage end-to-end',
    description:
      'Redis-backed offload at 30KB threshold with auto-tokens ({{count}}/{{sample_names}}) in 9 cloud-list seed templates. Handle survives multi-pod restarts via Redis (48h TTL).',
  },
  {
    title: 'OBO end-to-end',
    description:
      'AD User → Azure access_token → MCP user-identity 1-1. 6-case real TDD harness pins the wire-in (commit 6df31d57).',
  },
  {
    title: 'Admin-configurable max_turns',
    description:
      'chat_loop.max_turns knob in SystemConfiguration. Default 24, range [4, 100]. No more silent 12-turn cap on capstone work.',
  },
];

const v08PlannedFeatures = [
  {
    title: 'A2A (Agent-to-Agent) Protocol',
    description:
      'Support for the Agent-to-Agent protocol, enabling OpenAgentic agents to communicate with external agent systems. Complements MCP with inter-agent coordination beyond tool invocation.',
    status: 'Planned',
  },
  {
    title: 'Multi-Tenant Enterprise Mode',
    description:
      'Full tenant isolation with per-organization databases, dedicated resource quotas, custom branding, and independent admin hierarchies. Designed for managed service deployments.',
    status: 'Planned',
  },
  {
    title: 'MCP Ecosystem Expansion',
    description:
      'Deeper integration with the MCP ecosystem including a marketplace for community-contributed MCP servers, versioned tool schemas, and automated compatibility testing.',
    status: 'Planned',
  },
  {
    title: 'Workflow Templates Marketplace',
    description:
      'A curated library of pre-built workflow templates for common enterprise tasks. Import, customize, and share workflows across teams and organizations.',
    status: 'Planned',
  },
];

const pastReleases: ReadonlyArray<{ version: string; codename: string; date: string; summary: string }> = [
  {
    version: '0.7.0',
    codename: 'Atlas Donzo',
    date: 'April 2026',
    summary:
      'Universal admin chrome, theme audit + sweep (0 leaks/contrast/undefined), AIF non-stream Responses API for gpt-5-pro / gpt-5-codex / o-pro, animated [openagentic] wordmark.',
  },
  {
    version: '0.6.6',
    codename: 'No Backdoor',
    date: 'April 2026',
    summary:
      'HITL backdoor deleted, DLP pre-LLM redaction, synth_execute, tenant isolation (RLS + MilvusAuditGuard + DataAccessAuditService), AWS MCP 8→31, GCP MCP 28→46.',
  },
];

const visionPillars = [
  {
    title: 'Enterprise-Grade Agentic AI',
    description:
      'Production-ready AI orchestration with the security, compliance, and observability that enterprises require. Not a demo platform but a system designed for regulated industries and mission-critical workloads.',
  },
  {
    title: 'Provider-Agnostic',
    description:
      'No lock-in to any single LLM provider. Route requests across Azure OpenAI, AWS Bedrock, Google Vertex, Anthropic, OpenAI, and local Ollama models based on cost, capability, and data residency requirements.',
  },
  {
    title: 'Open Protocol Support',
    description:
      'Built on MCP (Model Context Protocol) for tool integration and planned A2A (Agent-to-Agent) for inter-system coordination. Open standards ensure interoperability with the broader AI ecosystem.',
  },
  {
    title: 'Self-Hosted, Full Control',
    description:
      'Deploy on your own infrastructure. No data leaves your network unless you explicitly configure external provider access. Full control over secrets, policies, and resource allocation.',
  },
  {
    title: 'Complete Observability',
    description:
      'Every request traced from frontend to LLM response. Token usage, latency, cost, error rates, and DLP events all visible through Grafana dashboards with Prometheus metrics and Loki logs.',
  },
  {
    title: 'Governance First',
    description:
      'Immutable audit trails, RBAC with row-level security, DLP scanning on every data touchpoint, and HITL approval gates. Governance is not bolted on but built into the core architecture.',
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

const RoadmapPage: React.FC = () => {
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
          <DocsFlowIcon size={48} />
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
          Roadmap
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.6,
            maxWidth: '600px',
            margin: '0 auto 12px',
          }}
        >
          Where OpenAgentic is headed. Planned features, protocol support,
          and the long-term vision for enterprise agentic AI.
        </p>
        <span
          style={{
            display: 'inline-block',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-primary)',
            background: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
            borderRadius: '6px',
            padding: '4px 12px',
            letterSpacing: '0.04em',
          }}
        >
          Current: v{import.meta.env.VITE_APP_VERSION || '0.7.1'} {import.meta.env.VITE_CODENAME || 'AGENTICHAT'}
        </span>
      </motion.section>

      {/* ================================================================
          TIMELINE DIAGRAM
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Timeline</p>
        <h2 style={sectionTitleStyle}>Release Milestones</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          The path from the current v{import.meta.env.VITE_APP_VERSION || '0.7.1'} {import.meta.env.VITE_CODENAME || 'AGENTICHAT'} release through general availability.
          Each release builds on the previous, expanding protocol support,
          compliance coverage, and ecosystem depth.
        </p>

        <ReactFlowDiagram
          diagram={timelineDiagram}
          height={200}
          interactive
          showControls={false}
          showMiniMap={false}
        />
      </motion.section>

      {/* ================================================================
          JUST SHIPPED — v0.7.1 AGENTICHAT
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Just Shipped</p>
        <h2 style={sectionTitleStyle}>v0.7.1 AGENTICHAT — shipped today</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          The chatmode-rip enterprise upgrade — single Claude-Code-grade
          pipeline, 12 T1 primitives, glob permissions, learned patterns,
          Redis-backed large-result offload, OBO end-to-end, and admin-configurable max_turns.
        </p>

        <img
          src="/agentichat.png"
          alt="AGENTICHAT — v0.7.1"
          style={{
            width: '100%',
            maxHeight: 320,
            objectFit: 'cover',
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            marginBottom: 24,
          }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {currentReleaseHighlights.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <h4 style={{ ...cardTitleStyle, marginBottom: 0 }}>{feature.title}</h4>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'var(--color-success)',
                    background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Shipped
                </span>
              </div>
              <p style={cardDescStyle}>{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          v0.8.0 PLANNED FEATURES
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Next Release</p>
        <h2 style={sectionTitleStyle}>v0.8.0 Planned Features</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          The next major release focuses on inter-agent communication,
          multi-tenant isolation, and ecosystem depth.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {v08PlannedFeatures.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <h4 style={{ ...cardTitleStyle, marginBottom: 0 }}>{feature.title}</h4>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'var(--color-primary)',
                    background: 'var(--color-surfaceSecondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {feature.status}
                </span>
              </div>
              <p style={cardDescStyle}>{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          PAST RELEASES
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>History</p>
        <h2 style={sectionTitleStyle}>Past Releases</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Prior shipped releases. See the full Changelog for every version
          since v0.1.0 Genesis.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {pastReleases.map((rel, i) => (
            <motion.div
              key={rel.version}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                <h4 style={{ ...cardTitleStyle, marginBottom: 0 }}>
                  v{rel.version}
                </h4>
                <span style={{ fontSize: '12px', color: 'var(--color-textMuted)' }}>
                  {rel.codename}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-textMuted)', marginLeft: 'auto' }}>
                  {rel.date}
                </span>
              </div>
              <p style={cardDescStyle}>{rel.summary}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          PLATFORM VISION
          ================================================================ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Direction</p>
        <h2 style={sectionTitleStyle}>Platform Vision</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          The guiding principles behind every architectural and product
          decision in OpenAgentic.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {visionPillars.map((pillar, i) => (
            <motion.div
              key={pillar.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.06, duration: 0.35 }}
              style={{
                ...cardStyle,
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
                (e.currentTarget as HTMLElement).style.boxShadow =
                  '0 0 0 1px var(--color-primary), 0 8px 24px rgba(0,0,0,0.12)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              <h4 style={cardTitleStyle}>{pillar.title}</h4>
              <p style={cardDescStyle}>{pillar.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default RoadmapPage;
