import React, { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// ============================================================================
// DATA
// ============================================================================

interface NodeType {
  name: string;
  description: string;
  inputs: string;
  outputs: string;
}

interface NodeCategory {
  name: string;
  color: string;
  description: string;
  nodes: NodeType[];
}

const nodeCategories: NodeCategory[] = [
  {
    name: 'Trigger',
    color: '#22c55e',
    description: 'Entry points for workflow execution.',
    nodes: [
      { name: 'trigger', description: 'Start a workflow via manual run, cron schedule, chat message, file upload, webhook, or admin action.', inputs: 'trigger_config', outputs: 'trigger_data, context' },
    ],
  },
  {
    name: 'AI Nodes',
    color: '#8b5cf6',
    description: 'Nodes that interact with language models and AI agents.',
    nodes: [
      { name: 'llm_completion', description: 'Send a prompt to any configured LLM provider and receive a completion. Supports system prompts, temperature, max tokens, and JSON mode.', inputs: 'prompt, system_prompt, model, temperature', outputs: 'completion, tokens_used, finish_reason' },
      { name: 'openagentic_llm', description: 'Use the OpenAgentic platform LLM with SmartModelRouter capability scoring and per-user × per-model budget caps.', inputs: 'prompt, model_override', outputs: 'completion, model_used' },
      { name: 'synth', description: 'Synthesize tool for generating structured outputs from multiple inputs.', inputs: 'inputs[], synthesis_config', outputs: 'synthesized_result' },
    ],
  },
  {
    name: 'Agent Nodes',
    color: '#a855f7',
    description: 'Nodes for single and multi-agent orchestration.',
    nodes: [
      { name: 'agent_spawn', description: 'Spawn a new agent to handle a delegated task with its own context and tool access.', inputs: 'task, agent_type, context', outputs: 'result, tool_calls, reasoning' },
      { name: 'agent_single', description: 'Run a single agent with a specific persona and tool policy.', inputs: 'task, persona, tools', outputs: 'result, reasoning' },
      { name: 'agent_pool', description: 'Run multiple agents in parallel with configurable concurrency and aggregation strategy.', inputs: 'task, agents[], concurrency', outputs: 'results[], aggregated' },
      { name: 'agent_supervisor', description: 'Supervisor agent that coordinates worker agents with dynamic delegation rounds.', inputs: 'task, workers[], max_rounds', outputs: 'result, delegation_log' },
      { name: 'multi_agent', description: 'Coordinate multiple agents working on different aspects of a complex task. Supports sequential, parallel, and debate patterns.', inputs: 'task, agent_configs[], orchestration_mode', outputs: 'results[], consensus' },
      { name: 'a2a', description: 'Agent-to-agent communication node for cross-agent message passing.', inputs: 'source_agent, target_agent, message', outputs: 'response' },
    ],
  },
  {
    name: 'Logic Nodes',
    color: '#3b82f6',
    description: 'Control flow and data transformation nodes.',
    nodes: [
      { name: 'condition', description: 'Branch the flow based on a boolean expression. Supports JSONPath, regex matching, and JavaScript expressions.', inputs: 'expression, data', outputs: 'true_branch, false_branch' },
      { name: 'loop', description: 'Iterate over an array, executing the loop body for each element. Supports parallel and sequential modes.', inputs: 'items[], mode, concurrency', outputs: 'results[], errors[]' },
      { name: 'merge', description: 'Wait for multiple parallel branches to complete before continuing. Configurable to wait for all or any.', inputs: 'branches[]', outputs: 'merged_data' },
      { name: 'transform', description: 'Reshape data using JSONata expressions or JavaScript functions.', inputs: 'data, expression', outputs: 'transformed' },
      { name: 'code', description: 'Execute custom JavaScript, Python, or Bash code within the workflow.', inputs: 'code, language, data', outputs: 'result, stdout, stderr' },
    ],
  },
  {
    name: 'Integration Nodes',
    color: '#22c55e',
    description: 'Connect to external services and APIs.',
    nodes: [
      { name: 'http_request', description: 'Make HTTP calls to any URL with configurable method, headers, body, auth, and retry.', inputs: 'url, method, headers, body, auth', outputs: 'status, headers, body' },
      { name: 'mcp_tool', description: 'Invoke an MCP tool from a connected MCP server.', inputs: 'server, tool_name, arguments', outputs: 'result, error' },
      { name: 'slack_message', description: 'Send messages to Slack channels or threads.', inputs: 'channel, message, thread_ts', outputs: 'response, message_ts' },
      { name: 'teams_message', description: 'Post messages or adaptive cards to Microsoft Teams channels.', inputs: 'channel, card_payload', outputs: 'message_id' },
      { name: 'outlook_email', description: 'Send emails via Microsoft Outlook/Exchange.', inputs: 'to, subject, body', outputs: 'message_id, status' },
      { name: 'send_email', description: 'Send emails via configured SMTP provider with template support.', inputs: 'to, subject, body, template', outputs: 'message_id, status' },
      { name: 'pagerduty_incident', description: 'Create, acknowledge, resolve, or escalate PagerDuty incidents.', inputs: 'action, service_id, details', outputs: 'incident_id, status' },
      { name: 'servicenow_ticket', description: 'Create and manage ServiceNow records including incidents, changes, and requests.', inputs: 'table, action, fields', outputs: 'sys_id, number' },
      { name: 'jira_issue', description: 'Create issues, transition statuses, add comments, and search with JQL.', inputs: 'action, project, fields', outputs: 'issue_key, status' },
      { name: 'discord_message', description: 'Send messages to Discord channels via webhook or bot.', inputs: 'channel, message, embed', outputs: 'message_id' },
    ],
  },
  {
    name: 'Control Nodes',
    color: '#f97316',
    description: 'Manage execution flow, approvals, and error recovery.',
    nodes: [
      { name: 'approval', description: 'Pause workflow execution until a designated approver accepts or rejects.', inputs: 'approvers[], message, timeout', outputs: 'decision, approver, timestamp' },
      { name: 'human_approval', description: 'Human-in-the-loop approval gate with notification to reviewers via configured channels.', inputs: 'approvers[], message, timeout', outputs: 'decision, approver, timestamp' },
      { name: 'wait', description: 'Pause execution until a condition is met or a timeout expires. Can wait for webhooks, events, or time.', inputs: 'condition, timeout_ms', outputs: 'trigger_data, timed_out' },
      { name: 'error_handler', description: 'Catch errors from upstream nodes and execute recovery logic. Supports log, retry, notify, and transform actions.', inputs: 'error, node_id', outputs: 'handled, recovery_result' },
      { name: 'user_context', description: 'Access unified cross-mode memory (chat, code, workflow, memories) within a workflow.', inputs: 'context_sources, query, max_tokens', outputs: 'context_data' },
    ],
  },
  {
    name: 'Annotation',
    color: '#94a3b8',
    description: 'Non-functional nodes for documentation and organization.',
    nodes: [
      { name: 'text', description: 'A text annotation node for adding notes and documentation to the workflow canvas.', inputs: 'none', outputs: 'none' },
    ],
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

const NodeTypesPage: React.FC = () => {
  // Source-derived count: the build-time-generated node-types manifest is
  // scanned from the workflow-engine registry (register() list minus the
  // removed-node denylist), so the headline count always matches the release.
  const { loadManifest, loadedManifests } = useDocsStore();
  useEffect(() => {
    if (!loadedManifests.has('node-types')) {
      loadManifest('node-types').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const fallbackTotal = nodeCategories.reduce((sum, cat) => sum + cat.nodes.length, 0);
  const totalNodes = useMemo(() => {
    const m = loadedManifests.get('node-types');
    if (!m) return fallbackTotal;
    return m.sections.reduce((sum, s) => sum + s.items.length, 0);
  }, [loadedManifests, fallbackTotal]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Node Types Reference
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          The workflow engine provides {totalNodes} node types across {nodeCategories.length} categories.
          Each node has typed inputs and outputs that define how data flows through your workflow.
        </p>
      </motion.div>

      {/* Category Index */}
      <motion.div
        custom={1}
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        className="rounded-xl p-5 mb-10 flex flex-wrap gap-3"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {nodeCategories.map((cat) => (
          <a
            key={cat.name}
            href={`#cat-${cat.name.toLowerCase().replace(/\s+/g, '-')}`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: `${cat.color}15`,
              color: cat.color,
              border: `1px solid ${cat.color}30`,
            }}
          >
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
            {cat.name}
            <span className="text-xs opacity-60">{cat.nodes.length}</span>
          </a>
        ))}
      </motion.div>

      {/* Node Categories */}
      {nodeCategories.map((category, catIdx) => (
        <motion.section
          key={category.name}
          id={`cat-${category.name.toLowerCase().replace(/\s+/g, '-')}`}
          custom={catIdx + 2}
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
            <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
              {category.name}
            </h2>
          </div>
          <p className="text-sm mb-4 ml-6" style={{ color: 'var(--color-textSecondary)' }}>
            {category.description}
          </p>
          <div className="space-y-3">
            {category.nodes.map((node) => (
              <div
                key={node.name}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                  {node.name}
                </h3>
                <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                  {node.description}
                </p>
                <div className="flex flex-col sm:flex-row gap-2 text-xs">
                  <div className="flex-1">
                    <span className="font-semibold" style={{ color: 'var(--color-textMuted)' }}>
                      Inputs:{' '}
                    </span>
                    <span className="font-mono" style={{ color: 'var(--color-textSecondary)' }}>
                      {node.inputs}
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold" style={{ color: 'var(--color-textMuted)' }}>
                      Outputs:{' '}
                    </span>
                    <span className="font-mono" style={{ color: 'var(--color-textSecondary)' }}>
                      {node.outputs}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      ))}
    </div>
  );
};

export default NodeTypesPage;
