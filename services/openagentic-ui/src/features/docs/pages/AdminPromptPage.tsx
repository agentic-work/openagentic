import React, { useMemo } from 'react';
import { motion, type Transition } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsBrainIcon, DocsToolIcon, DocsCodeIcon } from '../components/DocsIcons';

// ============================================================================
// PROMPT ASSEMBLY DIAGRAM
// ============================================================================

const promptAssemblyDiagram: DiagramDefinition = {
  type: 'process',
  title: 'Prompt Assembly Pipeline',
  description: 'How system prompts are composed from modules',
  layout: 'horizontal',
  nodes: [
    { id: 'context', label: 'User Context', description: 'Message + history', shape: 'rounded', color: 'blue' },
    { id: 'scoring', label: 'Module Scoring', description: 'Semantic embedding', shape: 'rounded', color: 'purple' },
    { id: 'selection', label: 'Module Selection', description: 'Top-k modules', shape: 'diamond', color: 'orange' },
    { id: 'assembly', label: 'Prompt Assembly', description: 'Ordered composition', shape: 'rounded', color: 'green' },
    { id: 'output', label: 'System Prompt', description: 'Final output', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'context', target: 'scoring', animated: true },
    { source: 'scoring', target: 'selection' },
    { source: 'selection', target: 'assembly' },
    { source: 'assembly', target: 'output', animated: true },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const moduleTypes = [
  {
    type: 'Core Modules',
    description: 'Always-included modules that define the AI assistant\'s foundational behavior. These contain identity, safety guidelines, response formatting rules, and base capabilities. Core modules are never filtered out by the scoring system.',
  },
  {
    type: 'Mode Modules',
    description: 'Mode-specific instructions activated based on the current interface: chat mode or flow mode. Each mode module tailors the AI\'s behavior for the active context.',
  },
  {
    type: 'Capability Modules',
    description: 'Skill-specific modules activated when relevant capabilities are detected. Examples include tool-calling instructions, agent delegation protocols, RAG context handling, and artifact generation. Scored by semantic relevance to the user\'s message.',
  },
  {
    type: 'Domain Modules',
    description: 'Organization-specific knowledge modules covering company policies, coding standards, architecture decisions, and domain terminology. Custom modules can be created by admins to inject company-specific context.',
  },
];

const scoringDetails = [
  { aspect: 'Embedding Generation', description: 'Each module has a pre-computed embedding vector generated from its content and description. User messages are embedded at request time using the same embedding model.' },
  { aspect: 'Cosine Similarity', description: 'Module relevance is calculated as the cosine similarity between the user message embedding and each module\'s embedding. Higher similarity indicates stronger relevance.' },
  { aspect: 'Threshold Filtering', description: 'Modules below a configurable similarity threshold (default 0.3) are excluded. This prevents irrelevant modules from consuming context window space.' },
  { aspect: 'Priority Weighting', description: 'Each module has an admin-assigned priority weight (0.0 to 1.0) that multiplies its similarity score. Critical modules can have high weights to ensure inclusion even with moderate similarity.' },
  { aspect: 'Context Budget', description: 'The total token budget for the system prompt is configurable. The scoring system selects the highest-scoring modules that fit within the budget, respecting the core module reservation.' },
];

const effectivenessMetrics = [
  { metric: 'Module Activation Rate', description: 'How often each module is included in the assembled prompt. Low activation rates may indicate modules that are too narrow or poorly described.' },
  { metric: 'User Satisfaction Correlation', description: 'Statistical correlation between module inclusion and positive user feedback. Helps identify which modules contribute most to response quality.' },
  { metric: 'Token Efficiency', description: 'Ratio of module tokens to total system prompt tokens. Identifies verbose modules that could be condensed without losing effectiveness.' },
  { metric: 'Overlap Analysis', description: 'Detection of content overlap between modules. Highlights redundant modules that can be merged or pruned.' },
];

const pipelineSettings = [
  { setting: 'Max System Prompt Tokens', description: 'Maximum token count for the assembled system prompt. Controls the balance between prompt richness and available context for user conversation. Default varies by model context window size.' },
  { setting: 'Core Module Reservation', description: 'Token budget reserved exclusively for core modules. Ensures foundational instructions are never crowded out by capability or domain modules.' },
  { setting: 'Scoring Model', description: 'The embedding model used for module scoring. Should match the embedding model used for tool discovery and RAG to maintain semantic consistency.' },
  { setting: 'Similarity Threshold', description: 'Minimum cosine similarity score for module inclusion. Lower values include more modules (broader context); higher values are more selective (focused context).' },
  { setting: 'Re-scoring Frequency', description: 'How often module embeddings are re-computed. Set to "on edit" for automatic re-embedding when module content changes, or "manual" for explicit control.' },
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

import { SedimentaryComposerPanel } from './SedimentaryComposerPanel';

const AdminPromptPage: React.FC = () => {
  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } as Transition,
    }),
    []
  );

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* HERO */}
      <motion.div {...fadeUp} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}><DocsBrainIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Prompt Engineering
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          The prompt engineering admin controls how system prompts are composed from
          modular components. The platform uses a scoring system based on semantic
          embeddings to dynamically select the most relevant prompt modules for each
          user message, optimizing both response quality and context window usage.
        </p>
      </motion.div>

      {/* PROMPT ASSEMBLY DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>Prompt Assembly Pipeline</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Each user message triggers a dynamic prompt assembly process that scores,
          selects, and composes the system prompt from available modules.
        </p>
        <ReactFlowDiagram
          diagram={promptAssemblyDiagram}
          height={300}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* SEDIMENTARY COMPOSER — animated turn-by-turn view of which modules
          settle for a given user request. Cycles through 4 example prompts
          so the gating (mode / capability / intent) becomes visible. */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Live Composition</p>
        <h2 style={sectionTitleStyle}>Sedimentary Strata</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '8px' }}>
          The bedrock identity layer is always present. Every always-on core layer
          stacks above it. Mode, capability, and domain modules settle on top only
          when their <code>injection</code> rule matches the request — exactly
          what an admin edits at <code>/admin#prompt-modules</code>. Watch the
          stack change as the example prompt cycles.
        </p>
        <SedimentaryComposerPanel />
      </motion.section>

      {/* MODULE TYPES */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Modules</p>
        <h2 style={sectionTitleStyle}>Prompt Module Types</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Prompt modules are organized into four categories, each serving a distinct
          purpose in the assembled system prompt.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {moduleTypes.map((m, i) => (
            <motion.div
              key={m.type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsBrainIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{m.type}</h4>
                <p style={descTextStyle}>{m.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* MODULE SCORING */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Scoring</p>
        <h2 style={sectionTitleStyle}>Module Scoring via Semantic Embeddings</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The scoring system determines which modules are included in each prompt assembly.
          It uses vector similarity to match modules to the user's intent.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {scoringDetails.map((s, i) => (
            <motion.div
              key={s.aspect}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{s.aspect}</h4>
              <p style={descTextStyle}>{s.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* EFFECTIVENESS METRICS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Analytics</p>
        <h2 style={sectionTitleStyle}>Effectiveness Metrics</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Track how well prompt modules perform and identify optimization opportunities.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {effectivenessMetrics.map((m, i) => (
            <motion.div
              key={m.metric}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{m.metric}</h4>
              <p style={descTextStyle}>{m.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* LEGACY TEMPLATES */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Deprecated</p>
        <h2 style={sectionTitleStyle}>Legacy Prompt Templates</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The legacy prompt template system is deprecated and will be removed in a future
          release. Legacy templates used static, monolithic system prompts without dynamic
          scoring. Existing templates continue to function but cannot be created or edited.
          Admins should migrate template content into the modular system by creating
          equivalent modules with appropriate categorization and priority weights.
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsCodeIcon size={24} /></div>
            <div>
              <h4 style={labelStyle}>Migration Path</h4>
              <p style={descTextStyle}>
                To migrate a legacy template: (1) identify the distinct sections within the
                monolithic prompt, (2) create a module for each section with the appropriate
                type (core, mode, capability, or domain), (3) set priority weights based on
                the section's importance, and (4) disable the legacy template once all modules
                are active and tested.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* PIPELINE SETTINGS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Configuration</p>
        <h2 style={sectionTitleStyle}>Pipeline Settings</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Global settings that control the prompt assembly pipeline behavior.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pipelineSettings.map((s, i) => (
            <motion.div
              key={s.setting}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)', background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 8px',
                }}>
                  setting
                </span>
                <h4 style={{ ...labelStyle, marginBottom: 0 }}>{s.setting}</h4>
              </div>
              <p style={descTextStyle}>{s.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default AdminPromptPage;
