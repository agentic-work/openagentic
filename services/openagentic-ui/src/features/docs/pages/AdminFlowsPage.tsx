import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsFlowIcon, DocsShieldIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// GOVERNANCE HIERARCHY DIAGRAM
// ============================================================================

const governanceDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Governance Hierarchy',
  description: 'Three-level override chain',
  layout: 'vertical',
  nodes: [
    { id: 'admin', label: 'Admin Caps', description: 'Platform-wide limits', shape: 'rounded', color: 'red' },
    { id: 'workflow', label: 'Workflow Defaults', description: 'Per-workflow settings', shape: 'rounded', color: 'orange' },
    { id: 'node', label: 'Node Overrides', description: 'Per-node tuning', shape: 'rounded', color: 'green' },
    { id: 'execution', label: 'Execution', description: 'Effective config', shape: 'diamond', color: 'primary' },
  ],
  edges: [
    { source: 'admin', target: 'workflow', label: 'constrains' },
    { source: 'workflow', target: 'node', label: 'constrains' },
    { source: 'node', target: 'execution', animated: true },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const workflowListFields = [
  { field: 'Name', description: 'The workflow display name and unique identifier. Supports search and filtering.' },
  { field: 'Status', description: 'Current state: active, paused, draft, or archived. Active workflows can be triggered; draft workflows are still being built.' },
  { field: 'Last Modified', description: 'Timestamp of the most recent edit with the username of the editor. Helps identify stale workflows that may need review.' },
  { field: 'Last Execution', description: 'Timestamp and outcome of the most recent run. Shows success, failure, or in-progress with a link to the execution detail.' },
  { field: 'Trigger Type', description: 'How the workflow is invoked: manual, cron schedule, webhook, or event-driven. Cron workflows show the next scheduled run.' },
  { field: 'Node Count', description: 'Number of nodes in the workflow canvas. Provides a quick sense of workflow complexity.' },
];

const executionDetailFields = [
  { field: 'Execution Timeline', description: 'Visual timeline showing each node execution with start time, duration, and status. Nodes are color-coded: green (success), red (failure), yellow (skipped), gray (pending).' },
  { field: 'Node Outputs', description: 'Expandable output for each node showing the data it produced. Includes raw JSON, rendered markdown, and file artifacts.' },
  { field: 'Error Details', description: 'For failed nodes, the full error message, stack trace, and retry history. Includes suggested fixes when available.' },
  { field: 'Token Usage', description: 'Per-node and total token consumption for nodes that invoke LLM calls. Shows input, output, and total tokens with cost attribution.' },
  { field: 'Duration Breakdown', description: 'Waterfall chart showing parallel and sequential node execution times. Identifies bottlenecks in the workflow.' },
];

const governanceTabs = [
  {
    name: 'Execution Limits',
    description: 'Control maximum execution time (timeout), maximum node count per workflow, concurrent execution limits, and retry policies. Admin caps set the absolute ceiling; workflow defaults can lower but not raise these limits.',
  },
  {
    name: 'Cost Caps',
    description: 'Set maximum spend per execution, per day, and per month. Cost caps apply to LLM token usage, tool invocations, and external API calls. When a cap is reached, the workflow pauses and notifies the owner.',
  },
  {
    name: 'Model Restrictions',
    description: 'Define which LLM providers and models are available to workflow nodes. Admins can restrict workflows to specific providers (e.g., Azure-only for compliance) or block expensive models from automated workflows.',
  },
  {
    name: 'Node Type Controls',
    description: 'Enable or disable specific node types at the platform level. For example, admins can disable the "Shell Command" node type in production while keeping it available in staging. Controls which node types require admin approval to add.',
  },
  {
    name: 'Memory Settings',
    description: 'Configure conversation memory behavior for workflow nodes that use LLM calls. Settings include context window size, memory strategy (sliding window, summary, or full), and whether cross-node memory sharing is enabled.',
  },
];

const credentialTypes = [
  { type: 'API Keys', description: 'Static API keys for external service authentication. Stored encrypted (AES-256) and injected at runtime. Supports rotation without workflow edits.' },
  { type: 'OAuth Tokens', description: 'OAuth 2.0 credentials with automatic token refresh. The platform handles the refresh flow transparently, so workflows never see expired tokens.' },
  { type: 'Service Accounts', description: 'Cloud provider service account credentials (Azure service principal, AWS IAM role, GCP service account). Scoped to minimum required permissions.' },
  { type: 'Custom Secrets', description: 'Arbitrary key-value secrets for custom integrations. Support multi-line values for certificates and PEM keys.' },
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

const AdminFlowsPage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsFlowIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Workflow Administration
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          The workflow admin console provides oversight of all automated workflows on the
          platform. Review workflow configurations, inspect execution history, configure
          governance rules, manage credentials, and track costs across all workflow
          executions.
        </p>
      </motion.div>

      {/* WORKFLOW LIST */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Inventory</p>
        <h2 style={sectionTitleStyle}>Workflow List</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The main view displays all workflows in a sortable, filterable table. Each row
          provides essential metadata for quick assessment.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {workflowListFields.map((f, i) => (
            <motion.div
              key={f.field}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.04, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.field}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* EXECUTION HISTORY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>History</p>
        <h2 style={sectionTitleStyle}>Execution History</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Every workflow execution is recorded with full detail. Click any execution to
          open the detail view with timeline, outputs, and diagnostics.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {executionDetailFields.map((f, i) => (
            <motion.div
              key={f.field}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.field}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* GOVERNANCE HIERARCHY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Governance</p>
        <h2 style={sectionTitleStyle}>Three-Level Governance</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Governance is enforced through a three-level hierarchy. Admin caps set
          platform-wide hard limits. Workflow defaults provide per-workflow settings
          that cannot exceed admin caps. Node overrides allow fine-tuning at the
          individual node level within workflow constraints.
        </p>
        <ReactFlowDiagram
          diagram={governanceDiagram}
          height={380}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* GOVERNANCE TABS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Settings</p>
        <h2 style={sectionTitleStyle}>Five Governance Tabs</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Governance settings are organized into five categories, each controlling a
          different aspect of workflow execution behavior.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {governanceTabs.map((tab, i) => (
            <motion.div
              key={tab.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                background: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)',
                fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)',
              }}>
                {i + 1}
              </span>
              <div>
                <h4 style={labelStyle}>{tab.name}</h4>
                <p style={descTextStyle}>{tab.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CREDENTIALS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Secrets</p>
        <h2 style={sectionTitleStyle}>Credentials Management</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Workflows often need credentials to access external services. The credentials
          manager provides a secure vault for storing and injecting secrets into workflow
          nodes at runtime.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {credentialTypes.map((ct, i) => (
            <motion.div
              key={ct.type}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.05, duration: 0.35 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsShieldIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{ct.type}</h4>
                <p style={descTextStyle}>{ct.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* COST TRACKING */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Financials</p>
        <h2 style={sectionTitleStyle}>Cost Tracking</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Every workflow execution tracks its cost in real time. Costs are attributed to
          individual nodes, aggregated per workflow, and rolled up to the platform level.
          The cost view provides:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[
            { title: 'Per-Execution Cost', desc: 'Detailed breakdown of LLM tokens, tool invocations, and external API calls for each execution. Viewable in the execution detail panel.' },
            { title: 'Workflow Totals', desc: 'Cumulative cost across all executions of a workflow. Includes daily, weekly, and monthly aggregations with trend indicators.' },
            { title: 'Budget Alerts', desc: 'Configurable thresholds that trigger notifications when cost approaches or exceeds defined limits. Alerts go to workflow owners and platform admins.' },
            { title: 'Cost Forecasting', desc: 'Projected spend based on historical execution frequency and average cost per run. Helps plan budgets and identify cost optimization opportunities.' },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{item.title}</h4>
              <p style={descTextStyle}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default AdminFlowsPage;
