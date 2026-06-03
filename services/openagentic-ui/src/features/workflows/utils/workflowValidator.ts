/**
 * Client-side workflow validator
 * Checks all nodes have required configuration before execution.
 * Mirrors the backend WorkflowCompiler.validateRuntime() checks
 * but runs instantly in the browser for immediate feedback.
 */

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId: string;
  field?: string;       // The specific field that's missing/invalid
  severity: 'error' | 'warning';
  category: 'config' | 'credential' | 'connection' | 'data';
}

export interface NodeValidationResult {
  nodeId: string;
  valid: boolean;
  issues: ValidationIssue[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  nodeResults: Map<string, NodeValidationResult>;
  issues: ValidationIssue[];
  summary: {
    totalNodes: number;
    validNodes: number;
    invalidNodes: number;
    errorCount: number;
    warningCount: number;
  };
}

/** Required fields per node type — matches what the execution engine needs */
const NODE_REQUIRED_FIELDS: Record<string, Array<{
  field: string;
  label: string;
  check: (data: Record<string, any>) => boolean;
  category: ValidationIssue['category'];
}>> = {
  llm_completion: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
  ],
  bedrock: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
    { field: 'region', label: 'AWS Region', check: d => !!(d.awsRegion || d.region), category: 'credential' },
  ],
  vertex: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
    { field: 'projectId', label: 'GCP Project ID', check: d => !!(d.projectId || d.project), category: 'credential' },
  ],
  azure_ai: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
    { field: 'deploymentName', label: 'Azure Deployment', check: d => !!(d.deploymentName || d.deployment), category: 'credential' },
  ],
  openagentic_llm: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
  ],
  openagentic_chat: [
    { field: 'prompt', label: 'User Prompt', check: d => !!d.prompt?.trim(), category: 'config' },
  ],
  mcp_tool: [
    { field: 'toolName', label: 'Tool Name', check: d => !!d.toolName, category: 'config' },
    { field: 'toolServer', label: 'MCP Server', check: d => !!d.toolServer, category: 'config' },
  ],
  http_request: [
    { field: 'url', label: 'URL', check: d => !!d.url?.trim(), category: 'config' },
    { field: 'method', label: 'HTTP Method', check: d => !!d.method, category: 'config' },
  ],
  condition: [
    { field: 'condition', label: 'Condition Expression', check: d => !!(d.condition || d.expression), category: 'config' },
  ],
  code: [
    { field: 'code', label: 'Code', check: d => !!d.code?.trim(), category: 'config' },
  ],
  transform: [
    // Two shapes are valid per workflow-engine src/nodes/transform/executor.ts:
    //   - modern: `operations[]` array of {op,target,value,...} (priority shape,
    //     used by every shipped template)
    //   - legacy: `transformType` ('map'|'filter'|'reduce'|'extract') + expression
    // The validator MUST accept either. Pre-2026-05-14 it only checked
    // `transformType`, which surfaced as a false "1 field required" on every
    // template transform node and a "N Errors" toolbar pill on every flow.
    {
      field: 'transformType',
      label: 'Transform Type or Operations',
      check: d => !!(d.transformType) || (Array.isArray(d.operations) && d.operations.length > 0),
      category: 'config',
    },
  ],
  data_query: [
    { field: 'collection', label: 'Collection', check: d => !!(d.collection || d.collectionName), category: 'config' },
  ],
  loop: [
    { field: 'maxIterations', label: 'Max Iterations', check: d => !!(d.maxIterations || d.max_iterations), category: 'config' },
  ],
  agent_single: [
    { field: 'prompt', label: 'Task/Prompt', check: d => !!(d.prompt || d.task), category: 'config' },
  ],
  agent_supervisor: [
    { field: 'agents', label: 'Sub-Agents', check: d => Array.isArray(d.agents) && d.agents.length > 0, category: 'config' },
    { field: 'goal', label: 'Goal/Task', check: d => !!(d.goal || d.prompt || d.task), category: 'config' },
  ],
  agent_pool: [
    { field: 'agents', label: 'Agents', check: d => Array.isArray(d.agents) && d.agents.length > 0, category: 'config' },
  ],
  multi_agent: [
    { field: 'agents', label: 'Agents', check: d => Array.isArray(d.agents) && d.agents.length > 0, category: 'config' },
  ],
  agent_spawn: [
    { field: 'agents', label: 'Agents', check: d => Array.isArray(d.agents) && d.agents.length > 0, category: 'config' },
  ],
  approval: [
    { field: 'approvers', label: 'Approvers', check: d => !!(d.approvers || d.approverRole || d.notifyChannel), category: 'config' },
  ],
  human_approval: [
    { field: 'approvers', label: 'Approvers', check: d => !!(d.approvers || d.approverRole || d.notifyChannel), category: 'config' },
  ],
  // Data pipeline nodes
  text_splitter: [
    { field: 'strategy', label: 'Splitting Strategy', check: d => !!(d.strategy), category: 'config' },
  ],
  embedding: [
    { field: 'model', label: 'Embedding Model', check: d => !!(d.model), category: 'config' },
  ],
  vector_store: [
    { field: 'collection', label: 'Collection Name', check: d => !!(d.collection), category: 'config' },
    { field: 'operation', label: 'Operation (upsert/delete)', check: d => !!(d.operation), category: 'config' },
  ],
  document_loader: [
    { field: 'sourceType', label: 'Source Type', check: d => !!(d.sourceType), category: 'config' },
  ],
  structured_output: [
    { field: 'schema', label: 'JSON Schema', check: d => !!(d.schema && d.schema !== '{}'), category: 'config' },
  ],
  guardrails: [
    { field: 'checks', label: 'Safety Checks', check: d => Array.isArray(d.checks) && d.checks.length > 0, category: 'config' },
  ],
  // Integration nodes
  slack_message: [
    { field: 'webhook', label: 'Webhook URL or Channel', check: d => !!(d.webhookUrl || d.channel), category: 'config' },
  ],
  teams_message: [
    { field: 'webhookUrl', label: 'Webhook URL', check: d => !!(d.webhookUrl), category: 'config' },
  ],
  rag_query: [
    { field: 'collection', label: 'Collection', check: d => !!(d.collection), category: 'config' },
  ],
  reasoning: [
    { field: 'prompt', label: 'Prompt', check: d => !!(d.prompt), category: 'config' },
  ],
  // Agent-to-Agent
  a2a: [
    { field: 'prompt', label: 'Prompt', check: d => !!(d.prompt?.trim()), category: 'config' },
  ],
  // Logic nodes
  switch: [
    { field: 'expression', label: 'Switch Expression', check: d => !!(d.expression?.trim()), category: 'config' },
    { field: 'cases', label: 'Cases', check: d => Array.isArray(d.cases) && d.cases.length > 0, category: 'config' },
  ],
  parallel: [
    // parallel node just needs connections, no required fields beyond mode
  ],
  wait: [
    { field: 'duration', label: 'Duration', check: d => !!(d.duration && Number(d.duration) > 0), category: 'config' },
  ],
  error_handler: [
    { field: 'errorAction', label: 'Error Action', check: d => !!(d.errorAction), category: 'config' },
  ],
  // Data nodes with no strict required fields (passthrough behavior)
  merge: [],
  file_upload: [
    { field: 'collectionName', label: 'Collection', check: d => !!(d.collectionName || d.collection), category: 'config' },
  ],
  user_context: [],
  webhook_response: [],
  knowledge_ingest: [
    { field: 'collection', label: 'Collection', check: d => !!(d.collection || d.collectionName), category: 'config' },
  ],
  // Email / Integration nodes
  outlook_email: [
    { field: 'to', label: 'To Address', check: d => !!(d.to?.trim()), category: 'config' },
    { field: 'subject', label: 'Subject', check: d => !!(d.subject?.trim()), category: 'config' },
  ],
  send_email: [
    { field: 'to', label: 'To Address', check: d => !!(d.to?.trim()), category: 'config' },
    { field: 'subject', label: 'Subject', check: d => !!(d.subject?.trim()), category: 'config' },
    { field: 'smtpHost', label: 'SMTP Host', check: d => !!(d.smtpHost?.trim()), category: 'credential' },
  ],
  pagerduty_incident: [
    { field: 'routingKey', label: 'Routing Key', check: d => !!(d.routingKey?.trim()), category: 'credential' },
    { field: 'summary', label: 'Summary', check: d => !!(d.summary?.trim()), category: 'config' },
  ],
  servicenow_ticket: [
    { field: 'instanceUrl', label: 'Instance URL', check: d => !!(d.instanceUrl?.trim()), category: 'credential' },
  ],
  jira_issue: [
    { field: 'projectKey', label: 'Project Key', check: d => !!(d.projectKey?.trim()), category: 'config' },
    { field: 'summary', label: 'Summary', check: d => !!(d.summary?.trim()), category: 'config' },
  ],
  discord_message: [
    { field: 'webhookUrl', label: 'Webhook URL', check: d => !!(d.webhookUrl?.trim()), category: 'config' },
  ],
  sub_workflow: [
    { field: 'workflowId', label: 'Workflow', check: d => !!(d.workflowId?.trim()), category: 'config' },
  ],

  // Typed output-parser primitives (gap-analysis 2026-05-14 P0 #4).
  // Mirror the API-side VALID_NODE_TYPES required-field validators in
  // services/openagentic-api/src/services/WorkflowCompiler.ts so the UI
  // and the engine agree on what counts as configured. Without these, the
  // toolbar pre-flight reports nothing on misconfigured typed nodes —
  // users discover the failure only at runtime.
  filter_data: [
    { field: 'operator', label: 'Operator', check: d => !!d.operator, category: 'config' },
    { field: 'field', label: 'Field (dot-path)', check: d => d.operator === 'exists' || !!d.field, category: 'config' },
  ],
  select_data: [
    { field: 'fields', label: 'Fields to keep', check: d => Array.isArray(d.fields) && d.fields.length > 0, category: 'config' },
  ],
  extract_key: [
    { field: 'path', label: 'Path (dot-path)', check: d => typeof d.path === 'string' && d.path.length > 0, category: 'config' },
  ],
  // parse_json has no strictly required fields — input + onError both have
  // engine defaults. Validator stays permissive to mirror the executor.
  parse_json: [],
  regex: [
    { field: 'pattern', label: 'Pattern', check: d => !!d.pattern, category: 'config' },
    { field: 'mode', label: 'Mode (match | replace | test)', check: d => !!d.mode, category: 'config' },
  ],

  // P0 primitives shipped 2026-05-14: prompt_template, conversation_memory, flow_tool.
  prompt_template: [
    { field: 'template', label: 'Template body', check: d => typeof d.template === 'string' && d.template.trim().length > 0, category: 'config' },
  ],
  conversation_memory: [
    { field: 'memoryId', label: 'Memory ID', check: d => typeof d.memoryId === 'string' && d.memoryId.trim().length > 0, category: 'config' },
    { field: 'operation', label: 'Operation', check: d => ['read', 'write', 'clear', 'summarize', 'search'].includes(d.operation), category: 'config' },
    { field: 'query', label: 'Query (search only)', check: d => d.operation !== 'search' || (typeof d.query === 'string' && d.query.trim().length > 0), category: 'config' },
  ],
  flow_tool: [
    { field: 'flowId', label: 'Flow ID', check: d => typeof d.flowId === 'string' && d.flowId.trim().length > 0, category: 'config' },
  ],

  // P1 #3 (2026-05-14): wait_for primitive — poll-until-condition. Sister
  // to the existing `wait` (fixed-duration) primitive.
  wait_for: [
    { field: 'condition', label: 'Condition', check: d => typeof d.condition === 'string' && d.condition.trim().length > 0, category: 'config' },
  ],

  // P1 #9 (2026-05-14): rate_limiter primitive — fixed-window throttle.
  rate_limiter: [
    { field: 'key', label: 'Bucket key', check: d => typeof d.key === 'string' && d.key.trim().length > 0, category: 'config' },
  ],

  // P1 #6 (2026-05-14): csv_processor primitive — text-mode CSV parsing.
  csv_processor: [
    { field: 'csv', label: 'CSV text', check: d => typeof d.csv === 'string' && d.csv.trim().length > 0, category: 'config' },
  ],
};

/** Get the list of required fields for a node type */
export function getRequiredFields(nodeType: string): Array<{ field: string; label: string }> {
  return (NODE_REQUIRED_FIELDS[nodeType] || []).map(f => ({ field: f.field, label: f.label }));
}

/** Check if a specific field is required for a node type */
export function isFieldRequired(nodeType: string, fieldName: string): boolean {
  return (NODE_REQUIRED_FIELDS[nodeType] || []).some(f => f.field === fieldName);
}

/** Validate a single node */
export function validateNode(
  nodeId: string,
  nodeType: string,
  data: Record<string, any>,
  edges: Array<{ source: string; target: string }>,
  allNodes: Array<{ id: string; type: string; data: Record<string, any> }>
): NodeValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeLabel = data?.label || nodeId;

  // 1. Check required fields
  const requiredFields = NODE_REQUIRED_FIELDS[nodeType] || [];
  for (const field of requiredFields) {
    if (!field.check(data || {})) {
      issues.push({
        code: `MISSING_${field.field.toUpperCase()}`,
        message: `"${nodeLabel}" requires ${field.label}`,
        nodeId,
        field: field.field,
        severity: 'error',
        category: field.category,
      });
    }
  }

  // 2. Check URL validity for HTTP nodes
  if (nodeType === 'http_request' && data?.url) {
    if (!/^https?:\/\//.test(data.url) && !data.url.startsWith('{{')) {
      issues.push({
        code: 'INVALID_URL',
        message: `"${nodeLabel}" URL must start with http:// or https://`,
        nodeId,
        field: 'url',
        severity: 'error',
        category: 'config',
      });
    }
  }

  // 3. Check hardcoded credentials in headers
  if (nodeType === 'http_request' && data?.headers) {
    const headersStr = typeof data.headers === 'string' ? data.headers : JSON.stringify(data.headers);
    if (/authorization|api[_-]?key|bearer/i.test(headersStr) && !headersStr.includes('{{secret:') && !headersStr.includes('{{env.')) {
      issues.push({
        code: 'HARDCODED_CREDENTIAL',
        message: `"${nodeLabel}" may have hardcoded credentials — use {{secret:name}}`,
        nodeId,
        severity: 'warning',
        category: 'credential',
      });
    }
  }

  // 4. Check condition nodes have both output paths
  if (nodeType === 'condition') {
    const outEdges = edges.filter(e => e.source === nodeId);
    if ((data?.condition || data?.expression) && outEdges.length < 2) {
      issues.push({
        code: 'INCOMPLETE_CONDITION',
        message: `"${nodeLabel}" should have both true and false output paths`,
        nodeId,
        severity: 'warning',
        category: 'connection',
      });
    }
  }

  // 5. Check trigger configuration
  if (nodeType === 'trigger') {
    const triggerType = data?.triggerType || data?.trigger_type;
    if (triggerType === 'webhook' && !data?.webhookPath && !data?.path) {
      issues.push({
        code: 'NO_WEBHOOK_PATH',
        message: `"${nodeLabel}" webhook needs a path configured`,
        nodeId,
        field: 'webhookPath',
        severity: 'warning',
        category: 'config',
      });
    }
    if ((triggerType === 'schedule' || triggerType === 'cron') && !data?.schedule && !data?.cron) {
      issues.push({
        code: 'NO_SCHEDULE',
        message: `"${nodeLabel}" schedule needs a cron expression`,
        nodeId,
        field: 'schedule',
        severity: 'warning',
        category: 'config',
      });
    }
  }

  // 6. Check code syntax for code/openagentic nodes (parse-only, no execution)
  // This is intentional syntax validation for user-authored workflow code
  // eslint-disable-next-line no-new-func
  if (nodeType === 'code' && data?.code) {
    try {
      Function('input', data.code);
    } catch (e: any) {
      issues.push({
        code: 'INVALID_CODE_SYNTAX',
        message: `"${nodeLabel}" has a syntax error: ${e.message}`,
        nodeId,
        field: 'code',
        severity: 'error',
        category: 'config',
      });
    }
  }

  // 6b. Check condition expression syntax (parse-only, no execution)
  // eslint-disable-next-line no-new-func
  if (nodeType === 'condition' && (data?.condition || data?.expression)) {
    try {
      // (#1266/#1270) Rewrite each {{...}} token to a placeholder identifier
      // BEFORE the Function() parse-check, mirroring the runtime __cvN
      // substitution (condition executor binds each ref to a named global). The
      // raw `{{...}}` is NOT valid JS, so feeding it to Function() threw
      // "Unexpected token '{'" and surfaced a bogus blocking INVALID_CONDITION
      // on every template that branches on upstream data.
      const rawExpr = String(data.condition || data.expression);
      const parseSafeExpr = rawExpr.replace(/\{\{[^}]+\}\}/g, '__cv');
      Function('input', `return (${parseSafeExpr})`);
    } catch (e: any) {
      issues.push({
        code: 'INVALID_CONDITION',
        message: `"${nodeLabel}" condition has a syntax error: ${e.message}`,
        nodeId,
        field: 'condition',
        severity: 'error',
        category: 'config',
      });
    }
  }

  // 7. Check for unresolved secret references (just flag them for awareness)
  const nodeStr = JSON.stringify(data || {});
  const secretMatches = nodeStr.match(/\{\{secret:([^}]+)\}\}/g);
  if (secretMatches) {
    for (const match of secretMatches) {
      const secretName = match.replace('{{secret:', '').replace('}}', '');
      issues.push({
        code: 'USES_SECRET',
        message: `"${nodeLabel}" uses secret "${secretName}" — verify it exists in Credentials`,
        nodeId,
        severity: 'warning',
        category: 'credential',
      });
    }
  }

  return {
    nodeId,
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
  };
}

/** Validate an entire workflow */
export function validateWorkflow(
  nodes: Array<{ id: string; type: string; data: Record<string, any> }>,
  edges: Array<{ id: string; source: string; target: string }>
): WorkflowValidationResult {
  const allIssues: ValidationIssue[] = [];
  const nodeResults = new Map<string, NodeValidationResult>();

  // Validate each node
  for (const node of nodes) {
    const result = validateNode(node.id, node.type, node.data, edges, nodes);
    nodeResults.set(node.id, result);
    allIssues.push(...result.issues);
  }

  // Check for disconnected nodes (no edges)
  if (nodes.length > 1) {
    const connectedNodes = new Set<string>();
    for (const edge of edges) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }
    for (const node of nodes) {
      if (node.type === 'text') continue; // Annotations don't need connections
      if (!connectedNodes.has(node.id)) {
        const issue: ValidationIssue = {
          code: 'DISCONNECTED',
          message: `"${node.data?.label || node.id}" is not connected to any other node`,
          nodeId: node.id,
          severity: 'warning',
          category: 'connection',
        };
        allIssues.push(issue);
        const existing = nodeResults.get(node.id);
        if (existing) existing.issues.push(issue);
      }
    }
  }

  // Check no trigger node
  const hasTrigger = nodes.some(n => n.type === 'trigger');
  if (nodes.length > 0 && !hasTrigger) {
    allIssues.push({
      code: 'NO_TRIGGER',
      message: 'Workflow has no trigger node — execution will start from the first node',
      nodeId: '',
      severity: 'warning',
      category: 'connection',
    });
  }

  // Check nodes with no incoming edges (except trigger)
  const nodesWithIncoming = new Set<string>();
  for (const edge of edges) nodesWithIncoming.add(edge.target);
  for (const node of nodes) {
    if (node.type === 'trigger' || node.type === 'text') continue;
    if (!nodesWithIncoming.has(node.id)) {
      const label = node.data?.label || node.id;
      const issue: ValidationIssue = {
        code: 'NO_INPUT',
        message: `"${label}" has no incoming connection — it won't receive data`,
        nodeId: node.id,
        severity: 'warning',
        category: 'connection',
      };
      allIssues.push(issue);
      const existing = nodeResults.get(node.id);
      if (existing) existing.issues.push(issue);
    }
  }

  const errorCount = allIssues.filter(i => i.severity === 'error').length;
  const warningCount = allIssues.filter(i => i.severity === 'warning').length;
  const invalidNodes = Array.from(nodeResults.values()).filter(r => !r.valid).length;

  return {
    valid: errorCount === 0,
    nodeResults,
    issues: allIssues,
    summary: {
      totalNodes: nodes.length,
      validNodes: nodes.length - invalidNodes,
      invalidNodes,
      errorCount,
      warningCount,
    },
  };
}
