// theme-allow: decorative gradient SVG illustration icons + workflow node-TYPE
// category identity colors (same node-type palette carve-out as the workflow canvas).
import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const PipelineIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="pipeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#eab308" />
      </linearGradient>
    </defs>
    <rect x="2" y="4" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <rect x="9.5" y="4" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <rect x="17" y="4" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <path d="M7 6.5h2.5M14.5 6.5H17" stroke="url(#pipeGrad)" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="2" y="15" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <rect x="9.5" y="15" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <rect x="17" y="15" width="5" height="5" rx="1.5" fill="url(#pipeGrad)" fillOpacity="0.3" stroke="url(#pipeGrad)" strokeWidth="1.5" />
    <path d="M7 17.5h2.5M14.5 17.5H17" stroke="url(#pipeGrad)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// ============================================================================
// DIAGRAM
// ============================================================================

const executionDiagram: DiagramDefinition = {
  type: 'flowchart',
  title: 'Tool Execution Pipeline',
  description: 'From tool call to validated result',
  layout: 'horizontal',
  nodes: [
    { id: 'call', label: 'Tool Call', description: 'From LLM', shape: 'rounded', color: 'purple' },
    { id: 'hitl', label: 'HITL Check', description: 'Approval gate', shape: 'diamond', color: 'red' },
    { id: 'dlp', label: 'DLP Scan', description: 'Input scanning', shape: 'rounded', color: 'orange' },
    { id: 'cred', label: 'Credential Scope', description: 'OBO token', shape: 'rounded', color: 'blue' },
    { id: 'exec', label: 'Execute', description: 'MCP server', shape: 'rounded', color: 'green' },
    { id: 'validate', label: 'Validate', description: 'Output check', shape: 'rounded', color: 'cyan' },
    { id: 'cache', label: 'Cache', description: 'Redis TTL', shape: 'database', color: 'red' },
  ],
  edges: [
    { source: 'call', target: 'hitl', animated: true },
    { source: 'hitl', target: 'dlp' },
    { source: 'dlp', target: 'cred' },
    { source: 'cred', target: 'exec' },
    { source: 'exec', target: 'validate' },
    { source: 'validate', target: 'cache', style: 'dashed' },
  ],
};

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// ============================================================================
// COMPONENT
// ============================================================================

const ToolExecutionPage: React.FC = () => {
  const stages = [
    {
      name: 'HITL Check',
      description: 'The platform checks if the tool requires human-in-the-loop approval. If it does, execution pauses and a notification is sent to the approver. The tool only runs if approved.',
      color: '#ef4444',
    },
    {
      name: 'DLP Scan',
      description: 'Tool input arguments are scanned by the DLP engine for sensitive data (credentials, PII, secrets). Depending on severity, inputs may be allowed, redacted, or blocked.',
      color: '#f97316',
    },
    {
      name: 'Credential Scoping',
      description: 'The platform injects the user\'s scoped credentials (OBO tokens for Azure, session-bound API keys for AWS/GCP). Tools never see raw platform secrets -- only user-context tokens.',
      color: '#3b82f6',
    },
    {
      name: 'Execution',
      description: 'The MCP router dispatches the call to the appropriate server. The server executes the operation against the real external service and returns structured results.',
      color: '#22c55e',
    },
    {
      name: 'Output Validation',
      description: 'The tool result is scanned by DLP (for output leakage) and validated against the expected schema. Malformed or flagged results are sanitized before reaching the LLM.',
      color: '#06b6d4',
    },
    {
      name: 'Caching',
      description: 'Read-only tool results are cached in Redis with a configurable TTL. Identical queries within the TTL window return cached results, reducing external API calls and latency.',
      color: '#ef4444',
    },
  ];

  const readOnlyVsWrite = [
    { aspect: 'Approval', readOnly: 'No HITL required', write: 'HITL required (configurable)' },
    { aspect: 'Caching', readOnly: 'Results cached (TTL-based)', write: 'Never cached' },
    { aspect: 'DLP', readOnly: 'Output scan only', write: 'Input + output scan' },
    { aspect: 'Audit', readOnly: 'Logged at INFO level', write: 'Logged at WARN level with full args' },
    { aspect: 'Rate limit', readOnly: 'Standard rate', write: 'Reduced rate with cooldown' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Tool Execution
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          Every tool call goes through a multi-stage pipeline before reaching the external service.
          This pipeline enforces security, compliance, and operational safety at every step.
        </p>
      </motion.div>

      {/* Execution Pipeline Diagram */}
      <motion.section custom={1} variants={sectionVariants} initial="hidden" animate="visible" className="mb-10">
        <ReactFlowDiagram diagram={executionDiagram} height={340} />
      </motion.section>

      {/* Pipeline Stages */}
      <motion.section custom={2} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-6">
          <PipelineIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Pipeline Stages
          </h2>
        </div>
        <div className="space-y-4 mb-10">
          {stages.map((stage, i) => (
            <motion.div
              key={stage.name}
              custom={i + 3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="rounded-xl p-5 flex gap-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                <div className="w-0.5 flex-1" style={{ backgroundColor: i < stages.length - 1 ? 'var(--color-border)' : 'transparent' }} />
              </div>
              <div>
                <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                  {stage.name}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                  {stage.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Read-Only vs Write */}
      <motion.section custom={9} variants={sectionVariants} initial="hidden" animate="visible">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          Read-Only vs Write Operations
        </h2>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          The platform distinguishes between read-only tools (queries, listing, searching) and write
          tools (creating, updating, deleting). Write operations receive additional scrutiny.
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Aspect</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Read-Only</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Write</th>
              </tr>
            </thead>
            <tbody>
              {readOnlyVsWrite.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="p-3 font-medium" style={{ color: 'var(--color-text)' }}>{row.aspect}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{row.readOnly}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{row.write}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

export default ToolExecutionPage;
