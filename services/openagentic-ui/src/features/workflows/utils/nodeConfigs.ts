/**
 * Node Type Configurations
 * Defines all available node types for the workflow builder.
 * 21 node types across 7 categories covering triggers, AI/LLM,
 * actions, logic, data, approval, and agent frameworks.
 */
/* eslint-disable no-restricted-syntax -- Node type colors are intentional category indicators */
// theme-allow: this file is the workflow node-TYPE identity color scale — per-node
// `color`, `gradient`, and the port-type color map. These are the categorical/vendor
// identity hues the theme spec explicitly carves out (the "node-TYPE colors → named
// token scale" allowlist item), not themeable app surfaces. Several are vendor brand
// colors (Slack #4a154b, Teams #6264A7, Jira #0052CC, Discord #5865F2, Outlook #0078d4).

import { NodeTypeConfig, PortType, PortDefinition } from '../types/workflow.types';

// Port type system (inspired by LangFlow)
export const portTypeColors: Record<PortType, string> = {
  any: '#94a3b8',       // slate
  message: '#818cf8',   // indigo
  data: '#ef4444',      // red
  json: '#f97316',      // orange
  number: '#22c55e',    // green
  boolean: '#eab308',   // yellow
  text: '#06b6d4',      // cyan
  tool: '#14b8a6',      // teal
  model: '#d946ef',     // fuchsia
  embedding: '#10b981', // emerald
};

export const nodeTypeConfigs: Record<string, NodeTypeConfig> = {
  // ──────────────────────────────────────────────
  // Triggers
  // ──────────────────────────────────────────────

  trigger: {
    type: 'trigger',
    label: 'Trigger',
    description: 'Start workflow execution on an event',
    icon: '\u26A1',
    color: '#f59e0b',
    gradient: 'from-amber-500 to-orange-500',
    category: 'trigger',
    defaultData: {
      label: 'Trigger',
      triggerType: 'manual',
      triggerConfig: {},
    },
    outputs: [{ name: 'output', type: 'data', label: 'Trigger Data' }],
  },

  // ──────────────────────────────────────────────
  // AI / LLM
  // ──────────────────────────────────────────────

  llm_completion: {
    type: 'llm_completion',
    label: 'LLM Completion',
    description: 'Generate text using a language model',
    icon: '\uD83E\uDDE0',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-violet-600',
    category: 'ai',
    defaultData: {
      label: 'LLM',
      temperature: 0.7,
      maxTokens: 2000,
      prompt: '',
      systemPrompt: '',
    },
    inputs: [
      { name: 'prompt', type: 'text', label: 'Prompt', required: true },
      { name: 'context', type: 'data', label: 'Context', required: false },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Response' }],
  },

  a2a: {
    type: 'a2a',
    label: 'Agent-to-Agent',
    description: 'Delegate work to another AI agent via A2A protocol',
    icon: '\uD83E\uDD1D',
    color: '#7c3aed',
    gradient: 'from-violet-500 to-purple-600',
    category: 'ai',
    defaultData: {
      label: 'A2A Agent',
      agentType: 'chat',
      prompt: '{{input.message}}',
      systemPrompt: 'You are a helpful assistant.',
      maxTokens: 4000,
    },
    inputs: [
      { name: 'message', type: 'message', label: 'Message', required: true },
      { name: 'context', type: 'data', label: 'Context', required: false },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Agent Response' }],
  },

  agent_spawn: {
    type: 'agent_spawn',
    label: 'Spawn Agent',
    description: 'Spawn a child agent to handle a subtask autonomously',
    icon: '\uD83D\uDE80',
    color: '#6d28d9',
    gradient: 'from-violet-600 to-indigo-600',
    category: 'ai',
    defaultData: {
      label: 'Spawn Agent',
      prompt: '{{input.message}}',
      maxTokens: 4000,
      agents: [{ role: 'worker', model: 'auto', tools: [] }],
    },
    inputs: [
      { name: 'message', type: 'message', label: 'Task', required: true },
      { name: 'tools', type: 'tool', label: 'Tools', required: false, multiple: true },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Agent Output' }],
  },

  openagentic_llm: {
    type: 'openagentic_llm',
    label: 'OpenAgentic LLM',
    description: 'Use any LLM via OpenAgentic provider routing — auto-selects model based on slider or explicit override',
    icon: '\u2728',
    color: '#8b5cf6',
    gradient: 'from-violet-500 to-purple-600',
    category: 'ai',
    defaultData: {
      label: 'OpenAgentic LLM',
      prompt: '{{input.message}}',
      systemPrompt: '',
      sliderOverride: null,
      modelOverride: null,
      temperature: 0.7,
      maxTokens: 4000,
      enableThinking: true,
      thinkingBudget: 8000,
    },
    inputs: [
      { name: 'prompt', type: 'text', label: 'Prompt', required: true },
      { name: 'context', type: 'data', label: 'Context', required: false },
      { name: 'model', type: 'model', label: 'Model Override', required: false },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Response' }],
  },

  multi_agent: {
    type: 'multi_agent',
    label: 'Multi-Agent Orchestrator',
    description: 'Spawn and manage multiple concurrent agents with shared context and result aggregation',
    icon: '\uD83C\uDFAF',
    color: '#7c3aed',
    gradient: 'from-violet-600 to-indigo-700',
    category: 'ai',
    defaultData: {
      label: 'Multi-Agent',
      maxConcurrency: 5,
      agents: [],
      aggregationStrategy: 'merge',
      sharedContext: true,
      timeoutMs: 120000,
    },
    inputs: [
      { name: 'message', type: 'message', label: 'Task', required: true },
      { name: 'context', type: 'data', label: 'Shared Context', required: false },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Aggregated Result' }],
  },

  // ──────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────

  mcp_tool: {
    type: 'mcp_tool',
    label: 'MCP Tool',
    description: 'Execute an MCP tool from connected servers',
    icon: '\uD83D\uDD27',
    color: '#3b82f6',
    gradient: 'from-blue-500 to-cyan-500',
    category: 'action',
    defaultData: {
      label: 'MCP Tool',
      toolName: '',
      toolServer: '',
      arguments: {},
    },
    inputs: [{ name: 'input', type: 'data', label: 'Tool Input', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Tool Result' }],
  },

  code: {
    type: 'code',
    label: 'Code',
    description: 'Run custom JavaScript/Python code inline',
    icon: '\uD83D\uDCBB',
    color: '#10b981',
    gradient: 'from-emerald-500 to-teal-500',
    category: 'action',
    defaultData: {
      label: 'Code',
      code: '',
      language: 'javascript',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input' }],
    outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  },

  http_request: {
    type: 'http_request',
    label: 'HTTP Request',
    description: 'Make HTTP API calls to external services',
    icon: '\uD83C\uDF10',
    color: '#16A34A',
    gradient: 'from-emerald-500 to-teal-500',
    category: 'action',
    defaultData: {
      label: 'HTTP Request',
      method: 'GET',
      url: '',
      headers: {},
      body: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Request Data' }],
    outputs: [{ name: 'response', type: 'json', label: 'Response' }],
  },

  // ──────────────────────────────────────────────
  // Logic
  // ──────────────────────────────────────────────

  condition: {
    type: 'condition',
    label: 'Condition',
    description: 'Branch workflow based on a condition',
    icon: '\uD83D\uDD00',
    color: '#ec4899',
    gradient: 'from-pink-500 to-rose-500',
    category: 'logic',
    defaultData: {
      label: 'Condition',
      condition: '',
      operator: 'equals',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input' }],
    outputs: [
      { name: 'true', type: 'any', label: 'True' },
      { name: 'false', type: 'any', label: 'False' },
    ],
  },

  loop: {
    type: 'loop',
    label: 'Loop',
    description: 'Iterate over a collection of items',
    icon: '\uD83D\uDD01',
    color: '#06b6d4',
    gradient: 'from-cyan-500 to-blue-500',
    category: 'logic',
    defaultData: {
      label: 'Loop',
    },
    inputs: [{ name: 'items', type: 'data', label: 'Items', required: true }],
    outputs: [
      { name: 'item', type: 'any', label: 'Current Item' },
      { name: 'done', type: 'data', label: 'Loop Complete' },
    ],
  },

  wait: {
    type: 'wait',
    label: 'Wait',
    description: 'Pause execution for a specified duration',
    icon: '\u23F1\uFE0F',
    color: '#6b7280',
    gradient: 'from-gray-500 to-slate-600',
    category: 'logic',
    defaultData: {
      label: 'Wait',
      duration: 1000,
      unit: 'ms',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input' }],
    outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  },

  // ──────────────────────────────────────────────
  // Data
  // ──────────────────────────────────────────────

  transform: {
    type: 'transform',
    label: 'Transform',
    description: 'Transform data with map, filter, or reduce operations',
    icon: '\uD83D\uDD04',
    color: '#f97316',
    gradient: 'from-orange-500 to-red-500',
    category: 'data',
    defaultData: {
      label: 'Transform',
      transformType: 'map',
      transformExpression: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Input Data', required: true }],
    outputs: [{ name: 'output', type: 'data', label: 'Transformed Data' }],
  },

  merge: {
    type: 'merge',
    label: 'Merge',
    description: 'Combine multiple input streams into one',
    icon: '\u26D9',
    color: '#15803d',
    gradient: 'from-green-700 to-emerald-600',
    category: 'data',
    defaultData: {
      label: 'Merge',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input', multiple: true }],
    outputs: [{ name: 'output', type: 'data', label: 'Merged Data' }],
  },

  rag_query: {
    type: 'rag_query',
    label: 'RAG Query',
    description: 'Query Milvus vector database for semantic search over knowledge bases',
    icon: '\uD83D\uDD0D',
    color: '#f97316',
    gradient: 'from-orange-500 to-red-500',
    category: 'data',
    defaultData: {
      label: 'RAG Query',
      collectionName: '',
      queryText: '{{input.message}}',
      topK: 10,
      filters: '{}',
      embeddingModel: 'auto',
    },
    inputs: [{ name: 'input', type: 'text', label: 'Query Text', required: true }],
    outputs: [{ name: 'results', type: 'data', label: 'Search Results' }],
  },

  data_source_query: {
    type: 'data_source_query',
    label: 'Data Source Query',
    description: 'Query a connected data source (SQL, REST, or natural language)',
    icon: 'Database',
    color: 'var(--color-accent)',
    category: 'data',
    defaultData: {
      dataSourceId: '',
      mode: 'raw',
      query: '',
      question: '',
    },
    inputs: [
      { name: 'input', type: 'text', label: 'Input', required: false },
    ],
    outputs: [
      { name: 'rows', type: 'data', label: 'Query Results' },
    ],
  },

  file_upload: {
    type: 'file_upload',
    label: 'File Upload',
    description: 'Upload and ingest files into a knowledge base with chunking and embedding',
    icon: '\uD83D\uDCE4',
    color: '#f97316',
    gradient: 'from-orange-500 to-amber-500',
    category: 'data',
    defaultData: {
      label: 'File Upload',
      collectionName: '',
      fileSource: 'input_data',
      chunkSize: 512,
      chunkOverlap: 50,
      embeddingModel: 'auto',
    },
    inputs: [{ name: 'input', type: 'data', label: 'File Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Ingestion Result' }],
  },

  webhook_response: {
    type: 'webhook_response',
    label: 'Webhook Response',
    description: 'Return data to the original webhook caller with custom status and body',
    icon: '\u21A9\uFE0F',
    color: '#f59e0b',
    gradient: 'from-amber-500 to-orange-500',
    category: 'action',
    defaultData: {
      label: 'Webhook Response',
      statusCode: 200,
      headers: '{}',
      bodyTemplate: '{{input}}',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Response Data', required: true }],
    outputs: [{ name: 'output', type: 'data', label: 'Sent Response' }],
  },

  switch: {
    type: 'switch',
    label: 'Switch',
    description: 'Multi-way branching based on an expression value (beyond true/false)',
    icon: '\uD83D\uDD00',
    color: '#ec4899',
    gradient: 'from-pink-500 to-fuchsia-500',
    category: 'logic',
    defaultData: {
      label: 'Switch',
      expression: '',
      cases: [
        { value: 'case_1', label: 'Case 1' },
        { value: 'default', label: 'Default' },
      ],
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input' }],
    outputs: [
      { name: 'case_1', type: 'any', label: 'Case 1' },
      { name: 'default', type: 'any', label: 'Default' },
    ],
  },

  sub_workflow: {
    type: 'sub_workflow',
    label: 'Sub-Flow',
    description: 'Execute another saved workflow as a step -- enables composition and reuse',
    icon: '\u21BB',
    color: '#8b5cf6',
    gradient: 'from-violet-500 to-purple-500',
    category: 'logic',
    defaultData: {
      label: 'Sub-Flow',
      workflowId: '',
      workflowName: '',
      passInput: true,
      timeout: 120000,
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input Data', required: false }],
    outputs: [{ name: 'output', type: 'any', label: 'Workflow Output' }],
  },

  parallel: {
    type: 'parallel',
    label: 'Parallel',
    description: 'Explicit fan-out / fan-in for parallel execution branches',
    icon: '\uD83D\uDD00',
    color: '#06b6d4',
    gradient: 'from-cyan-500 to-teal-500',
    category: 'logic',
    defaultData: {
      label: 'Parallel',
      mode: 'split',
      waitForAll: true,
      timeoutMs: 60000,
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input', multiple: true }],
    outputs: [{ name: 'output', type: 'data', label: 'Aggregated Output' }],
  },

  reasoning: {
    type: 'reasoning',
    label: 'Reasoning',
    description: 'Extended thinking and chain-of-thought reasoning with configurable budget',
    icon: '\uD83E\uDDE0',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-indigo-600',
    category: 'ai',
    defaultData: {
      label: 'Reasoning',
      prompt: '',
      thinkingBudget: 16384,
      model: 'auto',
      outputFormat: 'text',
    },
    inputs: [
      { name: 'prompt', type: 'text', label: 'Prompt', required: true },
      { name: 'context', type: 'data', label: 'Context', required: false },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Reasoning Output' }],
  },

  // ──────────────────────────────────────────────
  // Approval
  // ──────────────────────────────────────────────

  approval: {
    type: 'approval',
    label: 'Approval Gate',
    description: 'Pause workflow and require approval to continue',
    icon: '\u2705',
    color: '#16a34a',
    gradient: 'from-green-500 to-emerald-600',
    category: 'approval',
    defaultData: {
      label: 'Approval',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Input' }],
    outputs: [
      { name: 'approved', type: 'any', label: 'Approved' },
      { name: 'rejected', type: 'any', label: 'Rejected' },
    ],
  },

  human_approval: {
    type: 'human_approval',
    label: 'Human Approval',
    description: 'Require explicit human review and sign-off before proceeding',
    icon: '\u270B',
    color: '#a16207',
    gradient: 'from-yellow-700 to-amber-700',
    category: 'approval',
    defaultData: {
      label: 'Human Approval',
    },
    inputs: [{ name: 'input', type: 'any', label: 'Review Data' }],
    outputs: [
      { name: 'approved', type: 'any', label: 'Approved' },
      { name: 'rejected', type: 'any', label: 'Rejected' },
    ],
  },

  // ──────────────────────────────────────────────
  // Agents (Framework Orchestration)
  // ──────────────────────────────────────────────

  synth: {
    type: 'synth',
    label: 'Synth',
    description: 'Synthesize outputs from multiple agents into a unified result',
    icon: '\uD83E\uDDEA',
    color: '#d946ef',
    gradient: 'from-fuchsia-500 to-purple-600',
    category: 'agents',
    defaultData: {
      label: 'Synth',
    },
    inputs: [{ name: 'input', type: 'message', label: 'Agent Outputs', multiple: true }],
    outputs: [{ name: 'response', type: 'message', label: 'Synthesized Result' }],
  },

  // ──────────────────────────────────────────────
  // Agent-Proxy Nodes
  // ──────────────────────────────────────────────

  agent_single: {
    type: 'agent_single',
    label: 'Agent',
    description: 'Run a single agent from the registry with its own model and tools',
    icon: '\uD83E\uDD16',
    color: '#6366f1',
    gradient: 'from-indigo-500 to-violet-600',
    category: 'agents',
    defaultData: {
      label: 'Agent',
      agentId: '',
      role: 'custom',
      model: '',
      tools: [],
      maxTurns: 5,
      costBudget: 50,
      timeout: 60000,
    },
    inputs: [
      { name: 'message', type: 'message', label: 'Task', required: true },
      { name: 'tools', type: 'tool', label: 'Tools', required: false, multiple: true },
    ],
    outputs: [{ name: 'response', type: 'message', label: 'Agent Response' }],
  },

  agent_pool: {
    type: 'agent_pool',
    label: 'Agent Pool',
    description: 'Fan-out to multiple agents in parallel, fan-in results with aggregation',
    icon: '\uD83D\uDCAB',
    color: '#4f46e5',
    gradient: 'from-indigo-600 to-blue-600',
    category: 'agents',
    defaultData: {
      label: 'Agent Pool',
      agents: [],
      concurrency: 5,
      aggregation: 'merge',
    },
    inputs: [{ name: 'message', type: 'message', label: 'Task', required: true }],
    outputs: [{ name: 'response', type: 'message', label: 'Aggregated Results' }],
  },

  agent_supervisor: {
    type: 'agent_supervisor',
    label: 'Supervisor',
    description: 'A supervisor agent dynamically picks which worker agents to call',
    icon: '\uD83D\uDC51',
    color: '#7c3aed',
    gradient: 'from-violet-600 to-purple-700',
    category: 'agents',
    defaultData: {
      label: 'Supervisor',
      supervisorModel: '',
      supervisorPrompt: '',
      workers: [],
    },
    inputs: [{ name: 'message', type: 'message', label: 'Task', required: true }],
    outputs: [{ name: 'response', type: 'message', label: 'Supervisor Result' }],
  },

  // ──────────────────────────────────────────────
  // Integrations (Notifications & Ticketing)
  // ──────────────────────────────────────────────

  slack_message: {
    type: 'slack_message',
    label: 'Slack',
    description: 'Send messages, alerts, or workflow results to a Slack channel',
    icon: '\uD83D\uDCAC',
    color: '#4a154b',
    gradient: 'from-purple-900 to-purple-700',
    category: 'integration',
    defaultData: {
      label: 'Slack Message',
      channel: '',
      message: '{{input.message}}',
      webhookUrl: '',
      blocks: [],
    },
    inputs: [{ name: 'input', type: 'data', label: 'Message Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Send Result' }],
  },

  teams_message: {
    type: 'teams_message',
    label: 'MS Teams',
    description: 'Post messages or adaptive cards to a Microsoft Teams channel',
    icon: '\uD83D\uDCE2',
    color: '#6264A7',
    gradient: 'from-indigo-600 to-purple-600',
    category: 'integration',
    defaultData: {
      label: 'Teams Message',
      webhookUrl: '',
      message: '{{input.message}}',
      cardTitle: '',
      cardBody: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Message Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Send Result' }],
  },

  outlook_email: {
    type: 'outlook_email',
    label: 'Outlook / Email',
    description: 'Send email via Outlook or SMTP with rich HTML templates',
    icon: '\u2709\uFE0F',
    color: '#0078d4',
    gradient: 'from-blue-600 to-blue-500',
    category: 'integration',
    defaultData: {
      label: 'Send Email',
      to: '',
      cc: '',
      subject: '',
      body: '{{input.message}}',
      isHtml: true,
      smtpOverride: null,
    },
    inputs: [{ name: 'input', type: 'data', label: 'Email Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Send Result' }],
  },

  send_email: {
    type: 'send_email',
    label: 'SMTP Email',
    description: 'Send email via any SMTP server (Gmail, SendGrid, custom)',
    icon: '\uD83D\uDCE7',
    color: '#ea4335',
    gradient: 'from-red-500 to-orange-500',
    category: 'integration',
    defaultData: {
      label: 'SMTP Email',
      to: '',
      subject: '',
      body: '{{input.message}}',
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPasswordRef: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Email Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Send Result' }],
  },

  pagerduty_incident: {
    type: 'pagerduty_incident',
    label: 'PagerDuty',
    description: 'Create, trigger, or resolve PagerDuty incidents and alerts',
    icon: '\uD83D\uDEA8',
    color: '#06AC38',
    gradient: 'from-green-600 to-green-500',
    category: 'integration',
    defaultData: {
      label: 'PagerDuty',
      action: 'trigger',
      routingKey: '',
      severity: 'error',
      summary: '{{input.message}}',
      source: 'openagentic',
      dedupKey: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Incident Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Incident Result' }],
  },

  servicenow_ticket: {
    type: 'servicenow_ticket',
    label: 'ServiceNow',
    description: 'Create or update ServiceNow incidents, change requests, or tasks',
    icon: '\uD83C\uDF9F\uFE0F',
    color: '#81B5A1',
    gradient: 'from-teal-500 to-emerald-500',
    category: 'integration',
    defaultData: {
      label: 'ServiceNow',
      action: 'create_incident',
      instanceUrl: '',
      table: 'incident',
      fields: {
        short_description: '{{input.message}}',
        urgency: '2',
        impact: '2',
      },
    },
    inputs: [{ name: 'input', type: 'data', label: 'Ticket Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Ticket Result' }],
  },

  jira_issue: {
    type: 'jira_issue',
    label: 'Jira',
    description: 'Create or update Jira issues, transition workflows, add comments',
    icon: '\uD83D\uDCCB',
    color: '#0052CC',
    gradient: 'from-blue-700 to-blue-500',
    category: 'integration',
    defaultData: {
      label: 'Jira Issue',
      action: 'create',
      projectKey: '',
      issueType: 'Task',
      summary: '{{input.message}}',
      description: '',
      priority: 'Medium',
      assignee: '',
    },
    inputs: [{ name: 'input', type: 'data', label: 'Issue Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Issue Result' }],
  },

  discord_message: {
    type: 'discord_message',
    label: 'Discord',
    description: 'Send messages or embeds to a Discord channel via webhook',
    icon: '\uD83C\uDFAE',
    color: '#5865F2',
    gradient: 'from-indigo-500 to-purple-500',
    category: 'integration',
    defaultData: {
      label: 'Discord Message',
      webhookUrl: '',
      content: '{{input.message}}',
      username: 'OpenAgentic',
      embeds: [],
    },
    inputs: [{ name: 'input', type: 'data', label: 'Message Data', required: true }],
    outputs: [{ name: 'result', type: 'data', label: 'Send Result' }],
  },

  // ──────────────────────────────────────────────
  // Error Handling & Context
  // ──────────────────────────────────────────────

  error_handler: {
    type: 'error_handler',
    label: 'Error Handler',
    description: 'Handle errors from upstream nodes — log, retry, notify, or transform errors',
    icon: '\u26A0\uFE0F',
    color: '#ef4444',
    gradient: 'from-red-500 to-rose-600',
    category: 'logic',
    defaultData: {
      label: 'Error Handler',
      errorAction: 'log',
      notificationChannel: '',
      transformExpression: '',
    },
    inputs: [{ name: 'error', type: 'data', label: 'Error', required: true }],
    outputs: [{ name: 'output', type: 'data', label: 'Handled Result' }],
  },

  user_context: {
    type: 'user_context',
    label: 'User Context',
    description: 'Load cross-mode user context from chat, code, workflows, and memories',
    icon: '\uD83E\uDDE0',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-indigo-600',
    category: 'data',
    defaultData: {
      label: 'User Context',
      contextSources: ['chat', 'workflow', 'memory'],
      contextQuery: '{{input.message}}',
      contextMaxTokens: 2000,
    },
    inputs: [{ name: 'query', type: 'text', label: 'Context Query' }],
    outputs: [{ name: 'context', type: 'data', label: 'User Context' }],
  },

  // ──────────────────────────────────────────────
  // Data Pipeline (RAG building blocks)
  // ──────────────────────────────────────────────

  text_splitter: {
    type: 'text_splitter',
    label: 'Text Splitter',
    description: 'Split documents into chunks using recursive, token, or semantic strategies',
    icon: '\u2702',
    color: '#14b8a6',
    gradient: 'from-teal-500 to-emerald-500',
    category: 'data',
    defaultData: {
      label: 'Text Splitter',
      strategy: 'recursive',
      chunkSize: 512,
      chunkOverlap: 50,
      separators: ['\\n\\n', '\\n', '. ', ' '],
    },
    inputs: [
      { name: 'document', type: 'text', label: 'Document Text', required: true },
    ],
    outputs: [{ name: 'chunks', type: 'data', label: 'Chunks' }],
  },

  embedding: {
    type: 'embedding',
    label: 'Embedding',
    description: 'Generate vector embeddings for text using configurable models',
    icon: '\uD83E\uDDF2',
    color: '#8b5cf6',
    gradient: 'from-violet-500 to-purple-600',
    category: 'data',
    defaultData: {
      label: 'Embedding',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 100,
    },
    inputs: [
      { name: 'text', type: 'text', label: 'Text or Chunks', required: true },
    ],
    outputs: [{ name: 'vectors', type: 'embedding', label: 'Vectors' }],
  },

  vector_store: {
    type: 'vector_store',
    label: 'Vector Store',
    description: 'Write, upsert, or delete vectors in Milvus collections',
    icon: '\uD83D\uDDC3',
    color: '#06b6d4',
    gradient: 'from-cyan-500 to-blue-500',
    category: 'data',
    defaultData: {
      label: 'Vector Store',
      operation: 'upsert',
      collection: 'default',
      createIfMissing: true,
    },
    inputs: [
      { name: 'vectors', type: 'embedding', label: 'Vectors', required: true },
      { name: 'metadata', type: 'json', label: 'Metadata', required: false },
    ],
    outputs: [{ name: 'result', type: 'data', label: 'Store Result' }],
  },

  document_loader: {
    type: 'document_loader',
    label: 'Document Loader',
    description: 'Load content from URLs, CSV, JSON, PDF, or plain text sources',
    icon: '\uD83D\uDCC2',
    color: '#f97316',
    gradient: 'from-orange-500 to-amber-500',
    category: 'data',
    defaultData: {
      label: 'Document Loader',
      sourceType: 'url',
      url: '',
      parseMode: 'auto',
      extractText: true,
    },
    inputs: [
      { name: 'source', type: 'text', label: 'Source URL/Path', required: false },
    ],
    outputs: [{ name: 'document', type: 'text', label: 'Document' }],
  },

  structured_output: {
    type: 'structured_output',
    label: 'Structured Output',
    description: 'Enforce JSON schema on LLM output with validation and retry',
    icon: '\uD83D\uDCCB',
    color: '#a855f7',
    gradient: 'from-purple-500 to-fuchsia-500',
    category: 'ai',
    defaultData: {
      label: 'Structured Output',
      model: 'gpt-4.1',
      schema: '{\n  "type": "object",\n  "properties": {}\n}',
      retryOnFail: true,
      maxRetries: 2,
    },
    inputs: [
      { name: 'prompt', type: 'text', label: 'Prompt', required: true },
      { name: 'context', type: 'data', label: 'Context', required: false },
    ],
    outputs: [{ name: 'output', type: 'json', label: 'Structured JSON' }],
  },

  guardrails: {
    type: 'guardrails',
    label: 'Guardrails',
    description: 'Validate inputs or outputs against safety rules, PII detection, and custom checks',
    icon: '\uD83D\uDEE1',
    color: '#ef4444',
    gradient: 'from-red-500 to-rose-600',
    category: 'ai',
    defaultData: {
      label: 'Guardrails',
      checks: ['pii', 'toxicity', 'injection'],
      action: 'block',
      customRules: [],
    },
    inputs: [
      { name: 'content', type: 'text', label: 'Content to Validate', required: true },
    ],
    outputs: [
      { name: 'passed', type: 'data', label: 'Passed' },
      { name: 'blocked', type: 'data', label: 'Blocked' },
    ],
  },

  // ──────────────────────────────────────────────
  // Annotation
  // ──────────────────────────────────────────────

  text: {
    type: 'text' as any,
    label: 'Text Note',
    description: 'Add a text annotation to the canvas to document your flow',
    icon: '\uD83D\uDCDD',
    color: '#94a3b8',
    gradient: 'from-slate-400 to-gray-500',
    category: 'annotation' as any,
    defaultData: {
      label: 'Note',
      text: 'Add your description here...',
      fontSize: 13,
      textColor: '#c9d1d9',
      bgColor: 'transparent',
    },
  },
};

// ──────────────────────────────────────────────
// Node categories for the palette sidebar
// ──────────────────────────────────────────────

export const nodeCategories = {
  trigger: {
    label: 'Triggers',
    description: 'Start workflow execution',
    nodes: ['trigger'],
  },
  ai: {
    label: 'AI / LLM',
    description: 'AI model completions and agent delegation',
    nodes: ['openagentic_llm', 'llm_completion', 'reasoning', 'structured_output', 'guardrails', 'multi_agent', 'a2a', 'agent_spawn'],
  },
  action: {
    label: 'Actions',
    description: 'Execute tools, code, and HTTP calls',
    nodes: ['mcp_tool', 'code', 'http_request', 'webhook_response'],
  },
  logic: {
    label: 'Logic',
    description: 'Control flow, branching, and delays',
    nodes: ['condition', 'switch', 'loop', 'parallel', 'wait', 'error_handler', 'sub_workflow'],
  },
  data: {
    label: 'Data',
    description: 'Transform and combine data',
    nodes: ['document_loader', 'text_splitter', 'embedding', 'vector_store', 'rag_query', 'data_source_query', 'transform', 'merge', 'file_upload', 'user_context'],
  },
  approval: {
    label: 'Approval',
    description: 'Human-in-the-loop approval gates',
    nodes: ['approval', 'human_approval'],
  },
  agents: {
    label: 'Agents',
    description: 'Multi-agent framework orchestration',
    nodes: ['synth', 'agent_single', 'agent_pool', 'agent_supervisor'],
  },
  integration: {
    label: 'Integrations',
    description: 'Send results to Slack, Teams, PagerDuty, Jira, email, and more',
    nodes: ['slack_message', 'teams_message', 'outlook_email', 'send_email', 'pagerduty_incident', 'servicenow_ticket', 'jira_issue', 'discord_message'],
  },
  annotation: {
    label: 'Annotation',
    description: 'Canvas annotations and documentation',
    nodes: ['text'],
  },
};
