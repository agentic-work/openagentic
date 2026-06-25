/**
 * Normalize a tool entry to the OpenAI function-calling shape every
 * provider's `convertToolsToXxx` helper expects.
 *
 * Why this exists: chatmode's MCP Proxy returns native MCP shape
 *   { name, description, inputSchema, server }
 * while meta-tools (Task, compose_visual, etc.) are hand-authored
 *   { type: 'function', function: { name, description, parameters } }.
 * `OllamaProvider.convertToolsToOllama` filters on `.function?.name`, so
 * if MCP tools reach it raw, ALL 270+ get dropped silently — leaving the
 * model with only the 6 meta-tools and no way to action cloud-ops asks.
 *
 * Caught 2026-04-29 via Playwright on live api `086e87a4`. See #516.
 */

export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export function normalizeMcpToolToOpenAI(tool: any): OpenAiTool | null {
  if (!tool || typeof tool !== 'object') return null;

  if (tool.type === 'function' && tool.function?.name) {
    return {
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description ?? '',
        parameters: tool.function.parameters ?? { type: 'object', properties: {} },
      },
    };
  }

  if (typeof tool.name === 'string' && tool.name.length > 0) {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters:
          tool.inputSchema ??
          tool.input_schema ??
          { type: 'object', properties: {} },
      },
    };
  }

  return null;
}

export function normalizeToolArray(tools: readonly any[]): OpenAiTool[] {
  const out: OpenAiTool[] = [];
  for (const t of tools) {
    const norm = normalizeMcpToolToOpenAI(t);
    if (norm) out.push(norm);
  }
  return out;
}
