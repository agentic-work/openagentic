import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsShieldIcon } from '../components/DocsIcons';

// ============================================================================
// SECURITY FLOW DIAGRAM
// ============================================================================

const securityFlowDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Security Architecture',
  description: 'Authentication, authorization, and data protection flow',
  layout: 'vertical',
  nodes: [
    { id: 'user', label: 'User Request', shape: 'rounded', color: 'primary' },
    { id: 'tls', label: 'TLS 1.3', description: 'External encryption', shape: 'rounded', color: 'green' },
    { id: 'envoy', label: 'Envoy Gateway', description: 'Rate limiting + mTLS', shape: 'server', color: 'orange' },
    { id: 'auth', label: 'Authentication', description: 'Azure AD / Google / API Key', shape: 'rounded', color: 'azure' },
    { id: 'rbac', label: 'RBAC Check', description: '5 role levels', shape: 'diamond', color: 'purple' },
    { id: 'dlp', label: 'DLP Scanner', description: '55 rules, 5 categories', shape: 'rounded', color: 'red' },
    { id: 'hitl', label: 'HITL Gate', description: 'Approval for sensitive ops', shape: 'diamond', color: 'orange' },
    { id: 'rls', label: 'Row-Level Security', description: 'PostgreSQL RLS', shape: 'database', color: 'blue' },
    { id: 'obo', label: 'OBO Token', description: 'Execute as user', shape: 'rounded', color: 'cyan' },
    { id: 'audit', label: 'Audit Trail', description: 'SHA-256 hash chain', shape: 'database', color: 'gray' },
    { id: 'tool', label: 'Tool Execution', description: 'Scoped credentials', shape: 'server', color: 'green' },
  ],
  edges: [
    { source: 'user', target: 'tls', animated: true },
    { source: 'tls', target: 'envoy' },
    { source: 'envoy', target: 'auth' },
    { source: 'auth', target: 'rbac' },
    { source: 'rbac', target: 'dlp' },
    { source: 'dlp', target: 'hitl', label: 'if sensitive' },
    { source: 'dlp', target: 'rls' },
    { source: 'hitl', target: 'obo', label: 'approved' },
    { source: 'rls', target: 'obo' },
    { source: 'obo', target: 'tool' },
    { source: 'tool', target: 'audit', style: 'dashed', color: 'gray' },
    { source: 'auth', target: 'audit', style: 'dashed', color: 'gray' },
    { source: 'hitl', target: 'audit', style: 'dashed', color: 'gray' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const authMethods = [
  {
    title: 'Azure AD SSO',
    description: 'OAuth2 / OIDC with Azure Active Directory. Multi-factor authentication enforced via Azure conditional access policies. Primary enterprise authentication method.',
  },
  {
    title: 'Google OAuth',
    description: 'OAuth2 authentication via Google accounts. Supports personal and Google Workspace accounts for organizations using Google as their identity provider.',
  },
  {
    title: 'API Keys',
    description: 'Programmatic access tokens with the awc_ prefix. Keys are bcrypt-hashed in the database and scoped to individual users. Used for automation, CI/CD, and SDK access.',
  },
  {
    title: 'Local JWT',
    description: 'HS256-signed JSON Web Tokens using the JWT_SECRET environment variable. Issued after SSO or API key authentication. Short-lived with refresh token rotation.',
  },
];

const rbacRoles = [
  { role: 'viewer', desc: 'Read-only access to conversations and shared artifacts' },
  { role: 'user', desc: 'Standard access: chat, code, flows, tool execution' },
  { role: 'power_user', desc: 'Extended limits, agent configuration, advanced tools' },
  { role: 'admin', desc: 'User management, provider configuration, system settings' },
  { role: 'super_admin', desc: 'Full platform control including audit access and secret management' },
];

const dlpCategories = [
  { name: 'Credential', count: '12 rules', desc: 'API keys, tokens, passwords, connection strings' },
  { name: 'PII', count: '15 rules', desc: 'Names, emails, SSNs, phone numbers, addresses' },
  { name: 'Infrastructure', count: '10 rules', desc: 'IP addresses, hostnames, internal URLs, certificates' },
  { name: 'Compliance', count: '10 rules', desc: 'Credit cards, health records, financial data' },
  { name: 'Injection', count: '8 rules', desc: 'Prompt injection, jailbreak attempts, system prompt extraction' },
];

const dlpSeverityActions = [
  { severity: 'Low', action: 'Allow', desc: 'Log and continue. Content passes through unmodified.' },
  { severity: 'Medium', action: 'Redact', desc: 'Sensitive content is masked before reaching the model or user.' },
  { severity: 'High', action: 'Block', desc: 'Request is rejected. User receives a policy violation notice.' },
  { severity: 'Critical', action: 'Block + Alert', desc: 'Request blocked, admin notified, incident logged to audit trail.' },
];

const dlpScanPoints = [
  'user_input',
  'tool_input',
  'tool_result',
  'llm_output',
  'workflow_data',
];

const networkLayers = [
  { title: 'Kubernetes NetworkPolicy', desc: 'Per-service network policies restrict pod-to-pod communication. Services can only reach their declared dependencies.' },
  { title: 'mTLS (Internal)', desc: 'Mutual TLS between all internal services. Each pod has a unique certificate issued by the cluster CA.' },
  { title: 'TLS 1.3 (External)', desc: 'All external traffic terminates TLS 1.3 at the Envoy Gateway. Certificate management via cert-manager with Let\'s Encrypt.' },
  { title: 'Envoy Gateway', desc: 'L7 proxy replacing nginx ingress. Provides rate limiting, request routing, header manipulation, and observability hooks.' },
];

const mcpSecurity = [
  { title: 'OBO Tokens', desc: 'On-Behalf-Of tokens ensure every tool call executes as the authenticated user, not a service account. The MCP Proxy propagates the user identity to downstream services.' },
  { title: 'MCP_READ_ONLY_MODE', desc: 'Safety guardrail that restricts all MCP tools to read-only operations. Write operations are rejected at the proxy level. Useful for demo and audit environments.' },
  { title: 'Per-Tool Credential Scoping', desc: 'Each MCP tool only receives the credentials it needs. The Azure DevOps tool gets Azure PATs; the GitHub tool gets GitHub tokens. No cross-tool credential leakage.' },
];

const complianceItems = [
  { framework: 'GDPR / CCPA', status: 'Compliant', desc: 'Data residency controls, right to deletion, consent management, and DLP scanning for PII.' },
  { framework: 'HIPAA', status: 'Available', desc: 'Business Associate Agreement required. PHI scanning rules, audit trails, and encryption at rest.' },
  { framework: 'SOC 2 Type II', status: 'In Progress', desc: 'Security, availability, and confidentiality trust service criteria under active audit preparation.' },
  { framework: 'FedRAMP', status: 'Planned', desc: 'Path to FedRAMP authorization with RLS (AC-4), immutable audit logs, and FIPS 140-2 encryption.' },
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

const SecurityArchPage: React.FC = () => {
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
          <DocsShieldIcon size={48} />
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
          Security Architecture
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.6,
            maxWidth: '620px',
            margin: '0 auto',
          }}
        >
          Defense-in-depth security spanning authentication, authorization,
          data loss prevention, human-in-the-loop approval, immutable audit
          trails, and network isolation.
        </p>
      </motion.section>

      {/* ================================================================
          SECURITY FLOW DIAGRAM
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Overview</p>
        <h2 style={sectionTitleStyle}>Security Request Flow</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '32px' }}>
          Every request passes through multiple security layers before reaching
          tool execution. Authentication, role checks, DLP scanning, and optional
          human approval gates are enforced sequentially, with all events written
          to the immutable audit trail.
        </p>

        <ReactFlowDiagram
          diagram={securityFlowDiagram}
          height={620}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* ================================================================
          AUTHENTICATION
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Identity</p>
        <h2 style={sectionTitleStyle}>Authentication</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Four authentication methods covering enterprise SSO, social login,
          and programmatic access. All methods produce a local JWT for
          subsequent API calls.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {authMethods.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={cardTitleStyle}>{item.title}</h4>
              <p style={cardDescStyle}>{item.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          AUTHORIZATION / RBAC
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Access Control</p>
        <h2 style={sectionTitleStyle}>Authorization (RBAC)</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Five role levels with increasing privileges. Row-Level Security in
          PostgreSQL enforces data isolation at the database layer (FedRAMP AC-4).
          Per-user feature flags provide fine-grained permission overrides.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rbacRoles.map((item, i) => (
            <motion.div
              key={item.role}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.05, duration: 0.3 }}
              style={{
                ...cardStyle,
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
              }}
            >
              <code
                style={{
                  flexShrink: 0,
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  fontFamily: 'monospace',
                  minWidth: '110px',
                }}
              >
                {item.role}
              </code>
              <span style={{ fontSize: '13px', color: 'var(--color-textSecondary)' }}>
                {item.desc}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          DLP SCANNER
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Data Protection</p>
        <h2 style={sectionTitleStyle}>DLP Scanner</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          55 rules across 5 categories scan every data touchpoint. Severity
          determines the enforcement action: allow, redact, or block.
        </p>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>
            Rule Categories
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {dlpCategories.map((cat, i) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.04, duration: 0.3 }}
                style={{ ...cardStyle, padding: '16px 20px' }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                  {cat.name}
                </h4>
                <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '6px' }}>
                  {cat.count}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--color-textSecondary)', lineHeight: 1.5 }}>
                  {cat.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>
            Scan Points
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {dlpScanPoints.map((point) => (
              <span
                key={point}
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  color: 'var(--color-primary)',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  padding: '4px 12px',
                }}
              >
                {point}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>
            Severity Actions
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {dlpSeverityActions.map((item, i) => (
              <motion.div
                key={item.severity}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + i * 0.04, duration: 0.3 }}
                style={{ ...cardStyle, padding: '16px 20px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: item.severity === 'Low' ? '#22c55e'
                        : item.severity === 'Medium' ? '#f59e0b'
                        : item.severity === 'High' ? '#ef4444'
                        : '#dc2626',
                    }}
                  >
                    {item.severity}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--color-textMuted)' }}>
                    {item.action}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--color-textSecondary)', lineHeight: 1.5 }}>
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ================================================================
          HITL
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Approval Gates</p>
        <h2 style={sectionTitleStyle}>Human-in-the-Loop (HITL)</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Server-side approval gate for sensitive tool calls. The pipeline pauses,
          sends an SSE event to the UI, and waits for user confirmation before
          proceeding with execution.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { step: 'Trigger', desc: 'A tool call is flagged as sensitive based on its configuration or DLP severity.' },
            { step: 'SSE Event', desc: 'The server sends a real-time event to the UI with the tool name, arguments, and risk context.' },
            { step: 'UI Popup', desc: 'The user sees a detailed approval dialog showing exactly what the tool will do and why it was flagged.' },
            { step: 'Decision', desc: 'The user approves or denies. On approval, the tool executes with OBO credentials. On denial, execution is skipped gracefully.' },
            { step: 'Timeout', desc: '5-minute default timeout (configurable per tool). If no response, the tool call is automatically denied and logged.' },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.06, duration: 0.3 }}
              style={{
                ...cardStyle,
                padding: '16px 24px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                }}
              >
                {i + 1}
              </div>
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                  {item.step}
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.5 }}>
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          AUDIT TRAIL
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Accountability</p>
        <h2 style={sectionTitleStyle}>Audit Trail</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Immutable, cryptographic hash-chained audit logs track every
          significant action in the platform.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {[
            { title: 'Hash Chain', desc: 'Each audit entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain. Any modification breaks the chain and is detected on read.' },
            { title: 'Event Coverage', desc: 'Authentication events, tool calls, admin actions, model usage, HITL decisions, DLP triggers, and configuration changes are all recorded.' },
            { title: 'Tamper Detection', desc: 'On every read, the system verifies the hash chain integrity. Broken chains trigger a CRITICAL alert and are flagged in the admin dashboard.' },
            { title: 'Retention', desc: 'Audit records are retained according to compliance requirements. GDPR deletion requests are honored while preserving chain integrity via tombstone records.' },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={cardTitleStyle}>{item.title}</h4>
              <p style={cardDescStyle}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          NETWORK SECURITY
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Network</p>
        <h2 style={sectionTitleStyle}>Network Security</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {networkLayers.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.05, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={cardTitleStyle}>{item.title}</h4>
              <p style={cardDescStyle}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          MCP SECURITY
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Tool Security</p>
        <h2 style={sectionTitleStyle}>MCP Security</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {mcpSecurity.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + i * 0.06, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={cardTitleStyle}>{item.title}</h4>
              <p style={cardDescStyle}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          COMPLIANCE
          ================================================================ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Governance</p>
        <h2 style={sectionTitleStyle}>Compliance</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          OpenAgentic is designed to meet enterprise compliance requirements
          across healthcare, financial services, and government sectors.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {complianceItems.map((item, i) => (
            <motion.div
              key={item.framework}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 + i * 0.05, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <h4 style={{ ...cardTitleStyle, marginBottom: 0 }}>{item.framework}</h4>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: item.status === 'Compliant' ? '#22c55e'
                      : item.status === 'Available' ? '#3b82f6'
                      : item.status === 'In Progress' ? '#f59e0b'
                      : 'var(--color-textMuted)',
                    background: 'var(--color-surfaceSecondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                  }}
                >
                  {item.status}
                </span>
              </div>
              <p style={cardDescStyle}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default SecurityArchPage;
