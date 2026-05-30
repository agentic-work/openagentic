import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsShieldIcon } from '../components/DocsIcons';

const dlpDiagram: DiagramDefinition = {
  type: 'process',
  title: 'DLP Scanning Pipeline',
  description: 'Applied to both inbound and outbound messages',
  layout: 'horizontal',
  nodes: [
    { id: 'input', label: 'Message', description: 'User or AI', shape: 'rounded', color: 'primary' },
    { id: 'cred', label: 'credential', description: '20 rules', shape: 'rounded', color: 'orange' },
    { id: 'pii', label: 'pii', description: '15 rules', shape: 'rounded', color: 'red' },
    { id: 'infra', label: 'infrastructure', description: '10 rules', shape: 'rounded', color: 'blue' },
    { id: 'comp', label: 'compliance + injection', description: '10 rules', shape: 'rounded', color: 'purple' },
    { id: 'action', label: 'Action', description: 'Allow / Redact / Block', shape: 'diamond', color: 'red' },
    { id: 'output', label: 'Clean Message', shape: 'rounded', color: 'green' },
  ],
  edges: [
    { source: 'input', target: 'cred', animated: true },
    { source: 'cred', target: 'pii' },
    { source: 'pii', target: 'infra' },
    { source: 'infra', target: 'comp' },
    { source: 'comp', target: 'action' },
    { source: 'action', target: 'output', label: 'pass', color: 'green' },
  ],
};

const patterns = [
  { category: 'credential', examples: 'API keys (AWS, Azure, GCP), OAuth tokens, passwords, private keys, connection strings (20 rules)', action: 'Block' },
  { category: 'pii', examples: 'Full names, email addresses, phone numbers, Social Security numbers, passport numbers (15 rules)', action: 'Redact' },
  { category: 'infrastructure', examples: 'Internal IPs, hostnames, database connection strings, K8s secrets (10 rules)', action: 'Block' },
  { category: 'compliance', examples: 'Credit card numbers, bank account numbers, medical record numbers (5 rules)', action: 'Redact' },
  { category: 'injection', examples: 'System prompt override attempts, instruction injection patterns (5 rules)', action: 'Block' },
];

const DlpScannerPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsShieldIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        DLP Scanner
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        The Data Loss Prevention scanner inspects every message — both from users and from
        AI responses — for sensitive data patterns. When a match is found, the scanner
        can redact the data, warn the user, or block the message entirely.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <ReactFlowDiagram diagram={dlpDiagram} height={300} interactive showControls />
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Detection Patterns</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Category', 'Examples', 'Default Action'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patterns.map((p, i) => (
              <tr key={p.category} style={{ borderBottom: i < patterns.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{p.category}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{p.examples}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                    color: p.action === 'Block' ? '#ef4444' : p.action === 'Redact' ? '#f97316' : 'var(--color-textMuted)',
                    background: p.action === 'Block' ? 'rgba(239,68,68,0.12)' : p.action === 'Redact' ? 'rgba(249,115,22,0.12)' : 'var(--color-surfaceSecondary)',
                  }}>{p.action}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  </div>
);

export default DlpScannerPage;
