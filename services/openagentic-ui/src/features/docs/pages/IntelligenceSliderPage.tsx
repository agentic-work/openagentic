import React from 'react';
import { motion } from 'framer-motion';
import { DocsBrainIcon } from '../components/DocsIcons';

const tiers = [
  { position: 'Economical (0-40)', models: 'Auto (SmartRouter)', cost: '$', latency: '< 1s', use: 'Simple lookups, quick answers, reformatting' },
  { position: 'Balanced (41-60)', models: 'Auto (SmartRouter)', cost: '$$', latency: '1-3s', use: 'General tasks, summarization, moderate reasoning' },
  { position: 'Premium (61-100)', models: 'Auto (SmartRouter)', cost: '$$$', latency: '2-10s', use: 'Code generation, analysis, multi-step reasoning, complex research' },
];

const IntelligenceSliderPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsBrainIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Intelligence Slider
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        The intelligence slider gives you direct control over the cost/quality tradeoff for every
        message you send. Lower settings route to fast, inexpensive models. Higher settings route to
        the most capable models available. The router also considers task complexity, making intelligent
        adjustments even within a given slider position.
      </p>
    </motion.div>

    {/* Visual slider */}
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '32px', marginBottom: '40px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-success)' }}>Fast / Low Cost</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#a855f7' }}>Maximum Quality</span>
      </div>
      <div style={{ height: '10px', borderRadius: '5px', background: 'linear-gradient(90deg, #22c55e, #3b82f6, #8b5cf6, #a855f7)', marginBottom: '8px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
          <span key={v} style={{ fontSize: '10px', color: 'var(--color-textMuted)', fontWeight: 600 }}>{v}</span>
        ))}
      </div>
    </motion.div>

    {/* Tiers table */}
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Routing Tiers</h2>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
              {['Tier', 'Model Selection', 'Cost', 'Latency', 'Best For'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => (
              <tr key={tier.position} style={{ borderBottom: i < tiers.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--color-text)' }}>{tier.position}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{tier.models}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-warning)' }}>{tier.cost}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{tier.latency}</td>
                <td style={{ padding: '12px 16px', color: 'var(--color-textSecondary)' }}>{tier.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>

    {/* Adaptive routing */}
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }} style={{ marginTop: '40px' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>Adaptive Routing</h2>
      <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        The router does not blindly follow the slider position. It considers message complexity,
        conversation length, whether tools will be needed, and whether agent delegation is likely.
        A simple factual question at slider position 80 may still be routed to a mid-tier model
        if the router determines that a more expensive model would not produce meaningfully
        better output. This keeps costs predictable without sacrificing quality where it matters.
      </p>
    </motion.div>
  </div>
);

export default IntelligenceSliderPage;
