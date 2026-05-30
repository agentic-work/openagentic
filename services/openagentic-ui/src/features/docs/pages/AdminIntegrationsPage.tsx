import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsToolIcon, DocsShieldIcon, DocsInfraIcon } from '../components/DocsIcons';

// ============================================================================
// INTEGRATION FLOW DIAGRAM
// ============================================================================

const integrationDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Integration Architecture',
  description: 'External platform connections',
  layout: 'vertical',
  nodes: [
    { id: 'slack', label: 'Slack', description: 'Webhook + Events', shape: 'rounded', color: 'purple' },
    { id: 'teams', label: 'MS Teams', description: 'Bot Framework', shape: 'rounded', color: 'blue' },
    { id: 'gateway', label: 'Integration Gateway', description: 'Auth & routing', shape: 'server', color: 'orange' },
    { id: 'pipeline', label: 'Chat Pipeline', description: 'Message processing', shape: 'rounded', color: 'green' },
    { id: 'formatter', label: 'Response Formatter', description: 'Platform-specific', shape: 'rounded', color: 'cyan' },
    { id: 'logs', label: 'Integration Logs', description: 'Event history', shape: 'database', color: 'gray' },
  ],
  edges: [
    { source: 'slack', target: 'gateway', animated: true },
    { source: 'teams', target: 'gateway', animated: true },
    { source: 'gateway', target: 'pipeline' },
    { source: 'pipeline', target: 'formatter' },
    { source: 'formatter', target: 'slack', style: 'dashed', color: 'purple' },
    { source: 'formatter', target: 'teams', style: 'dashed', color: 'blue' },
    { source: 'gateway', target: 'logs', style: 'dashed', color: 'gray' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const slackFeatures = [
  { feature: 'Webhook Configuration', description: 'Configure incoming and outgoing webhook URLs. The platform provides a unique endpoint URL for Slack to send events to. Supports both slash commands and event subscriptions (message, app_mention, etc.).' },
  { feature: 'Signature Verification', description: 'All incoming Slack requests are verified using the Slack signing secret (HMAC-SHA256). Requests with invalid or missing signatures are rejected with HTTP 401. The signing secret is stored encrypted.' },
  { feature: 'Block Kit Formatting', description: 'Responses sent to Slack are automatically formatted using Slack Block Kit for rich visual presentation. Code blocks, tables, lists, and interactive elements are supported. Markdown is converted to mrkdwn format.' },
  { feature: 'Channel Mapping', description: 'Map specific Slack channels to platform agents or workflows. Messages in mapped channels are routed to the designated handler. Supports both public and private channels.' },
  { feature: 'Thread Awareness', description: 'Responses maintain Slack thread context. Follow-up messages in a thread are treated as continuation of the same conversation, preserving memory and context.' },
];

const teamsFeatures = [
  { feature: 'Bot Framework Tokens', description: 'Configure the Microsoft Bot Framework app ID and password. The platform registers as a Teams bot and handles token refresh automatically. Supports both single-tenant and multi-tenant configurations.' },
  { feature: 'Adaptive Cards', description: 'Responses are formatted as Microsoft Adaptive Cards for rich, interactive presentation in Teams. Supports images, tables, code blocks, and action buttons. Cards are version-aware for compatibility across Teams clients.' },
  { feature: 'Proactive Messaging', description: 'The platform can send messages to Teams channels and users proactively (e.g., workflow notifications, alerts). Requires conversation reference storage for target channels.' },
  { feature: 'Meeting Context', description: 'When invoked during a Teams meeting, the bot can access meeting context including participant list and meeting title for context-aware responses.' },
];

const connectionTestChecks = [
  { check: 'Endpoint Reachability', description: 'Verifies that the configured webhook URL or bot endpoint is reachable from the platform. Measures round-trip latency.' },
  { check: 'Authentication Validity', description: 'Validates that the configured credentials (signing secret, bot tokens) are correct and have not expired.' },
  { check: 'Permission Verification', description: 'Confirms that the bot or integration has the required permissions (scopes) for its configured operations. Lists any missing permissions.' },
  { check: 'Message Roundtrip', description: 'Sends a test message through the full pipeline and verifies it arrives at the target platform. Reports end-to-end delivery time.' },
];

const logFields = [
  { field: 'Timestamp', description: 'When the event occurred, with millisecond precision.' },
  { field: 'Direction', description: 'Inbound (from external platform) or outbound (to external platform).' },
  { field: 'Platform', description: 'Which integration platform (Slack or Teams) the event relates to.' },
  { field: 'Event Type', description: 'The specific event type: message, command, reaction, card_action, etc.' },
  { field: 'Status', description: 'Delivery status: delivered, failed, pending, or retrying.' },
  { field: 'Payload', description: 'The full request and response payload, expandable for inspection. Sensitive fields are redacted.' },
  { field: 'Latency', description: 'Processing time from receipt to response delivery.' },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionStyle: React.CSSProperties = { marginBottom: '56px' };
const sectionHeadingStyle: React.CSSProperties = { fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--color-textMuted)', marginBottom: '8px' };
const sectionTitleStyle: React.CSSProperties = { fontSize: '24px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '12px', lineHeight: 1.2 };
const bodyTextStyle: React.CSSProperties = { fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' };
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px 24px' };
const labelStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' };
const descTextStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 };

// ============================================================================
// COMPONENT
// ============================================================================

const AdminIntegrationsPage: React.FC = () => {
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
      {/* HERO */}
      <motion.div {...fadeUp} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}><DocsToolIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Integrations
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          Connect OpenAgentic to external collaboration platforms. Configure Slack and
          Microsoft Teams integrations to bring AI capabilities directly into the tools
          your team already uses. Monitor integration health and debug issues through
          the integration logs viewer.
        </p>
      </motion.div>

      {/* ARCHITECTURE DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>Integration Architecture</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          External platforms connect through the integration gateway, which handles
          authentication, message routing, and response formatting specific to each platform.
        </p>
        <ReactFlowDiagram
          diagram={integrationDiagram}
          height={420}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* SLACK INTEGRATION */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Slack</p>
        <h2 style={sectionTitleStyle}>Slack Integration</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The Slack integration enables users to interact with OpenAgentic directly from
          Slack channels and direct messages. Responses are formatted using Slack Block Kit
          for rich visual presentation.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {slackFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.feature}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* TEAMS INTEGRATION */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Microsoft Teams</p>
        <h2 style={sectionTitleStyle}>Microsoft Teams Integration</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The Teams integration uses the Microsoft Bot Framework to provide a native
          Teams bot experience. Responses are rendered as Adaptive Cards.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {teamsFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.feature}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CONNECTION TESTING */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Validation</p>
        <h2 style={sectionTitleStyle}>Connection Testing</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Each integration includes a connection test that validates end-to-end connectivity.
          The test runs four checks and reports the result of each.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {connectionTestChecks.map((c, i) => (
            <motion.div
              key={c.check}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.35 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsInfraIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{c.check}</h4>
                <p style={descTextStyle}>{c.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* INTEGRATION LOGS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Debugging</p>
        <h2 style={sectionTitleStyle}>Integration Logs Viewer</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The integration logs viewer provides a chronological record of all inbound and
          outbound integration events. Logs are filterable by platform, direction, event
          type, status, and time range.
        </p>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                {['Field', 'Description'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logFields.map((f, i) => (
                <tr key={f.field} style={{ borderBottom: i < logFields.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{f.field}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--color-textSecondary)' }}>{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

export default AdminIntegrationsPage;
