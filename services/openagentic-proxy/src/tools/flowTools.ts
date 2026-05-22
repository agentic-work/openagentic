/**
 * V1.1 flow_tool — pure helpers for projecting api's `/api/workflows/agent-tools`
 * response into LLM-visible OpenAI tool defs + a name→flowId routing map.
 *
 * Kept pure (no axios, no logger) so the unit tests can run under
 * `node:test --experimental-strip-types` without mocks.
 */

export interface FlowToolSchema {
  flowId: string;
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: FlowToolSchema['input_schema'];
  };
}

export function projectFlowToolToOpenAi(t: FlowToolSchema): OpenAiFunctionTool {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  };
}

/**
 * Build a name→flowId routing map. Forward iteration with last-write-wins so
 * the caller controls precedence by argument order — duplicates collapse to
 * whichever entry appears later in the array.
 */
export function buildFlowToolMap(tools: FlowToolSchema[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tools) map.set(t.name, t.flowId);
  return map;
}

export function isFlowTool(name: string, map: Map<string, string>): boolean {
  if (!name) return false;
  return map.has(name);
}
