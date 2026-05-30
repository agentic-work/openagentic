import React from 'react';
import { motion } from 'framer-motion';
import { DocsInfraIcon } from '../components/DocsIcons';

const providers = [
  { name: 'OpenAI', models: 'GPT-4o, GPT-4o-mini, GPT-4.5, o1, o3', auth: 'API Key', endpoint: 'api.openai.com' },
  { name: 'Anthropic', models: 'Claude Opus, Claude Sonnet, Claude Haiku', auth: 'API Key', endpoint: 'api.anthropic.com' },
  { name: 'Google', models: 'Gemini Pro, Gemini Flash, Gemini Ultra', auth: 'API Key', endpoint: 'generativelanguage.googleapis.com' },
  { name: 'Azure OpenAI', models: 'GPT-4o, GPT-4o-mini (Azure-hosted)', auth: 'Entra ID / Key', endpoint: 'Custom deployment URL' },
  { name: 'Local / Ollama', models: 'Llama, Mistral, CodeLlama, custom', auth: 'None', endpoint: 'localhost:11434' },
];

const ProviderManagementPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsInfraIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Provider Management
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Administrators configure which LLM providers are available, set API keys, define
        rate limits, and control which models map to each intelligence slider position.
        Multiple providers can be active simultaneously for redundancy and cost optimization.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Supported Providers</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Provider', 'Models', 'Auth', 'Endpoint'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((p, i) => (
              <tr key={p.name} style={{ borderBottom: i < providers.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{p.name}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{p.models}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{p.auth}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textMuted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{p.endpoint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>Configuration</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[
          { title: 'API Key Management', body: 'API keys are stored encrypted at rest using AES-256. Keys can be rotated without downtime. The system supports multiple keys per provider for load distribution.' },
          { title: 'Model Routing Rules', body: 'Define which models are available at each intelligence slider position. Set fallback chains so if a primary model is unavailable, requests automatically route to the next provider.' },
          { title: 'Rate Limits & Budgets', body: 'Set per-provider rate limits (requests/min, tokens/day) and cost budgets (monthly spend caps). The system alerts admins when approaching limits and can auto-disable providers.' },
        ].map((item) => (
          <div key={item.title} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '20px 24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>{item.title}</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>{item.body}</p>
          </div>
        ))}
      </div>
    </motion.section>
  </div>
);

export default ProviderManagementPage;
