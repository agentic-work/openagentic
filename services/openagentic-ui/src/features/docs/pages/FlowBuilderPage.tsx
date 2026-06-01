// theme-allow: this docs page is decorative gradient SVG illustration icons plus the
// workflow node-CATEGORY identity color scale (the same node-TYPE palette carve-out
// as the workflow canvas) — categorical/illustration values, not themeable surfaces.
import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const CanvasIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="canvasGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="3" stroke="url(#canvasGrad)" strokeWidth="2" />
    <rect x="5" y="5" width="5" height="4" rx="1" fill="url(#canvasGrad)" fillOpacity="0.4" />
    <rect x="14" y="5" width="5" height="4" rx="1" fill="url(#canvasGrad)" fillOpacity="0.4" />
    <rect x="9" y="15" width="6" height="4" rx="1" fill="url(#canvasGrad)" fillOpacity="0.4" />
    <path d="M7.5 9v3l4.5 3" stroke="url(#canvasGrad)" strokeWidth="1.5" opacity="0.6" />
    <path d="M16.5 9v3l-4.5 3" stroke="url(#canvasGrad)" strokeWidth="1.5" opacity="0.6" />
  </svg>
);

const ExecutionIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="execGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <polygon points="5,3 19,12 5,21" fill="url(#execGrad)" fillOpacity="0.2" stroke="url(#execGrad)" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const ErrorIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="errorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" stroke="url(#errorGrad)" strokeWidth="2" />
    <line x1="12" y1="8" x2="12" y2="12" stroke="url(#errorGrad)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1" fill="url(#errorGrad)" />
  </svg>
);

// ============================================================================
// DIAGRAM
// ============================================================================

const flowExecutionDiagram: DiagramDefinition = {
  type: 'flowchart',
  title: 'Workflow Execution Pipeline',
  layout: 'horizontal',
  nodes: [
    { id: 'trigger', label: 'Trigger', description: 'Cron / Webhook / Manual', shape: 'rounded', color: 'green' },
    { id: 'validate', label: 'Validate', description: 'Schema check', shape: 'rounded', color: 'blue' },
    { id: 'execute', label: 'Execute Nodes', description: 'DAG traversal', shape: 'rounded', color: 'purple' },
    { id: 'stream', label: 'SSE Stream', description: 'Real-time state', shape: 'rounded', color: 'cyan' },
    { id: 'complete', label: 'Complete', description: 'Results + audit', shape: 'rounded', color: 'green' },
  ],
  edges: [
    { source: 'trigger', target: 'validate', animated: true },
    { source: 'validate', target: 'execute' },
    { source: 'execute', target: 'stream', animated: true },
    { source: 'stream', target: 'complete' },
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

const FlowBuilderPage: React.FC = () => {
  const nodeCategories = [
    {
      name: 'Trigger',
      color: '#22c55e',
      nodes: [
        { name: 'trigger', description: 'Start a workflow via manual run, cron schedule, webhook, chat message, or file upload' },
      ],
    },
    {
      name: 'AI Nodes',
      color: '#8b5cf6',
      nodes: [
        { name: 'llm_completion', description: 'Send a prompt to any configured model and get a completion' },
        { name: 'openagentic_llm', description: 'Use the platform LLM with SmartRouter capability-based model selection' },
        { name: 'synth', description: 'Synthesize structured outputs from multiple inputs' },
      ],
    },
    {
      name: 'Agents',
      color: '#a855f7',
      nodes: [
        { name: 'agent_spawn', description: 'Spawn a new agent for a delegated task' },
        { name: 'agent_single', description: 'Run a single agent with persona and tool policy' },
        { name: 'agent_pool', description: 'Run multiple agents in parallel with aggregation' },
        { name: 'agent_supervisor', description: 'Supervisor coordinates worker agents' },
        { name: 'multi_agent', description: 'Multi-agent orchestration (sequential, parallel, debate)' },
        { name: 'a2a', description: 'Agent-to-agent communication' },
      ],
    },
    {
      name: 'Logic',
      color: '#3b82f6',
      nodes: [
        { name: 'condition', description: 'Branch the flow based on a boolean expression or JSON path check' },
        { name: 'loop', description: 'Iterate over an array, executing child nodes for each item' },
        { name: 'merge', description: 'Wait for multiple parallel branches to complete before continuing' },
        { name: 'transform', description: 'Apply JSONata or JavaScript expressions to reshape data' },
        { name: 'code', description: 'Execute custom JavaScript, Python, or Bash code' },
      ],
    },
    {
      name: 'Integration',
      color: '#22c55e',
      nodes: [
        { name: 'http_request', description: 'Make HTTP calls to external APIs with auth, headers, and retry' },
        { name: 'mcp_tool', description: 'Invoke an MCP tool from a connected server' },
        { name: 'slack_message', description: 'Send messages to Slack channels' },
        { name: 'teams_message', description: 'Post adaptive cards or messages to Teams' },
        { name: 'outlook_email', description: 'Send emails via Outlook/Exchange' },
        { name: 'send_email', description: 'Send emails via SMTP' },
        { name: 'pagerduty_incident', description: 'Create, acknowledge, or resolve PagerDuty incidents' },
        { name: 'servicenow_ticket', description: 'Create tickets and manage ServiceNow records' },
        { name: 'jira_issue', description: 'Create issues, transition statuses, add comments' },
        { name: 'discord_message', description: 'Send messages to Discord channels' },
      ],
    },
    {
      name: 'Control',
      color: '#f97316',
      nodes: [
        { name: 'approval', description: 'Pause execution until a human approves or rejects' },
        { name: 'human_approval', description: 'HITL approval gate with reviewer notifications' },
        { name: 'wait', description: 'Pause execution for a specified duration or until a condition is met' },
        { name: 'error_handler', description: 'Catch errors from upstream nodes and execute recovery logic' },
        { name: 'user_context', description: 'Access unified cross-mode memory in workflows' },
      ],
    },
    {
      name: 'Annotation',
      color: '#94a3b8',
      nodes: [
        { name: 'text', description: 'Text annotation for notes and documentation on the canvas' },
      ],
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Page Title */}
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Visual Workflow Builder
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          Build complex automation without code. The Flows mode provides a drag-and-drop canvas
          with 34 node types across 7 categories where you connect nodes to create powerful workflows
          that integrate AI, external services, and business logic.
        </p>
      </motion.div>

      {/* The Canvas */}
      <motion.section custom={1} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <CanvasIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            The Canvas
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          The workflow canvas is a zoomable, pannable infinite surface. Drag nodes from the palette
          on the left, drop them onto the canvas, and draw connections between output and input ports.
          The canvas automatically validates connections and prevents invalid wiring.
        </p>
        <div
          className="rounded-xl p-6 mb-10 grid grid-cols-1 sm:grid-cols-3 gap-4"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          {[
            { title: 'Drag and Drop', detail: 'Drag nodes from the sidebar palette onto the canvas. Nodes snap to a grid for clean alignment.' },
            { title: 'Connect Ports', detail: 'Click an output port and drag to an input port to create a connection. Data flows along these edges.' },
            { title: 'Configure Nodes', detail: 'Click any node to open its configuration panel. Set parameters, map inputs, and define outputs.' },
          ].map((item) => (
            <div key={item.title}>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* Node Categories */}
      <motion.section custom={2} variants={sectionVariants} initial="hidden" animate="visible">
        <h2 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text)' }}>
          Node Types
        </h2>
        <div className="space-y-6 mb-10">
          {nodeCategories.map((category, catIdx) => (
            <motion.div
              key={category.name}
              custom={catIdx + 3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div
                className="px-5 py-3 flex items-center gap-3"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {category.name}
                </h3>
                <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                  {category.nodes.length} nodes
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {category.nodes.map((node) => (
                  <div
                    key={node.name}
                    className="px-5 py-3 flex items-start gap-3"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                      style={{ backgroundColor: category.color, opacity: 0.6 }}
                    />
                    <div>
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {node.name}
                      </span>
                      <p className="text-sm mt-0.5" style={{ color: 'var(--color-textSecondary)' }}>
                        {node.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Execution */}
      <motion.section custom={8} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <ExecutionIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Workflow Execution
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          When a workflow runs, the engine traverses the node graph as a directed acyclic graph (DAG).
          Nodes with no dependencies execute first, and downstream nodes run as their inputs become
          available. The entire execution is streamed to the UI via Server-Sent Events (SSE), so you
          see each node light up as it starts, completes, or fails.
        </p>
        <ReactFlowDiagram diagram={flowExecutionDiagram} height={300} className="mb-10" />
      </motion.section>

      {/* Scheduling */}
      <motion.section custom={9} variants={sectionVariants} initial="hidden" animate="visible">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          Scheduling and Triggers
        </h2>
        <div
          className="rounded-xl overflow-hidden mb-10"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Trigger Type</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Description</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Example</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Cron Schedule', 'Run on a recurring schedule using cron syntax', '0 9 * * 1-5 (weekdays at 9am)'],
                ['Webhook', 'Trigger via an HTTP POST to a unique URL', 'POST /api/v1/flows/{id}/trigger'],
                ['API Call', 'Trigger programmatically from the SDK or API', 'sdk.flows.run(flowId, inputs)'],
                ['Manual', 'Run on demand from the Flows UI', 'Click "Run" in the toolbar'],
                ['Event', 'React to platform events like alerts or incidents', 'on: alert.firing'],
              ].map(([type, desc, example], i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="p-3 font-medium" style={{ color: 'var(--color-text)' }}>{type}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{desc}</td>
                  <td className="p-3 font-mono text-xs" style={{ color: 'var(--color-textMuted)' }}>{example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Error Handling */}
      <motion.section custom={10} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <ErrorIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Error Handling
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          Workflows can fail at any node. The engine provides three mechanisms for graceful
          error recovery.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'Retry Policies',
              detail: 'Configure per-node retry with exponential backoff. Set max attempts, initial delay, and backoff multiplier.',
            },
            {
              title: 'Fallback Nodes',
              detail: 'Designate a fallback path that executes when the primary path fails. Useful for degraded-mode operation.',
            },
            {
              title: 'Circuit Breakers',
              detail: 'Automatically stop retrying after repeated failures. The circuit opens and skips the node until it resets.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl p-5"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default FlowBuilderPage;
