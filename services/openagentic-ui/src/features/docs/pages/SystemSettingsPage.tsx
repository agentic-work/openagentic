import React from 'react';
import { motion } from 'framer-motion';
import { DocsInfraIcon } from '../components/DocsIcons';

const settingCategories = [
  {
    category: 'Authentication',
    settings: [
      { name: 'SSO Provider', desc: 'Configure Microsoft Entra ID, Google Workspace, or generic OIDC provider settings.' },
      { name: 'Session Timeout', desc: 'How long user sessions remain valid before requiring re-authentication. Default: 24 hours.' },
      { name: 'API Key Policy', desc: 'Controls for API key creation, expiration, and per-key rate limits.' },
    ],
  },
  {
    category: 'Security',
    settings: [
      { name: 'DLP Rules', desc: 'Enable/disable DLP categories, add custom regex patterns, set default actions (redact/block/warn).' },
      { name: 'HITL Policies', desc: 'Define which tools and actions require human approval, set timeout and escalation rules.' },
      { name: 'Audit Retention', desc: 'Configure how long audit records are kept per event type. Minimum: 90 days.' },
    ],
  },
  {
    category: 'Models & Routing',
    settings: [
      // 2026-04-19 — "Intelligence Tiers" row removed (task #144, slider rip).
      { name: 'Fallback Chains', desc: 'Define model fallback order when a provider is unavailable or rate-limited.' },
      { name: 'Cost Budgets', desc: 'Set monthly cost caps per user, team, or organization. Per-user × per-model caps via UserModelBudgetService.' },
    ],
  },
  {
    category: 'Platform',
    settings: [
      { name: 'Feature Flags', desc: 'Enable or disable platform features: Flows, specific MCP servers, agent types, tool synthesis.' },
      { name: 'Embedding Model', desc: 'Select the embedding model used for RAG and tool selection vector search.' },
    ],
  },
];

const SystemSettingsPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsInfraIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        System Settings
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Platform-wide configuration for authentication, security, model routing, and
        operational parameters. Changes take effect immediately unless noted otherwise.
        All configuration changes are logged to the audit trail.
      </p>
    </motion.div>

    {settingCategories.map((cat, ci) => (
      <motion.section
        key={cat.category}
        style={{ marginBottom: '40px' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 + ci * 0.06, duration: 0.4 }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '14px' }}>{cat.category}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cat.settings.map((s) => (
            <div key={s.name} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '18px 22px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>{s.name}</h3>
              <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </motion.section>
    ))}
  </div>
);

export default SystemSettingsPage;
