/**
 * WorkflowCompiler
 *
 * Validates and compiles workflow definitions before execution.
 * Performs: cycle detection, topological sort, type validation, edge consistency checks.
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from './WorkflowExecutionEngine.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

export interface CompilationResult {
  valid: boolean;
  errors: CompilationError[];
  warnings: CompilationWarning[];
  executionOrder: string[]; // Topologically sorted node IDs
  metadata: {
    nodeCount: number;
    edgeCount: number;
    hasCycles: boolean;
    unreachableNodes: string[];
    terminalNodes: string[];
    triggerNodes: string[];
  };
}

export interface CompilationError {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface CompilationWarning {
  code: string;
  message: string;
  nodeId?: string;
}

const VALID_NODE_TYPES = new Set([
  'trigger', 'llm_completion', 'mcp_tool', 'code', 'condition', 'loop',
  'transform', 'merge', 'approval', 'human_approval', 'wait',
  'agent_spawn', 'a2a', 'http_request', 'multi_agent',
  'agent_single', 'agent_pool', 'agent_supervisor',
  'synth_synthesize', 'synth', 'oat_synthesize', 'oat',
  'bedrock', 'vertex', 'azure_ai', 'openagentic',
  'openagentic_llm', 'openagentic_chat', 'data_query', 'reasoning',
  'slack_message', 'teams_message', 'outlook_email', 'send_email',
  'pagerduty_incident', 'servicenow_ticket', 'jira_issue', 'discord_message',
  'rag_query', 'knowledge_ingest', 'file_upload', 'webhook_response', 'switch', 'parallel', 'data_source_query',
  'error_handler', 'user_context', 'text',
  'text_splitter', 'embedding', 'vector_store', 'document_loader', 'structured_output', 'guardrails',
  'sub_workflow',
]);

export class WorkflowCompiler {
  /**
   * Compile and validate a workflow definition.
   * Returns errors if the workflow is invalid, plus a topologically sorted execution order.
   */
  compile(definition: WorkflowDefinition): CompilationResult {
    const errors: CompilationError[] = [];
    const warnings: CompilationWarning[] = [];

    // 1. Basic structure validation
    if (!definition.nodes || definition.nodes.length === 0) {
      errors.push({ code: 'EMPTY_WORKFLOW', message: 'Workflow has no nodes' });
      return this.buildResult(false, errors, warnings, [], definition);
    }

    // 2. Node validation
    const nodeIds = new Set<string>();
    for (const node of definition.nodes) {
      if (!node.id) {
        errors.push({ code: 'MISSING_NODE_ID', message: 'Node is missing an ID' });
        continue;
      }
      if (nodeIds.has(node.id)) {
        errors.push({ code: 'DUPLICATE_NODE_ID', message: `Duplicate node ID: ${node.id}`, nodeId: node.id });
      }
      nodeIds.add(node.id);

      if (!VALID_NODE_TYPES.has(node.type)) {
        errors.push({ code: 'UNKNOWN_NODE_TYPE', message: `Unknown node type: ${node.type}`, nodeId: node.id });
      }

      // Type-specific validation
      this.validateNodeData(node, errors, warnings);
    }

    // 3. Edge validation
    const edgeIds = new Set<string>();
    for (const edge of definition.edges) {
      if (edgeIds.has(edge.id)) {
        errors.push({ code: 'DUPLICATE_EDGE_ID', message: `Duplicate edge ID: ${edge.id}`, edgeId: edge.id });
      }
      edgeIds.add(edge.id);

      if (!nodeIds.has(edge.source)) {
        errors.push({ code: 'DANGLING_EDGE_SOURCE', message: `Edge ${edge.id} references nonexistent source node: ${edge.source}`, edgeId: edge.id });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({ code: 'DANGLING_EDGE_TARGET', message: `Edge ${edge.id} references nonexistent target node: ${edge.target}`, edgeId: edge.id });
      }
    }

    // 4. Cycle detection
    const hasCycles = this.detectCycles(definition.nodes, definition.edges);
    if (hasCycles) {
      errors.push({ code: 'CYCLE_DETECTED', message: 'Workflow contains a cycle. Use loop nodes for iterative logic.' });
    }

    // 5. Topological sort (only if no cycles)
    let executionOrder: string[] = [];
    if (!hasCycles) {
      executionOrder = this.topologicalSort(definition.nodes, definition.edges);
    }

    // 6. Unreachable node detection
    const triggerNodes = definition.nodes.filter(n => n.type === 'trigger').map(n => n.id);
    const reachable = this.findReachableNodes(triggerNodes.length > 0 ? triggerNodes : [definition.nodes[0].id], definition.edges);
    const unreachableNodes = definition.nodes.filter(n => !reachable.has(n.id)).map(n => n.id);

    if (unreachableNodes.length > 0) {
      for (const nodeId of unreachableNodes) {
        warnings.push({ code: 'UNREACHABLE_NODE', message: `Node ${nodeId} is not reachable from any trigger`, nodeId });
      }
    }

    // 7. Terminal node check
    const outDegree = new Map<string, number>();
    for (const node of definition.nodes) outDegree.set(node.id, 0);
    for (const edge of definition.edges) {
      outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
    }
    const terminalNodes = definition.nodes.filter(n => (outDegree.get(n.id) || 0) === 0).map(n => n.id);

    if (triggerNodes.length === 0) {
      warnings.push({ code: 'NO_TRIGGER', message: 'Workflow has no trigger node. Execution will start from the first node.' });
    }

    const valid = errors.length === 0;

    logger.info({
      valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      nodeCount: definition.nodes.length,
      edgeCount: definition.edges.length,
      hasCycles
    }, '[WorkflowCompiler] Compilation complete');

    return this.buildResult(valid, errors, warnings, executionOrder, definition, {
      hasCycles,
      unreachableNodes,
      terminalNodes,
      triggerNodes
    });
  }

  private validateNodeData(node: WorkflowNode, errors: CompilationError[], warnings: CompilationWarning[]): void {
    switch (node.type) {
      case 'llm_completion':
      case 'bedrock':
      case 'vertex':
      case 'azure_ai':
        if (!node.data.prompt) {
          errors.push({ code: 'MISSING_PROMPT', message: `${node.type} node requires a prompt`, nodeId: node.id });
        }
        break;
      case 'mcp_tool':
        if (!node.data.toolName) {
          errors.push({ code: 'MISSING_TOOL_NAME', message: 'MCP tool node requires a toolName', nodeId: node.id });
        }
        break;
      case 'code':
      case 'openagentic':
        if (!node.data.code) {
          errors.push({ code: 'MISSING_CODE', message: `${node.type} node requires code`, nodeId: node.id });
        }
        break;
      case 'http_request':
        if (!node.data.url) {
          errors.push({ code: 'MISSING_URL', message: 'HTTP request node requires a URL', nodeId: node.id });
        }
        break;
      case 'condition':
        if (!node.data.condition && !node.data.expression) {
          warnings.push({ code: 'MISSING_CONDITION', message: 'Condition node has no condition expression', nodeId: node.id });
        }
        break;
      case 'openagentic_llm':
      case 'openagentic_chat':
        if (!node.data.prompt) {
          errors.push({ code: 'MISSING_PROMPT', message: `${node.type} node requires a prompt`, nodeId: node.id });
        }
        break;
      case 'multi_agent':
        if (!node.data.agents || !Array.isArray(node.data.agents) || node.data.agents.length === 0) {
          errors.push({ code: 'MISSING_AGENTS', message: `${node.type} node requires a non-empty agents array`, nodeId: node.id });
        }
        break;
      case 'agent_spawn':
        if (!node.data.task && !node.data.taskDescription) {
          errors.push({ code: 'MISSING_TASK', message: `${node.type} node requires a task description`, nodeId: node.id });
        }
        break;
      case 'synth':
      case 'oat':
      case 'synth_synthesize':
      case 'oat_synthesize':
        if (!node.data.intent) {
          errors.push({ code: 'MISSING_INTENT', message: `${node.type} node requires an intent`, nodeId: node.id });
        }
        break;
    }
  }

  /**
   * Detect cycles using DFS with coloring (white/gray/black)
   */
  private detectCycles(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) adjacency.set(node.id, []);
    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const node of nodes) color.set(node.id, WHITE);

    const dfs = (nodeId: string): boolean => {
      color.set(nodeId, GRAY);
      for (const neighbor of adjacency.get(nodeId) || []) {
        if (color.get(neighbor) === GRAY) return true; // Back edge = cycle
        if (color.get(neighbor) === WHITE && dfs(neighbor)) return true;
      }
      color.set(nodeId, BLACK);
      return false;
    };

    for (const node of nodes) {
      if (color.get(node.id) === WHITE && dfs(node.id)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Kahn's algorithm for topological sort
   */
  private topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return order;
  }

  /**
   * BFS to find all reachable nodes from a set of start nodes
   */
  private findReachableNodes(startNodes: string[], edges: WorkflowEdge[]): Set<string> {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      adjacency.get(edge.source)!.push(edge.target);
    }

    const visited = new Set<string>();
    const queue = [...startNodes];
    for (const s of startNodes) visited.add(s);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return visited;
  }

  /**
   * Runtime readiness validation: checks that all external dependencies
   * (secrets, LLM providers, MCP tools, HTTP endpoints) are available.
   * Call this before execution to give the user actionable error messages.
   */
  async validateRuntime(
    definition: WorkflowDefinition,
    options?: {
      mcpToolList?: string[];
      availableModels?: string[];
      workflowId?: string;
      availableProviders?: string[];
      mcpToolSchemas?: Record<string, { inputSchema?: { required?: string[] } }>;
    }
  ): Promise<{ ready: boolean; issues: CompilationWarning[] }> {
    const issues: CompilationWarning[] = [];

    // Build node lookup and adjacency for data-flow checks
    const nodeMap = new Map<string, typeof definition.nodes[0]>();
    const incomingEdges = new Map<string, string[]>();
    for (const node of definition.nodes) {
      nodeMap.set(node.id, node);
      incomingEdges.set(node.id, []);
    }
    for (const edge of definition.edges) {
      incomingEdges.get(edge.target)?.push(edge.source);
    }

    for (const node of definition.nodes) {
      const nodeLabel = node.data?.label || node.id;
      const d = node.data || {};

      // --- LLM nodes: check model, prompt, and provider credentials ---
      if (['llm_completion', 'bedrock', 'vertex', 'azure_ai', 'openagentic_llm', 'openagentic_chat'].includes(node.type)) {
        if (!d.prompt || d.prompt.trim().length === 0) {
          issues.push({ code: 'EMPTY_PROMPT', message: `"${nodeLabel}" has an empty prompt`, nodeId: node.id });
        }
        const model = d.model;
        if (model && model !== 'auto' && model !== 'model-router' && options?.availableModels) {
          if (!options.availableModels.includes(model)) {
            issues.push({ code: 'MODEL_UNAVAILABLE', message: `"${nodeLabel}" uses model "${model}" which is not available`, nodeId: node.id });
          }
        }

        // Provider-specific credential checks
        if (node.type === 'bedrock') {
          if (!d.awsRegion && !d.region) {
            issues.push({ code: 'MISSING_CREDENTIAL', message: `"${nodeLabel}" has no AWS region configured`, nodeId: node.id });
          }
        }
        if (node.type === 'vertex') {
          if (!d.projectId && !d.project) {
            issues.push({ code: 'MISSING_CREDENTIAL', message: `"${nodeLabel}" has no GCP project ID configured`, nodeId: node.id });
          }
        }
        if (node.type === 'azure_ai') {
          if (!d.deploymentName && !d.deployment) {
            issues.push({ code: 'MISSING_CREDENTIAL', message: `"${nodeLabel}" has no Azure deployment name configured`, nodeId: node.id });
          }
        }
      }

      // --- MCP tool nodes: check tool exists and required params ---
      if (node.type === 'mcp_tool') {
        if (!d.toolName) {
          issues.push({ code: 'NO_TOOL_SELECTED', message: `"${nodeLabel}" has no tool selected`, nodeId: node.id });
        } else if (options?.mcpToolList) {
          if (!options.mcpToolList.includes(d.toolName)) {
            issues.push({ code: 'TOOL_NOT_FOUND', message: `"${nodeLabel}" uses tool "${d.toolName}" which is not available`, nodeId: node.id });
          }
          // Check required tool parameters
          if (options?.mcpToolSchemas?.[d.toolName]) {
            const schema = options.mcpToolSchemas[d.toolName];
            const required = schema.inputSchema?.required || [];
            const providedParams = Object.keys(d.toolParams || d.params || d.arguments || {});
            for (const reqParam of required) {
              // Allow if it's a template variable reference (will be resolved at runtime)
              const paramVal = (d.toolParams || d.params || d.arguments || {})[reqParam];
              if (!paramVal && paramVal !== 0 && paramVal !== false) {
                // Check if the node has incoming data that might supply it
                const hasIncoming = (incomingEdges.get(node.id) || []).length > 0;
                if (!hasIncoming) {
                  issues.push({ code: 'MISSING_TOOL_PARAM', message: `"${nodeLabel}" is missing required parameter "${reqParam}" for tool "${d.toolName}"`, nodeId: node.id });
                }
              }
            }
          }
        }
        if (!d.toolServer) {
          issues.push({ code: 'NO_TOOL_SERVER', message: `"${nodeLabel}" has no MCP server specified`, nodeId: node.id });
        }
      }

      // --- HTTP nodes: check URL, method, and auth ---
      if (node.type === 'http_request') {
        if (!d.url || d.url.trim().length === 0) {
          issues.push({ code: 'EMPTY_URL', message: `"${nodeLabel}" has no URL configured`, nodeId: node.id });
        } else if (!/^https?:\/\//.test(d.url) && !d.url.startsWith('{{')) {
          issues.push({ code: 'INVALID_URL', message: `"${nodeLabel}" URL does not start with http:// or https://`, nodeId: node.id });
        }
        if (!d.method) {
          issues.push({ code: 'NO_HTTP_METHOD', message: `"${nodeLabel}" has no HTTP method specified (GET, POST, etc.)`, nodeId: node.id });
        }
        // Check auth configuration if headers reference secrets/tokens
        if (d.headers) {
          const headersStr = typeof d.headers === 'string' ? d.headers : JSON.stringify(d.headers);
          if (/authorization|api[_-]?key|bearer/i.test(headersStr) && !headersStr.includes('{{secret:') && !headersStr.includes('{{env.')) {
            issues.push({ code: 'HARDCODED_CREDENTIAL', message: `"${nodeLabel}" may have hardcoded credentials in headers — use {{secret:name}} instead`, nodeId: node.id });
          }
        }
      }

      // --- Condition nodes: check expression ---
      if (node.type === 'condition') {
        if (!d.condition && !d.expression) {
          issues.push({ code: 'NO_CONDITION', message: `"${nodeLabel}" has no condition expression configured`, nodeId: node.id });
        }
        // Check condition has outgoing edges for both true/false paths
        const outEdges = definition.edges.filter(e => e.source === node.id);
        if (outEdges.length < 2) {
          issues.push({ code: 'INCOMPLETE_CONDITION', message: `"${nodeLabel}" should have both true and false output paths`, nodeId: node.id });
        }
      }

      // --- Loop nodes: check configuration ---
      if (node.type === 'loop') {
        if (!d.maxIterations && !d.max_iterations) {
          issues.push({ code: 'NO_LOOP_LIMIT', message: `"${nodeLabel}" has no max iteration limit — risk of infinite loop`, nodeId: node.id });
        }
        if (!d.collection && !d.items && !d.iterable) {
          // Check if it gets data from incoming node
          const hasIncoming = (incomingEdges.get(node.id) || []).length > 0;
          if (!hasIncoming) {
            issues.push({ code: 'NO_LOOP_DATA', message: `"${nodeLabel}" has no collection/items to iterate over`, nodeId: node.id });
          }
        }
      }

      // --- Code nodes: check code body ---
      if (node.type === 'code' || node.type === 'openagentic') {
        if (!d.code || d.code.trim().length === 0) {
          issues.push({ code: 'EMPTY_CODE', message: `"${nodeLabel}" has no code`, nodeId: node.id });
        }
      }

      // --- Data query nodes: check collection and query ---
      if (node.type === 'data_query') {
        if (!d.collection && !d.collectionName) {
          issues.push({ code: 'NO_COLLECTION', message: `"${nodeLabel}" has no data collection specified`, nodeId: node.id });
        }
        if (!d.query && !d.queryText && !d.prompt) {
          const hasIncoming = (incomingEdges.get(node.id) || []).length > 0;
          if (!hasIncoming) {
            issues.push({ code: 'NO_QUERY', message: `"${nodeLabel}" has no query configured and no incoming data`, nodeId: node.id });
          }
        }
      }

      // --- Transform nodes: check transform config ---
      if (node.type === 'transform') {
        if (!d.transform && !d.expression && !d.template && !d.code) {
          issues.push({ code: 'NO_TRANSFORM', message: `"${nodeLabel}" has no transform expression or template configured`, nodeId: node.id });
        }
      }

      // --- Trigger nodes: check configuration ---
      if (node.type === 'trigger') {
        const triggerType = d.triggerType || d.trigger_type;
        if (triggerType === 'webhook') {
          if (!d.webhookPath && !d.path) {
            issues.push({ code: 'NO_WEBHOOK_PATH', message: `"${nodeLabel}" webhook trigger has no path configured`, nodeId: node.id });
          }
        }
        if (triggerType === 'schedule' || triggerType === 'cron') {
          if (!d.schedule && !d.cron && !d.cronExpression) {
            issues.push({ code: 'NO_SCHEDULE', message: `"${nodeLabel}" schedule trigger has no cron expression configured`, nodeId: node.id });
          }
        }
      }

      // --- Check for unresolved secret references ---
      const nodeStr = JSON.stringify(d);
      const secretPattern = /\{\{secret:([^}]+)\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = secretPattern.exec(nodeStr)) !== null) {
        const secretName = m[1].trim();
        try {
          const { workflowSecretService } = await import('./WorkflowSecretService.js');
          const value = await workflowSecretService.resolveSecretValue(secretName, {
            workflowId: options?.workflowId,
          });
          if (!value) {
            issues.push({ code: 'SECRET_NOT_FOUND', message: `"${nodeLabel}" references secret "${secretName}" which is not configured`, nodeId: node.id });
          }
        } catch {
          issues.push({ code: 'SECRET_NOT_FOUND', message: `"${nodeLabel}" references secret "${secretName}" which could not be resolved`, nodeId: node.id });
        }
      }

      // --- Check for unresolved env variable references ---
      const envPattern = /\{\{env\.([^}]+)\}\}/g;
      while ((m = envPattern.exec(nodeStr)) !== null) {
        const envName = m[1].trim();
        if (!process.env[envName]) {
          issues.push({ code: 'ENV_NOT_SET', message: `"${nodeLabel}" references env variable "${envName}" which is not set`, nodeId: node.id });
        }
      }

      // --- Agent nodes: check required fields ---
      if (['agent_single', 'agent_supervisor', 'agent_pool', 'multi_agent'].includes(node.type)) {
        if (node.type === 'multi_agent' || node.type === 'agent_pool') {
          if (!d.agents || !Array.isArray(d.agents) || d.agents.length === 0) {
            issues.push({ code: 'NO_AGENTS', message: `"${nodeLabel}" has no agents configured`, nodeId: node.id });
          }
        }
        if (node.type === 'agent_single' && !d.prompt && !d.task) {
          issues.push({ code: 'NO_TASK', message: `"${nodeLabel}" has no task/prompt configured`, nodeId: node.id });
        }
        if (node.type === 'agent_supervisor') {
          if (!d.agents || !Array.isArray(d.agents) || d.agents.length === 0) {
            issues.push({ code: 'NO_AGENTS', message: `"${nodeLabel}" supervisor has no sub-agents configured`, nodeId: node.id });
          }
          if (!d.goal && !d.prompt && !d.task) {
            issues.push({ code: 'NO_GOAL', message: `"${nodeLabel}" supervisor has no goal/task configured`, nodeId: node.id });
          }
        }
      }

      // --- Approval/HITL nodes: check configuration ---
      if (node.type === 'approval' || node.type === 'human_approval') {
        if (!d.approvers && !d.approverRole && !d.notifyChannel) {
          issues.push({ code: 'NO_APPROVERS', message: `"${nodeLabel}" has no approvers or notification channel configured`, nodeId: node.id });
        }
      }
    }

    // --- Check for disconnected subgraphs (nodes with no edges) ---
    const connectedNodes = new Set<string>();
    for (const edge of definition.edges) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }
    for (const node of definition.nodes) {
      if (definition.nodes.length > 1 && !connectedNodes.has(node.id)) {
        const nodeLabel = node.data?.label || node.id;
        issues.push({ code: 'DISCONNECTED_NODE', message: `"${nodeLabel}" is not connected to any other node`, nodeId: node.id });
      }
    }

    // --- Check data flow: nodes that require input but have no incoming edges ---
    const inputRequiringTypes = new Set(['llm_completion', 'transform', 'condition', 'merge', 'code', 'openagentic']);
    for (const node of definition.nodes) {
      if (node.type === 'trigger') continue; // Triggers generate data
      if (inputRequiringTypes.has(node.type)) {
        const incoming = incomingEdges.get(node.id) || [];
        if (incoming.length === 0 && !node.data?.prompt?.includes('{{')) {
          // This node has no incoming data AND no template vars — it may be orphaned
          const nodeLabel = node.data?.label || node.id;
          issues.push({ code: 'NO_INPUT_SOURCE', message: `"${nodeLabel}" has no incoming connection to provide input data`, nodeId: node.id });
        }
      }
    }

    return { ready: issues.length === 0, issues };
  }

  private buildResult(
    valid: boolean,
    errors: CompilationError[],
    warnings: CompilationWarning[],
    executionOrder: string[],
    definition: WorkflowDefinition,
    extra?: { hasCycles: boolean; unreachableNodes: string[]; terminalNodes: string[]; triggerNodes: string[] }
  ): CompilationResult {
    return {
      valid,
      errors,
      warnings,
      executionOrder,
      metadata: {
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
        hasCycles: extra?.hasCycles ?? false,
        unreachableNodes: extra?.unreachableNodes ?? [],
        terminalNodes: extra?.terminalNodes ?? [],
        triggerNodes: extra?.triggerNodes ?? [],
      },
    };
  }
}
