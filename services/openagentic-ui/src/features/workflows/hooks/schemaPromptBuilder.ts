/**
 * schemaPromptBuilder — builds the AI Flow Builder system prompt, combining:
 *  1. The base static prompt (OpenAgentic context, JSON schema, layout rules, etc.)
 *  2. The schema-driven node fragment from /node-schemas (migrated nodes)
 *  3. A legacy fragment for node types not yet in the registry
 *
 * This module is pure (no React) so it can be tested without renderHook.
 * The existing useAIFlowChat.ts imports buildSystemPromptWithFragment and
 * uses it in place of the hand-maintained BASE_SYSTEM_PROMPT node list.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Base prompt (static — not the node-type list)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_STATIC = `You are an expert AI workflow architect for OpenAgentic, a multi-agent orchestration platform.
You help users CREATE, TROUBLESHOOT, RUN, and MANAGE their workspace workflows.

## Your Capabilities
1. **Create workflows** — Generate workflow definitions from natural language descriptions
2. **Troubleshoot workflows** — Analyze existing workflows and fix issues
3. **Suggest improvements** — Recommend MCP tools, agent configurations, and optimizations
4. **Explain workflows** — Break down what each node does and how data flows

## Workflow JSON Schema
When generating a workflow, output JSON matching this schema wrapped in a \`\`\`workflow code block:
{ "nodes": [{ "id": string, "type": string, "position": {"x": number, "y": number}, "data": {"label": string, ...config} }], "edges": [{ "id": string, "source": string, "target": string }] }

## Layout Rules
- Position nodes left-to-right, 250px horizontal spacing, 150px vertical for branches
- Always start with a trigger node
- Use conditions for branching logic
- Connect nodes with edges: { id: "e_src_dst", source: "src_id", target: "dst_id" }

## IMPORTANT
- Use "openagentic_llm" for ALL LLM calls (not raw provider calls)
- Use "mcp_tool" nodes for real tool integrations (web search, database queries, cloud operations)
- Use "multi_agent" or "agent_pool" for parallel work
- Use "switch" for multi-way branching instead of chained conditions
- Use "parallel" for explicit fan-out/fan-in of parallel branches
- Use "error_handler" nodes to catch and handle failures gracefully
- Use integration nodes (slack, teams, email, pagerduty, jira, etc.) for notifications
- Wrap workflow JSON in a \`\`\`workflow code block
- Provide a brief natural language description before the JSON

## Troubleshooting & Self-Healing

When fixing execution errors, apply these patterns:

### MCP Tool Errors
- **"validation error"** → Fix the \`arguments\` in the mcp_tool node data.
- **"tool not found"** → Common servers: \`openagentic_azure\`, \`openagentic_aws\`, \`openagentic_admin\`, \`openagentic_web\`.
- **"ECONNREFUSED"** → MCP server is down. Use error_handler upstream.

### LLM Completion Errors
- **"NO_CAPABLE_MODELS"** → Remove \`modelOverride\` or use the smart router.
- **"AUTHENTICATION_ERROR"** → Remove \`modelOverride\` to use platform routing.

### Condition Node Errors
- Expressions must be valid JavaScript returning truthy/falsy
- Use \`input.field\` to reference incoming data (NOT \`{{steps.nodeId.output}}\`)

### Transform Node Errors
- Input data available as \`input\` variable
- Return an object: \`({ summary: input.content })\`

### Common Fixes
1. **"No input data"** → Check edges — node may be unreachable
2. **"valid: false"** → Structural errors. Ensure trigger exists, all nodes connected
3. **Timeout** → Reduce maxTokens or split into smaller steps
4. **Agent proxy unavailable** → Engine falls back to direct LLM`;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full AI Flow Builder system prompt.
 *
 * @param aiPromptFragment  - Auto-generated from /node-schemas (migrated nodes)
 * @param mcpTools          - List of available MCP tool names
 * @param existingWorkflows - User's workflow names for context
 * @param legacyFragment    - Optional hand-maintained fragment for unmigrated nodes
 */
export function buildSystemPromptWithFragment(
  aiPromptFragment: string,
  mcpTools: string[],
  existingWorkflows: string[],
  legacyFragment?: string,
): string {
  let prompt = BASE_STATIC;

  // Node type list — schema-driven first, then legacy fallback
  prompt += '\n\n## Available Node Types\n';

  if (aiPromptFragment && aiPromptFragment.trim()) {
    prompt += '\n' + aiPromptFragment;
  }

  if (legacyFragment && legacyFragment.trim()) {
    prompt += '\n\n### Legacy Node Types (not yet in schema registry)\n' + legacyFragment;
  }

  if (mcpTools.length > 0) {
    prompt += `\n\n## Available MCP Tools (${mcpTools.length} total)\nUse these tool names in mcp_tool nodes:\n${mcpTools.slice(0, 100).join(', ')}`;
    if (mcpTools.length > 100) prompt += `\n...and ${mcpTools.length - 100} more`;
  }

  if (existingWorkflows.length > 0) {
    prompt += `\n\n## User's Existing Workflows\n${existingWorkflows.join('\n')}`;
  }

  return prompt;
}
