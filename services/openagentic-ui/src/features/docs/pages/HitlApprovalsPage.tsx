import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsShieldIcon } from '../components/DocsIcons';

const hitlDiagram: DiagramDefinition = {
  type: 'process',
  title: 'HITL Approval Flow',
  layout: 'horizontal',
  nodes: [
    { id: 'action', label: 'Sensitive Action', description: 'Tool/agent trigger', shape: 'rounded', color: 'orange' },
    { id: 'gate', label: 'HITL Gate', description: 'Policy check', shape: 'diamond', color: 'red' },
    { id: 'notify', label: 'Notify Reviewer', description: 'Email / Slack / UI', shape: 'rounded', color: 'purple' },
    { id: 'review', label: 'Human Review', description: 'Approve or deny', shape: 'rounded', color: 'primary' },
    { id: 'execute', label: 'Execute', description: 'Action proceeds', shape: 'rounded', color: 'green' },
  ],
  edges: [
    { source: 'action', target: 'gate', animated: true },
    { source: 'gate', target: 'notify', label: 'requires approval' },
    { source: 'notify', target: 'review' },
    { source: 'review', target: 'execute', label: 'approved', color: 'green' },
  ],
};

const useCases = [
  { trigger: 'Infrastructure changes', example: 'Scaling Kubernetes pods, modifying cloud resources, changing DNS records', timeout: '30 min' },
  { trigger: 'Code deployment', example: 'Pushing to production, merging PRs, running CI/CD pipelines', timeout: '60 min' },
  { trigger: 'Data access', example: 'Querying production databases, accessing PII, exporting datasets', timeout: '15 min' },
  { trigger: 'External communication', example: 'Sending emails, posting to Slack channels, creating Jira tickets', timeout: '30 min' },
  { trigger: 'Financial actions', example: 'Modifying billing, approving purchases, changing subscriptions', timeout: '60 min' },
];

const HitlApprovalsPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsShieldIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        HITL Approvals
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Human-in-the-Loop (HITL) gates pause AI execution and require explicit human
        approval before sensitive actions proceed. This ensures that high-impact operations
        — infrastructure changes, data access, external communications — always have a
        human checkpoint.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <ReactFlowDiagram diagram={hitlDiagram} height={300} interactive showControls />
    </motion.section>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Common HITL Triggers</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Trigger', 'Example Actions', 'Default Timeout'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {useCases.map((u, i) => (
              <tr key={u.trigger} style={{ borderBottom: i < useCases.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{u.trigger}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{u.example}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textMuted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{u.timeout}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>Configuration</h2>
      <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        HITL policies are configured per tool, per agent type, or per workflow node.
        Administrators define which actions require approval, who can approve them,
        the timeout period, and what happens on timeout (deny by default or escalate).
        Notifications can be sent via email, Slack, Teams, or the OpenAgentic UI.
      </p>
    </motion.section>
  </div>
);

export default HitlApprovalsPage;
