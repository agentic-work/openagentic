/**
 * AdminSecurityConfigPage - Security & Access admin settings documentation.
 *
 * Documents auth access control, user permissions, lockout management,
 * API token management, rate limits, network security, webhooks, and DLP.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsShieldIcon, DocsInfraIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// SECURITY LAYERS DIAGRAM
// ============================================================================

const securityDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Security Layer Stack',
  description: 'Defense-in-depth from network to application',
  layout: 'vertical',
  nodes: [
    { id: 'network', label: 'Network Security', description: 'K8s NetworkPolicy', shape: 'rounded', color: 'red' },
    { id: 'auth', label: 'Authentication', description: 'SSO / API tokens', shape: 'rounded', color: 'orange' },
    { id: 'rbac', label: 'Authorization', description: 'Role-based access', shape: 'rounded', color: 'yellow' },
    { id: 'rate', label: 'Rate Limiting', description: 'Per-user throttle', shape: 'rounded', color: 'blue' },
    { id: 'dlp', label: 'DLP Scanner', description: 'Content filtering', shape: 'rounded', color: 'purple' },
    { id: 'audit', label: 'Audit Trail', description: 'Immutable logs', shape: 'database', color: 'green' },
  ],
  edges: [
    { source: 'network', target: 'auth' },
    { source: 'auth', target: 'rbac' },
    { source: 'rbac', target: 'rate' },
    { source: 'rate', target: 'dlp' },
    { source: 'dlp', target: 'audit', style: 'dashed', color: 'green' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const permissionRoles = [
  { role: 'viewer', description: 'Read-only access to chat history and shared workflows. Cannot send messages, create flows, or access admin features. Ideal for stakeholders who need visibility without interaction.' },
  { role: 'user', description: 'Standard platform access. Can use chat, code mode, and run existing workflows. Cannot create agents, configure MCP servers, or access admin settings.' },
  { role: 'power_user', description: 'Extended access including workflow creation, agent playground, and API key generation. Can create and manage their own workflows and test agent configurations.' },
  { role: 'admin', description: 'Full admin console access. Can manage providers, agents, MCP servers, users, and security settings. Cannot modify super_admin accounts or platform deployment configuration.' },
  { role: 'super_admin', description: 'Unrestricted access. Can modify all settings including other admin accounts, deployment configuration, and platform-level security policies. Reserved for platform operators.' },
];

const apiTokenFeatures = [
  { feature: 'Token Prefix', description: 'All API tokens begin with the awc_ prefix for easy identification in logs, secrets scanners, and credential detection tools.' },
  { feature: 'Scope Control', description: 'Tokens can be scoped to specific API operations: chat-only, flows-only, read-only, or full-access. Narrow scopes follow the principle of least privilege.' },
  { feature: 'Expiration', description: 'Tokens have a configurable expiration date. Options include 30 days, 90 days, 1 year, or custom. Expired tokens are automatically rejected.' },
  { feature: 'Usage Tracking', description: 'Each token tracks its last used timestamp, total request count, and associated IP addresses. Unused tokens are flagged for cleanup.' },
];

const rateLimitConfig = [
  { limit: 'Requests per Minute', description: 'Maximum API requests per user per minute. Separate limits for chat messages, tool calls, and admin operations. Exceeding the limit returns HTTP 429.' },
  { limit: 'Tokens per Day', description: 'Maximum LLM tokens a user can consume per 24-hour period. Applies across all providers and models. Resets at midnight UTC.' },
  { limit: 'Concurrent Sessions', description: 'Maximum simultaneous active sessions per user. Prevents resource exhaustion from excessive parallelism.' },
  { limit: 'File Upload Size', description: 'Maximum size for file uploads in chat and code mode. Applies per-file and per-request aggregate.' },
];

const networkSecurityFeatures = [
  { feature: 'Kubernetes NetworkPolicy', description: 'Ingress and egress rules at the pod level. Only explicitly allowed traffic flows between services. Default-deny policy for all namespaces.' },
  { feature: 'Service Mesh', description: 'mTLS between all services for encrypted in-cluster communication. Certificate rotation handled automatically.' },
  { feature: 'Ingress Controls', description: 'TLS termination at the ingress controller with configurable cipher suites. IP allowlisting available for admin endpoints.' },
];

const webhookSecurity = [
  { feature: 'HMAC Signatures', description: 'Outgoing webhooks include an HMAC-SHA256 signature header for verification. Recipients can validate that payloads originate from the platform.' },
  { feature: 'Secret Rotation', description: 'Webhook signing secrets can be rotated without downtime. The platform supports dual-secret mode during rotation windows.' },
  { feature: 'TLS Verification', description: 'Outgoing webhook requests enforce TLS certificate verification by default. Self-signed certificates can be allowed per-webhook for internal endpoints.' },
];

const dlpCategories = [
  { category: 'Credit Card Numbers', description: 'Detects credit/debit card numbers using Luhn algorithm validation and common patterns.' },
  { category: 'Social Security Numbers', description: 'Detects US SSN patterns (XXX-XX-XXXX) with context analysis to reduce false positives.' },
  { category: 'API Keys & Secrets', description: 'Detects common API key patterns (AWS, Azure, GCP, GitHub tokens) using regex and entropy analysis.' },
  { category: 'Email Addresses', description: 'Detects email addresses in messages. Can be configured to only flag external domains.' },
  { category: 'IP Addresses', description: 'Detects internal and external IP addresses. Configurable to only flag RFC 1918 private ranges.' },
  { category: 'Custom Patterns', description: 'Admin-defined regex patterns for organization-specific sensitive data (employee IDs, project codes, etc.).' },
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

const AdminSecurityConfigPage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsShieldIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Security & Access Configuration
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          Configure defense-in-depth security across the platform. Manage authentication,
          authorization, API tokens, rate limits, network policies, webhook security, and
          data loss prevention. All security events are recorded in the immutable audit trail.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <img
          src="/docs/screenshots/admin-security.png"
          alt="Security configuration panel showing user roles and DLP settings"
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}
        />
      </motion.section>

      {/* SECURITY LAYERS DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>Security Layer Stack</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Security is enforced through multiple layers, from network-level controls
          through application-level content scanning, with a complete audit trail.
        </p>
        <ReactFlowDiagram
          diagram={securityDiagram}
          height={420}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* AUTH ACCESS CONTROL */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Authentication</p>
        <h2 style={sectionTitleStyle}>Auth Access Control</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The platform supports SSO authentication via Azure AD (Entra ID) and Google
          Workspace. Local authentication is available as a fallback. Admin settings
          control which authentication providers are enabled, session timeout duration,
          and multi-factor authentication requirements.
        </p>
      </motion.section>

      {/* USER PERMISSIONS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Authorization</p>
        <h2 style={sectionTitleStyle}>User Permission Roles</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Five permission levels provide granular access control. Users are assigned a
          role that determines their access to features, admin settings, and API operations.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {permissionRoles.map((r, i) => (
            <motion.div
              key={r.role}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)', background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 8px',
                }}>
                  {r.role}
                </span>
              </div>
              <p style={descTextStyle}>{r.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* USER LOCKOUT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Account Security</p>
        <h2 style={sectionTitleStyle}>User Lockout Management</h2>
        <p style={bodyTextStyle}>
          Admins can manually lock user accounts to immediately revoke access. Locked users
          are disconnected from active sessions and cannot authenticate until unlocked.
          The lockout management view shows all locked accounts with the reason, timestamp,
          and locking admin. Automatic lockout occurs after configurable failed authentication
          attempts, with admin notification and self-service unlock via SSO re-authentication.
        </p>
      </motion.section>

      {/* API TOKENS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>API Access</p>
        <h2 style={sectionTitleStyle}>API Token Management</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          API tokens provide programmatic access to the platform. Tokens are managed
          per-user with scoping and expiration controls.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {apiTokenFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.feature}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* RATE LIMITS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Throttling</p>
        <h2 style={sectionTitleStyle}>Rate Limits Configuration</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Rate limits prevent resource exhaustion and ensure fair usage across all users.
          Limits can be configured globally and overridden per-role or per-user.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {rateLimitConfig.map((l, i) => (
            <motion.div
              key={l.limit}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{l.limit}</h4>
              <p style={descTextStyle}>{l.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* NETWORK SECURITY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Infrastructure</p>
        <h2 style={sectionTitleStyle}>Network Security</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Network-level security controls protect the platform infrastructure.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {networkSecurityFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.04, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsInfraIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{f.feature}</h4>
                <p style={descTextStyle}>{f.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* WEBHOOK SECURITY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Webhooks</p>
        <h2 style={sectionTitleStyle}>Webhook Security</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {webhookSecurity.map((w, i) => (
            <motion.div
              key={w.feature}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{w.feature}</h4>
              <p style={descTextStyle}>{w.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* DLP CONFIGURATION */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Data Protection</p>
        <h2 style={sectionTitleStyle}>DLP Configuration</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Data Loss Prevention scans every message for sensitive data patterns. Admins can
          enable or disable individual detection categories and configure tool-level exceptions
          where DLP is relaxed (e.g., for tools that legitimately process financial data).
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {dlpCategories.map((c, i) => (
            <motion.div
              key={c.category}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.04, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsShieldIcon size={18} /></div>
              <div>
                <h4 style={{ ...labelStyle, fontSize: '13px' }}>{c.category}</h4>
                <p style={{ ...descTextStyle, fontSize: '12px' }}>{c.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default AdminSecurityConfigPage;
