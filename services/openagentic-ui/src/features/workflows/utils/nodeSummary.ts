/**
 * nodeSummary.ts — human-readable post-run summary for a completed
 * canvas node.
 *
 * Returned string surfaces in the hover tooltip on a completed node so
 * operators get a glanceable answer to "what just happened?" without
 * having to expand the raw output JSON.
 *
 * Design rules:
 *   - Short (one short sentence, typically <60 chars).
 *   - Specific (reference concrete numbers/names from the output shape).
 *   - Side-effect free.
 *   - Fall back to "Completed" when the node type is unregistered or
 *     the output shape is empty.
 *
 * Coverage spans every node type registered in `nodeConfigs.ts` plus
 * common variants (e.g. `openagentic_chat`, `bedrock`, `vertex`, `azure_ai`)
 * so post-completion hover never falls back to raw JSON for a known node.
 */

const LLM_LIKE = new Set<string>([
  'llm_completion',
  'openagentic_llm',
  'openagentic_chat',
  'azure_ai',
  'bedrock',
  'vertex',
  'reasoning',
  'synth',
]);

const AGENT_LIKE = new Set<string>([
  'agent_single',
  'agent_pool',
  'agent_spawn',
  'agent_supervisor',
]);

const MESSAGING: Record<string, string> = {
  slack_message: 'Slack',
  teams_message: 'Teams',
  discord_message: 'Discord',
};

const KNOWN_NODE_TYPES = new Set<string>([
  ...LLM_LIKE,
  ...AGENT_LIKE,
  ...Object.keys(MESSAGING),
  'structured_output',
  'multi_agent',
  'mcp_tool',
  'condition',
  'switch',
  'loop',
  'parallel',
  'merge',
  'wait',
  'http_request',
  'webhook_response',
  'transform',
  'filter_data',
  'select_data',
  'extract_key',
  'parse_json',
  'regex',
  'prompt_template',
  'conversation_memory',
  'flow_tool',
  'rag_query',
  'data_source_query',
  'file_upload',
  'text_splitter',
  'embedding',
  'vector_store',
  'document_loader',
  'send_email',
  'outlook_email',
  'pagerduty_incident',
  'servicenow_ticket',
  'jira_issue',
  'approval',
  'human_approval',
  'trigger',
  'code',
  'sub_workflow',
  'user_context',
  'error_handler',
  'guardrails',
  'text',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function countWords(s: unknown): number {
  if (typeof s !== 'string') return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function pickFirstArray(o: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function parseContentJson(o: Record<string, unknown>): Record<string, unknown> | null {
  const content = o.content;
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function tokenUsageString(o: Record<string, unknown>): string {
  const usage = asRecord(o.usage);
  if (!usage) return '';
  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  if (typeof prompt === 'number' && typeof completion === 'number') {
    return ` (${prompt}/${completion} tokens)`;
  }
  if (typeof usage.total_tokens === 'number') {
    return ` (${usage.total_tokens} tokens)`;
  }
  return '';
}

export function summarizeNodeRun(nodeType: string, output: unknown): string {
  // null / undefined / non-object output → always generic fallback.
  if (output === null || output === undefined) return 'Completed';
  const o = asRecord(output) ?? {};
  // Empty record AND unknown node type → generic fallback. Known node
  // types fall through to their type-specific branches so callers see
  // e.g. "HTTP request completed" instead of bare "Completed".
  if (Object.keys(o).length === 0 && !KNOWN_NODE_TYPES.has(nodeType)) {
    return 'Completed';
  }

  // ---------------- LLM-like ----------------
  if (LLM_LIKE.has(nodeType)) {
    const words = countWords(o.content);
    return `Generated ${words} words${tokenUsageString(o)}`;
  }

  // ---------------- Structured output ----------------
  if (nodeType === 'structured_output') {
    const out = asRecord(o.output);
    if (out) return `Produced structured output with ${Object.keys(out).length} fields`;
    return 'Produced structured output';
  }

  // ---------------- Agent nodes ----------------
  if (AGENT_LIKE.has(nodeType)) {
    const words = countWords(o.content);
    const parts: string[] = [];
    if (typeof o.toolCalls === 'number') parts.push(`${o.toolCalls} tool calls`);
    if (typeof o.turns === 'number') parts.push(`${o.turns} turns`);
    const suffix = parts.length ? ` (${parts.join(', ')})` : '';
    return `Agent produced ${words} words${suffix}`;
  }

  if (nodeType === 'multi_agent') {
    const words = countWords(o.content);
    const count = typeof o.agentCount === 'number' ? o.agentCount : null;
    return count != null
      ? `${count} agents produced ${words} words`
      : `Multi-agent produced ${words} words`;
  }

  // ---------------- MCP tool ----------------
  if (nodeType === 'mcp_tool') {
    const arr = pickFirstArray(o, ['items', 'pods', 'data', 'results', 'rows', 'targets', 'alerts', 'nodes', 'deployments']);
    if (arr) return `Returned ${arr.length} items`;
    const nested = parseContentJson(o);
    if (nested) {
      const nestedArr = pickFirstArray(nested, ['items', 'pods', 'data', 'results', 'rows', 'targets', 'alerts', 'nodes', 'deployments']);
      if (nestedArr) return `Returned ${nestedArr.length} items`;
    }
    const dataObj = asRecord(o.data);
    if (dataObj) return `Returned data with ${Object.keys(dataObj).length} fields`;
    // Generic field count fallback for object outputs without obvious arrays.
    const fields = Object.keys(o).filter((k) => k !== 'content' && k !== 'usage');
    if (fields.length > 0) return `Returned data with ${fields.length} fields`;
    return 'MCP tool completed';
  }

  // ---------------- Control flow ----------------
  if (nodeType === 'condition') {
    return `Routed to ${o.branch ?? 'unknown'} branch`;
  }

  if (nodeType === 'switch') {
    return `Routed to ${o.case ?? 'unknown'} case`;
  }

  if (nodeType === 'loop') {
    return `Iterated ${o.iterations ?? 0} times`;
  }

  if (nodeType === 'parallel') {
    return `Ran ${o.branches ?? 0} branches in parallel`;
  }

  if (nodeType === 'merge') {
    return `Merged ${o.sources ?? 0} inputs`;
  }

  if (nodeType === 'wait') {
    const ms = typeof o.waitedMs === 'number' ? o.waitedMs : 0;
    return `Waited ${(ms / 1000).toFixed(1)}s`;
  }

  // ---------------- HTTP / webhook ----------------
  if (nodeType === 'http_request') {
    if (typeof o.statusCode === 'number') return `HTTP ${o.statusCode}`;
    return 'HTTP request completed';
  }

  if (nodeType === 'webhook_response') {
    const body = typeof o.body === 'string' ? o.body : '';
    const sizeKb = (body.length / 1024).toFixed(1);
    const status = typeof o.statusCode === 'number' ? o.statusCode : 200;
    return `Rendered ${sizeKb} KB response (HTTP ${status})`;
  }

  // ---------------- Data nodes ----------------
  if (nodeType === 'transform') {
    if (Array.isArray(o.operations)) return `Applied ${o.operations.length} transforms`;
    if (Array.isArray(o.keysSet)) return `Applied ${o.keysSet.length} transforms`;
    return 'Applied transforms';
  }

  // ---------------- Typed processing primitives (output_parser split) ----------------
  if (nodeType === 'filter_data') {
    if (Array.isArray(o.filtered) && typeof o.totalCount === 'number') {
      return `Filtered to ${o.filtered.length} of ${o.totalCount} items`;
    }
    return 'Filtered array';
  }

  if (nodeType === 'select_data') {
    if (Array.isArray(output)) return `Kept ${output.length} rows with selected fields`;
    if (output && typeof output === 'object') {
      return `Kept ${Object.keys(output as Record<string, unknown>).length} fields`;
    }
    return 'Selected fields';
  }

  if (nodeType === 'extract_key') {
    if (o.found === false) return 'Path not found (used default)';
    const v = o.value;
    const preview =
      typeof v === 'string'
        ? v.length > 40 ? `${v.slice(0, 40)}…` : v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : Array.isArray(v)
            ? `array (${(v as unknown[]).length})`
            : 'object';
    return `Extracted: ${preview}`;
  }

  if (nodeType === 'parse_json') {
    if (o.parseError) return `Parse failed: ${String(o.parseError).slice(0, 60)}`;
    const parsed = o.parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return `Parsed ${Object.keys(parsed as Record<string, unknown>).length} keys`;
    }
    if (Array.isArray(parsed)) return `Parsed array (${parsed.length} items)`;
    return 'Parsed JSON';
  }

  if (nodeType === 'conversation_memory') {
    const op = typeof o.operation === 'string' ? o.operation : '';
    if (op === 'write') {
      const total = typeof o.total === 'number' ? o.total : null;
      return total != null ? `Wrote 1 message (total: ${total})` : 'Wrote 1 message';
    }
    if (op === 'read') {
      const count = typeof o.count === 'number' ? o.count : 0;
      return `Read ${count} ${count === 1 ? 'message' : 'messages'}`;
    }
    if (op === 'clear') {
      const removed = typeof o.removedCount === 'number' ? o.removedCount : 0;
      return `Cleared ${removed} ${removed === 1 ? 'message' : 'messages'}`;
    }
    if (op === 'summarize') {
      const n = typeof o.messagesSummarized === 'number' ? o.messagesSummarized : 0;
      const len = typeof o.summary === 'string' ? o.summary.length : 0;
      return `Summarized ${n} messages (${len} chars)`;
    }
    if (op === 'search') {
      const count = typeof o.count === 'number' ? o.count : 0;
      const topScore =
        Array.isArray(o.matches) && o.matches.length > 0 && typeof (o.matches[0] as any).score === 'number'
          ? (o.matches[0] as any).score
          : null;
      const scoreStr = topScore != null ? ` (top score: ${topScore.toFixed(3)})` : '';
      return `Semantic search returned ${count} ${count === 1 ? 'match' : 'matches'}${scoreStr}`;
    }
    return 'Conversation memory updated';
  }

  if (nodeType === 'prompt_template') {
    if (o.outputAs === 'messages' && Array.isArray(o.messages)) {
      const vars = o.variables && typeof o.variables === 'object'
        ? Object.keys(o.variables as Record<string, unknown>).length
        : 0;
      return `Built ${o.messages.length}-message conversation with ${vars} variables`;
    }
    if (typeof o.prompt === 'string') {
      const vars = o.variables && typeof o.variables === 'object'
        ? Object.keys(o.variables as Record<string, unknown>).length
        : 0;
      return `Rendered ${o.prompt.length}-char prompt with ${vars} variables`;
    }
    return 'Prompt template rendered';
  }

  if (nodeType === 'regex') {
    // Match mode: { matches: [{full,groups}], count }
    if (Array.isArray(o.matches) && typeof o.count === 'number') {
      return `Found ${o.count} ${o.count === 1 ? 'match' : 'matches'}`;
    }
    // Replace mode: { result, replacedCount }
    if (typeof o.replacedCount === 'number') {
      return `Replaced ${o.replacedCount} ${o.replacedCount === 1 ? 'occurrence' : 'occurrences'}`;
    }
    // Test mode: { matches: boolean }
    if (typeof o.matches === 'boolean') {
      return `Pattern ${o.matches ? 'matched' : 'did not match'}`;
    }
    return 'Regex applied';
  }

  if (nodeType === 'wait_for') {
    const polls = typeof o.polls === 'number' ? o.polls : 0;
    const ms = typeof o.durationMs === 'number' ? o.durationMs : 0;
    const secs = (ms / 1000).toFixed(1);
    if (o.timedOut === true) {
      return `Timed out after ${secs}s (${polls} polls)`;
    }
    if (o.satisfied === true) {
      return polls === 1
        ? `Condition met on first poll (${secs}s)`
        : `Condition met after ${polls} polls (${secs}s)`;
    }
    return 'Wait completed';
  }

  if (nodeType === 'csv_processor') {
    const count = typeof o.count === 'number' ? o.count : 0;
    const cols = Array.isArray(o.columns) ? o.columns.length : 0;
    const mode = typeof o.outputAs === 'string' ? o.outputAs : 'records';
    if (cols > 0) {
      return `Parsed ${count} ${count === 1 ? 'row' : 'rows'} × ${cols} columns (${mode})`;
    }
    return `Parsed ${count} ${count === 1 ? 'row' : 'rows'} (${mode})`;
  }

  if (nodeType === 'rate_limiter') {
    const key = typeof o.key === 'string' ? o.key : '';
    const calls = typeof o.calls === 'number' ? o.calls : 0;
    const maxCalls = typeof o.maxCalls === 'number' ? o.maxCalls : 0;
    const waited = typeof o.waitedMs === 'number' ? o.waitedMs : 0;
    if (o.allowed === true && waited > 0) {
      return `Blocked ${(waited / 1000).toFixed(1)}s, then allowed (${key}: ${calls}/${maxCalls})`;
    }
    if (o.allowed === true) {
      return `Allowed (${key}: ${calls}/${maxCalls})`;
    }
    if (o.limited === true) {
      return `Throttled — dropped (${key}: ${calls}/${maxCalls})`;
    }
    return 'Rate limiter check';
  }

  if (nodeType === 'flow_tool') {
    const toolName = typeof o.toolName === 'string' && o.toolName ? o.toolName : null;
    const flowId = typeof o.flowId === 'string' && o.flowId ? o.flowId : null;
    const label = toolName ?? flowId;
    if (label && o.extracted) {
      return `Invoked ${label}; extracted ${o.extracted}`;
    }
    if (label) {
      return `Invoked sub-flow ${label}`;
    }
    return 'Sub-flow invoked';
  }

  if (nodeType === 'rag_query') {
    const arr = pickFirstArray(o, ['matches', 'results', 'hits']);
    return arr ? `Retrieved ${arr.length} matches` : 'RAG query completed';
  }

  if (nodeType === 'data_source_query') {
    const arr = pickFirstArray(o, ['rows', 'results']);
    return arr ? `Returned ${arr.length} rows` : 'Query completed';
  }

  if (nodeType === 'file_upload') {
    return o.filename ? `Uploaded ${o.filename}` : 'File uploaded';
  }

  if (nodeType === 'text_splitter') {
    const arr = pickFirstArray(o, ['chunks']);
    return arr ? `Split into ${arr.length} chunks` : 'Text split';
  }

  if (nodeType === 'embedding') {
    if (typeof o.vectors === 'number') return `Generated ${o.vectors} embeddings`;
    const arr = pickFirstArray(o, ['embeddings', 'vectors']);
    return arr ? `Generated ${arr.length} embeddings` : 'Embedding completed';
  }

  if (nodeType === 'vector_store') {
    if (typeof o.stored === 'number') return `Stored ${o.stored} vectors`;
    return 'Vector store updated';
  }

  if (nodeType === 'document_loader') {
    const arr = pickFirstArray(o, ['documents', 'docs']);
    return arr ? `Loaded ${arr.length} documents` : 'Documents loaded';
  }

  // ---------------- Messaging ----------------
  if (MESSAGING[nodeType]) {
    const platform = MESSAGING[nodeType];
    return o.channel ? `Sent ${platform} message to ${o.channel}` : `${platform} message sent`;
  }

  if (nodeType === 'send_email' || nodeType === 'outlook_email') {
    return o.to ? `Sent email to ${o.to}` : 'Email sent';
  }

  if (nodeType === 'pagerduty_incident') {
    return o.incidentId ? `Created PagerDuty incident ${o.incidentId}` : 'PagerDuty incident created';
  }

  if (nodeType === 'servicenow_ticket') {
    return o.ticketId ? `Created ServiceNow ticket ${o.ticketId}` : 'ServiceNow ticket created';
  }

  if (nodeType === 'jira_issue') {
    return o.key ? `Created Jira issue ${o.key}` : 'Jira issue created';
  }

  // ---------------- Approval ----------------
  if (nodeType === 'approval') {
    return `Decision: ${o.decision ?? 'pending'}`;
  }

  if (nodeType === 'human_approval') {
    const decision = o.decision ?? 'pending';
    return o.approver ? `Decision: ${decision} by ${o.approver}` : `Decision: ${decision}`;
  }

  // ---------------- Misc ----------------
  if (nodeType === 'trigger') {
    return 'Trigger fired';
  }

  if (nodeType === 'code') {
    if (typeof o.stdout === 'string' && o.stdout.length > 0) {
      const lines = o.stdout.split(/\r?\n/).length;
      return `Executed code (${lines} lines stdout)`;
    }
    if (o.result !== undefined) {
      const t = Array.isArray(o.result) ? 'array' : typeof o.result;
      return `Executed code (returned ${t})`;
    }
    return 'Executed code';
  }

  if (nodeType === 'sub_workflow') {
    return o.workflowName ? `Ran sub-workflow: ${o.workflowName}` : 'Sub-workflow completed';
  }

  if (nodeType === 'user_context') {
    return o.userId ? `Loaded user context ${o.userId}` : 'User context loaded';
  }

  if (nodeType === 'error_handler') {
    return o.handledError ? `Handled error: ${o.handledError}` : 'Error handled';
  }

  if (nodeType === 'guardrails') {
    const passed = typeof o.passed === 'number' ? o.passed : 0;
    const failed = typeof o.failed === 'number' ? o.failed : 0;
    return `Guardrails: ${passed} passed, ${failed} failed`;
  }

  if (nodeType === 'text') {
    if (typeof o.content === 'string') return `${o.content.length} characters`;
    return 'Text produced';
  }

  return 'Completed';
}
