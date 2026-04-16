import React from 'react';
import { motion } from 'framer-motion';
import { DocsAgentIcon } from '../components/DocsIcons';

const configFields = [
  { field: 'System Prompt', desc: 'The foundational instructions that define the agent personality, capabilities, and constraints. Supports template variables for dynamic context injection.' },
  { field: 'Model Preference', desc: 'The default LLM model for this agent type. Can be overridden by the intelligence slider. Specify primary and fallback models for resilience.' },
  { field: 'Tool Access', desc: 'A curated list of MCP tools available to this agent. Restricting tools improves accuracy by preventing the model from being overwhelmed with irrelevant function definitions.' },
  { field: 'Temperature', desc: 'Controls output randomness. Lower values (0.0-0.3) for factual/code tasks, higher values (0.7-1.0) for creative writing. Default varies by agent type.' },
  { field: 'Max Tokens', desc: 'Maximum output length for this agent. Research agents may need larger limits for comprehensive reports; utility agents can use shorter limits.' },
  { field: 'Delegation Rules', desc: 'Whether this agent can delegate to other agents, and which types. Prevents infinite delegation loops and controls orchestration depth.' },
];

const AgentConfigurationPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsAgentIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Agent Configuration
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Administrators can create new agent types, tune existing agents, and control how
        the orchestrator delegates work. Each agent has a system prompt, model preference,
        tool access list, and behavioral parameters that define its specialization.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '48px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Configuration Fields</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {configFields.map((f) => (
          <div key={f.field} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '20px 24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>{f.field}</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>{f.desc}</p>
          </div>
        ))}
      </div>
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>Best Practices</h2>
      <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Keep system prompts focused and concise. Overly long prompts consume context
        window and can confuse the model. Test new agent configurations in a staging
        environment before deploying to production. Monitor agent performance through
        the audit trail to identify prompts that need refinement.
      </p>
    </motion.section>
  </div>
);

export default AgentConfigurationPage;
