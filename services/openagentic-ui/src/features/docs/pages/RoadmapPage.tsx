import React, { useEffect, useMemo } from 'react';
import { motion, type Transition } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsFlowIcon } from '../components/DocsIcons';
import { useDocsStore } from '@/stores/useDocsStore';

/**
 * RoadmapPage — forward-looking vision + the just-shipped release, with all
 * version-bearing + "just shipped" content SOURCE-READ from generated FACTS:
 *   - the current version/codename comes from the docs index (version.json).
 *   - the "Latest Release" highlights come from the generated changelog manifest
 *     (changelog.json → derived from version.json), NOT a hand-typed array that
 *     drifts.
 * The planned-features + vision pillars below are genuine forward-looking
 * narrative (not facts derivable from source), so they stay hand-written.
 */

// ============================================================================
// DATA
// ============================================================================

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
      'Every request traced from frontend to LLM response. Token usage, latency, cost, error rates, and DLP events are surfaced through the built-in admin monitoring view and shipped Prometheus metrics, with optional external Grafana and Loki backends.',
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

interface ReleaseHighlight {
  title: string;
  description: string;
}

const RoadmapPage: React.FC = () => {
  const { loadManifest, loadedManifests, index } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('changelog')) {
      loadManifest('changelog').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  // Current version + codename SOURCE-READ from the docs index (version.json).
  const version = index?.version ?? '1.0.0';
  const codename = index?.codename ?? '';

  // Latest-release highlights SOURCE-READ from the generated changelog manifest
  // (its first section is the current release). No hand-typed "just shipped" copy.
  const changelogManifest = loadedManifests.get('changelog');
  const latest = useMemo(() => {
    const sec = changelogManifest?.sections?.[0];
    if (!sec) return null;
    const codenameFromTitle = sec.title.includes('—')
      ? sec.title.split('—')[1].trim()
      : '';
    const highlights: ReleaseHighlight[] = sec.items
      .filter((it) => (it.properties?.kind ?? 'highlight') === 'highlight')
      .map((it) => ({
        title: it.name,
        description: it.description ?? it.name,
      }));
    return {
      versionLabel: sec.title.replace(/^v/, '').split('—')[0].trim(),
      codename: codenameFromTitle,
      highlights,
    };
  }, [changelogManifest]);

  // Past releases SOURCE-READ from the changelog manifest (every section after
  // the current one). The summary is the first few highlights joined — no
  // hand-typed per-release prose.
  const pastReleases = useMemo(() => {
    const secs = changelogManifest?.sections ?? [];
    return secs.slice(1, 5).map((sec) => {
      const desc = sec.description ?? '';
      const codenameMatch = desc.match(/[“"]([^”"]+)[”"]/);
      const dateMatch = desc.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      const highlights = sec.items
        .filter((it) => (it.properties?.kind ?? 'highlight') === 'highlight')
        .slice(0, 3)
        .map((it) => it.name);
      return {
        id: sec.id,
        version: sec.title.replace(/^v/, '').split('—')[0].trim(),
        codename: codenameMatch?.[1] ?? '',
        date: dateMatch?.[1] ?? '',
        summary: highlights.join(' · ') || (sec.items[0]?.description ?? ''),
      };
    });
  }, [changelogManifest]);

  // Timeline derived from the current version forward — current is a generated
  // FACT; the GA/compliance milestones are the forward-looking plan.
  const timelineDiagram = useMemo<DiagramDefinition>(
    () => ({
      type: 'timeline',
      title: 'OpenAgentic Roadmap Timeline',
      description: `Milestones from v${version} forward`,
      layout: 'horizontal',
      nodes: [
        { id: 'current', label: `v${version}`, description: `Current: ${codename || 'latest'}`, shape: 'rounded', color: 'green' },
        { id: 'a2a', label: 'A2A + Marketplace', description: 'Inter-agent + ecosystem', shape: 'rounded', color: 'primary' },
        { id: 'compliance', label: 'FedRAMP + SOC 2', description: 'Compliance coverage', shape: 'rounded', color: 'purple' },
        { id: 'ga', label: 'General Availability', description: 'GA milestone', shape: 'rounded', color: 'cyan' },
      ],
      edges: [
        { source: 'current', target: 'a2a', animated: true },
        { source: 'a2a', target: 'compliance' },
        { source: 'compliance', target: 'ga' },
      ],
    }),
    [version, codename],
  );

  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } as Transition,
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
          Current: v{version}{codename ? ` ${codename}` : ''}
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
          The path from the current v{version}{codename ? ` ${codename}` : ''} release through general
          availability. Each release builds on the previous, expanding protocol support,
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
          LATEST RELEASE — source-read from the generated changelog manifest
          ================================================================ */}
      {latest && latest.highlights.length > 0 && (
        <motion.section
          style={sectionStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <p style={sectionHeadingStyle}>Latest Release</p>
          <h2 style={sectionTitleStyle}>
            v{latest.versionLabel}{latest.codename ? ` — ${latest.codename}` : ''}
          </h2>
          <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
            The highlights of the current release, source-derived from{' '}
            <code>version.json</code>. See the full Changelog for every prior release.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {latest.highlights.map((feature, i) => (
              <motion.div
                key={`${feature.title}-${i}`}
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
      )}

      {/* ================================================================
          PLANNED FEATURES
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Next Up</p>
        <h2 style={sectionTitleStyle}>Planned Features</h2>
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
          PAST RELEASES — source-read from the generated changelog manifest
          ================================================================ */}
      {pastReleases.length > 0 && (
        <motion.section
          style={sectionStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
        >
          <p style={sectionHeadingStyle}>History</p>
          <h2 style={sectionTitleStyle}>Past Releases</h2>
          <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
            Prior shipped releases, source-derived from <code>version.json</code>. See the full
            Changelog for every recorded version.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {pastReleases.map((rel, i) => (
              <motion.div
                key={rel.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.06, duration: 0.35 }}
                style={cardStyle}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                  <h4 style={{ ...cardTitleStyle, marginBottom: 0 }}>v{rel.version}</h4>
                  {rel.codename && (
                    <span style={{ fontSize: '12px', color: 'var(--color-textMuted)' }}>
                      {rel.codename}
                    </span>
                  )}
                  {rel.date && (
                    <span style={{ fontSize: '11px', color: 'var(--color-textMuted)', marginLeft: 'auto' }}>
                      {rel.date}
                    </span>
                  )}
                </div>
                <p style={cardDescStyle}>{rel.summary}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>
      )}

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
