/**
 * Bedrock Converse-API tool-format converter.
 *
 * Centralizes the shape conversion between the two tool formats the chat
 * pipeline injects into LLM requests, and the flat `toolConfig.tools[].toolSpec`
 * shape the AWS Bedrock Converse API validates:
 *
 *   Anthropic-native:  { name, description, input_schema }
 *   OpenAI-style:      { type: 'function', function: { name, description, parameters } }
 *
 * The old inline `body.tools.map(t => ({ toolSpec: { name: t.name, ... } }))`
 * produced `toolSpec.name: null` whenever an OpenAI-style entry was present
 * (e.g. the server-injected `BROWSER_SANDBOX_EXEC_TOOL` at agents.stage.ts:121
 * or any MCP-proxy function tool). Bedrock Converse responds with a
 * 10-validation-error `COMPLETION_ERROR` on `toolSpec.name` being null.
 *
 * Tools with no resolvable name are dropped rather than serialized with a
 * null, because a null-name tool can never be dispatched anyway — keeping it
 * in the request only fails the call.
 */

type AnyTool = Record<string, unknown> & {
  name?: unknown;
  description?: unknown;
  input_schema?: unknown;
  function?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
  };
};

export interface ConverseToolSpec {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

export interface ConverseToolConfig {
  tools: ConverseToolSpec[];
}

function pickName(t: AnyTool): string | null {
  const n = (t.function?.name ?? t.name) as unknown;
  if (typeof n !== 'string' || n.length === 0) return null;
  return n;
}

function pickDescription(t: AnyTool): string {
  const d = (t.function?.description ?? t.description) as unknown;
  return typeof d === 'string' ? d : '';
}

function pickSchema(t: AnyTool): Record<string, unknown> {
  const s = (t.function?.parameters ?? t.input_schema) as unknown;
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
}

export function toConverseToolConfig(tools: AnyTool[] | null | undefined): ConverseToolConfig {
  if (!tools || !Array.isArray(tools)) return { tools: [] };
  const out: ConverseToolSpec[] = [];
  for (const tool of tools) {
    const name = pickName(tool || {});
    if (!name) continue; // silently drop null-named tools so the request survives
    out.push({
      toolSpec: {
        name,
        description: pickDescription(tool || {}),
        inputSchema: { json: pickSchema(tool || {}) },
      },
    });
  }
  return { tools: out };
}
