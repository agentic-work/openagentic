import React from 'react';
import { motion } from 'framer-motion';
import { DocsShieldIcon } from '../components/DocsIcons';

const eventTypes = [
  { event: 'Authentication', details: 'Login, logout, token refresh, failed attempts', retention: '90 days' },
  { event: 'Chat Messages', details: 'User messages, AI responses, model used, tokens consumed', retention: '365 days' },
  { event: 'Tool Invocations', details: 'MCP tool calls, parameters, results, duration', retention: '365 days' },
  { event: 'Agent Delegations', details: 'Agent type, delegation reason, sub-agent results', retention: '365 days' },
  { event: 'DLP Events', details: 'Pattern matches, actions taken (redact/block/warn)', retention: '365 days' },
  { event: 'HITL Approvals', details: 'Approval requests, reviewer, decision, response time', retention: '365 days' },
  { event: 'Admin Actions', details: 'Configuration changes, user management, provider updates', retention: '730 days' },
  { event: 'Workflow Executions', details: 'Flow runs, node results, errors, duration', retention: '365 days' },
];

const AuditTrailPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsShieldIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Audit Trail
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Every action in OpenAgentic is logged to an immutable audit trail. Authentication events,
        chat messages, tool invocations, DLP matches, HITL approvals, and admin actions are
        recorded with full context for compliance and forensic analysis.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Tracked Events</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Event Type', 'Details Captured', 'Retention'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eventTypes.map((e, i) => (
              <tr key={e.event} style={{ borderBottom: i < eventTypes.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{e.event}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{e.details}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textMuted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{e.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>Immutability</h2>
      <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Audit records are append-only and stored in PostgreSQL with row-level security.
        Records cannot be modified or deleted, even by administrators. Cryptographic checksums
        detect any external tampering. Retention periods are configurable per event type,
        and expired records are archived to cold storage before being purged.
      </p>
    </motion.section>
  </div>
);

export default AuditTrailPage;
