import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsAgentIcon, DocsBrainIcon, DocsToolIcon, DocsShieldIcon } from '../components/DocsIcons';

// ============================================================================
// AGENT CREATION FLOW DIAGRAM
// ============================================================================

const agentCreationDiagram: DiagramDefinition = {
  type: 'process',
  title: 'Agent Configuration Flow',
  description: 'From creation to deployment',
  layout: 'horizontal',
  nodes: [
    { id: 'define', label: 'Define Agent', description: 'Name & description', shape: 'rounded', color: 'purple' },
    { id: 'model', label: 'Model Selection', description: 'SmartRouter (default)', shape: 'rounded', color: 'blue' },
    { id: 'persona', label: 'Configure Persona', description: 'Role, tone, bounds', shape: 'rounded', color: 'indigo' },
    { id: 'tools', label: 'Tool Policy', description: 'Allow/deny rules', shape: 'rounded', color: 'orange' },
    { id: 'test', label: 'Playground Test', description: 'Interactive validation', shape: 'diamond', color: 'green' },
    { id: 'deploy', label: 'Deploy', description: 'Live in registry', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'define', target: 'model' },
    { source: 'model', target: 'persona' },
    { source: 'persona', target: 'tools' },
    { source: 'tools', target: 'test' },
    { source: 'test', target: 'deploy', label: 'pass', animated: true },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const agentTabs = [
  {
    name: 'Registry',
    description: 'The central catalog of all configured agents. Displays each agent as a card with its name, description, model assignment, status, and last execution time. Supports search, filtering by status, and sorting by usage count. Admins can create, edit, duplicate, or delete agents from this view.',
  },
  {
    name: 'Skills & Plugins',
    description: 'Manage reusable skill modules and plugin integrations that agents can leverage. Skills are composable units of capability (e.g., "web search", "code review") that can be assigned to multiple agents. Plugins extend agent behavior with custom logic.',
  },
  {
    name: 'Playground',
    description: 'An interactive testing environment for validating agent behavior before deployment. Send test prompts and inspect the full response including output text, token counts (input and output), tool calls made, latency breakdown, and cost estimate. Side-by-side comparison mode allows testing two agent configurations simultaneously.',
  },
  {
    name: 'Observability',
    description: 'Real-time and historical analytics for agent performance. Metrics include execution count, success rate, average latency, token consumption, and cost per execution. Drill into individual execution traces to inspect the full agent reasoning chain, tool calls, and response quality.',
  },
];

const creationFields = [
  { field: 'Name', description: 'A unique identifier for the agent. Used in delegation rules, logs, and the registry. Names should be descriptive and follow a consistent naming convention.' },
  { field: 'Model Selection', description: 'All agents use SmartRouter (auto) by default, which dynamically selects the optimal model based on task complexity. Admins can override this to pin an agent to a specific provider and model when deterministic behavior is required.' },
  { field: 'Tool Policy', description: 'Controls which MCP tools the agent can invoke. Supports allow-mode (whitelist specific tools) and deny-mode (blacklist specific tools, allow all others). High-risk tools are auto-detected and flagged for review.' },
  { field: 'Persona', description: 'Defines the agent\'s behavioral characteristics including role, communication tone, operational boundaries, and bootstrap instructions that prime the agent on first invocation.' },
  { field: 'Cost Budgets', description: 'Per-execution and daily spend limits for the agent. When a budget is exceeded, the agent either fails gracefully or downgrades to a cheaper model depending on the configured policy.' },
];

const personaFields = [
  { field: 'Role', description: 'The agent\'s primary function stated as a role description (e.g., "Senior security analyst specializing in cloud infrastructure"). This anchors the agent\'s expertise and response framing.' },
  { field: 'Tone', description: 'Communication style guidance: formal, concise, educational, friendly, etc. Can include specific instructions like "always explain reasoning" or "use bullet points for lists".' },
  { field: 'Boundaries', description: 'Hard constraints on what the agent should never do. Examples: "never execute destructive commands", "never share PII", "always cite sources". Boundaries are enforced at the system prompt level.' },
  { field: 'Bootstrap Instructions', description: 'Initial context injected on the agent\'s first message in a session. Used to provide domain-specific knowledge, company policies, or situational context that should persist throughout the conversation.' },
];

const toolPolicyDetails = [
  { mode: 'Allow Mode', description: 'Only the explicitly listed tools are available to the agent. All other tools are blocked. Best for agents with a narrow, well-defined scope where you want to minimize unexpected behavior.' },
  { mode: 'Deny Mode', description: 'All tools are available except those explicitly blocked. Best for general-purpose agents where you want broad capability but need to restrict specific high-risk operations.' },
  { mode: 'High-Risk Auto-Detection', description: 'The system automatically identifies tools that perform destructive, irreversible, or sensitive operations (e.g., delete resources, modify infrastructure, access credentials). These are flagged in the policy editor and require explicit acknowledgment to allow.' },
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

const AdminAgentsPage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsAgentIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Agent Management
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          The Agent Management console provides a complete toolkit for creating, configuring,
          testing, and monitoring AI agents. Agents are specialist workers that the orchestrator
          delegates to based on task requirements. All agents use SmartRouter (auto) by default,
          which dynamically selects the optimal model for each request.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <img
          src="/docs/screenshots/admin-agents.png"
          alt="Agent management interface showing the registry tab with agent cards"
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}
        />
      </motion.section>

      {/* FOUR TABS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Navigation</p>
        <h2 style={sectionTitleStyle}>Four Management Tabs</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Agent management is organized into four tabs covering the full agent lifecycle
          from creation through monitoring.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {agentTabs.map((tab, i) => (
            <motion.div
              key={tab.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span style={{
                  display: 'inline-block', fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)',
                  background: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)',
                  borderRadius: '6px', padding: '2px 10px', letterSpacing: '0.04em',
                }}>
                  Tab {i + 1}
                </span>
                <h4 style={{ ...labelStyle, marginBottom: 0 }}>{tab.name}</h4>
              </div>
              <p style={descTextStyle}>{tab.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* AGENT CREATION */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Configuration</p>
        <h2 style={sectionTitleStyle}>Agent Creation</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Creating a new agent involves configuring several fields that define its identity,
          capabilities, and behavioral constraints.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {creationFields.map((f, i) => (
            <motion.div
              key={f.field}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.04, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                <DocsBrainIcon size={20} />
              </div>
              <div>
                <h4 style={labelStyle}>{f.field}</h4>
                <p style={descTextStyle}>{f.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CREATION FLOW DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Workflow</p>
        <h2 style={sectionTitleStyle}>Agent Configuration Flow</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The typical flow from defining a new agent through to deployment.
        </p>
        <ReactFlowDiagram
          diagram={agentCreationDiagram}
          height={320}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* PERSONA SYSTEM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Behavioral Design</p>
        <h2 style={sectionTitleStyle}>Persona System</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The persona system provides fine-grained control over how an agent communicates
          and behaves. Persona settings are injected into the system prompt and shape every
          response the agent generates.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {personaFields.map((f, i) => (
            <motion.div
              key={f.field}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{f.field}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* TOOL POLICY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Access Control</p>
        <h2 style={sectionTitleStyle}>Tool Policy</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Tool policies control which MCP tools an agent can access. The policy editor
          provides a visual interface for configuring allow and deny rules.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {toolPolicyDetails.map((tp, i) => (
            <motion.div
              key={tp.mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                <DocsShieldIcon size={20} />
              </div>
              <div>
                <h4 style={labelStyle}>{tp.mode}</h4>
                <p style={descTextStyle}>{tp.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CRON SCHEDULER */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Automation</p>
        <h2 style={sectionTitleStyle}>Visual Cron Scheduler</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Agents can be scheduled to run on a recurring basis using the visual cron scheduler.
          Instead of writing raw cron expressions, admins use a graphical interface to set
          frequency (hourly, daily, weekly, monthly), time of day, day of week, and timezone.
          The scheduler generates the equivalent cron expression and displays upcoming execution
          times for verification.
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsToolIcon size={24} /></div>
            <div>
              <h4 style={labelStyle}>Scheduling Use Cases</h4>
              <p style={descTextStyle}>
                Common scheduled agent patterns include daily security scans, weekly report
                generation, hourly data quality checks, and periodic knowledge base refreshes.
                Scheduled runs appear in the observability tab alongside manually triggered
                executions.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* PLAYGROUND DETAILS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Testing</p>
        <h2 style={sectionTitleStyle}>Playground Details</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The playground provides an interactive sandbox for testing agent configurations
          before deploying them to production. Key features include:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {[
            { title: 'Input Panel', desc: 'Free-form text input with support for multi-turn conversation simulation. Paste real user messages to test against production scenarios.' },
            { title: 'Output Panel', desc: 'Full agent response with streaming preview. Includes markdown rendering, code highlighting, and tool call visualization.' },
            { title: 'Token Metrics', desc: 'Real-time display of input tokens, output tokens, total tokens, and estimated cost for each exchange. Helps optimize prompts for cost efficiency.' },
            { title: 'Comparison Mode', desc: 'Run the same prompt against two agent configurations side-by-side. Useful for A/B testing persona changes, tool policy adjustments, or model swaps.' },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.05, duration: 0.35 }}
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

export default AdminAgentsPage;
