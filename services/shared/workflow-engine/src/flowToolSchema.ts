/**
 * Project a saved Workflow row into the agent-tool-catalog shape used by
 * V1.1 flow_tool integration. See flowToolSchema.test.ts for the contract.
 *
 * The output is a normalized record both api and openagentic-proxy can consume:
 * - api `/api/workflows/:id/as-tool-schema` returns this verbatim
 * - openagentic-proxy `AgentRunner` projects this into the provider tools[] array
 *
 * No engine imports — keep this pure so it can be reused from web/UI without
 * pulling in workflow-engine runtime deps.
 */

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface FlowToolSchema {
  flowId: string;
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

interface WorkflowLike {
  id: string;
  name: string;
  description?: string | null;
  definition?: unknown;
  settings?: unknown;
}

const PERMISSIVE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

export function deriveFlowToolSchema(wf: WorkflowLike): FlowToolSchema {
  const settings = (wf.settings ?? {}) as Record<string, unknown>;
  const toolMeta = (settings.tool_meta ?? {}) as Record<string, unknown>;

  const name = sanitizeToolName(
    (typeof toolMeta.name === 'string' && toolMeta.name) || wf.name || wf.id,
  );

  const description =
    (typeof toolMeta.description === 'string' && toolMeta.description.trim()) ||
    (typeof wf.description === 'string' && wf.description.trim()) ||
    `Invoke the '${wf.name}' saved flow as a tool.`;

  const input_schema = resolveInputSchema(toolMeta, wf.definition);

  return {
    flowId: wf.id,
    name,
    description,
    input_schema,
  };
}

function resolveInputSchema(
  toolMeta: Record<string, unknown>,
  definition: unknown,
): JsonSchemaObject {
  const metaSchema = toolMeta.input_schema;
  if (isJsonSchemaObject(metaSchema)) {
    return metaSchema;
  }

  if (definition && typeof definition === 'object') {
    const nodes = (definition as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) {
      const trigger = nodes.find(
        (n) => n && typeof n === 'object' && (n as { type?: string }).type === 'trigger',
      );
      const triggerData = trigger && typeof trigger === 'object'
        ? ((trigger as { data?: unknown }).data ?? {})
        : {};
      const triggerSchema = (triggerData as { inputSchema?: unknown }).inputSchema;
      if (isJsonSchemaObject(triggerSchema)) {
        return triggerSchema;
      }
    }
  }

  return PERMISSIVE_SCHEMA;
}

function isJsonSchemaObject(v: unknown): v is JsonSchemaObject {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  return obj.type === 'object' && typeof obj.properties === 'object' && obj.properties !== null;
}

export function sanitizeToolName(raw: string): string {
  let s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'flow';
  if (!/^[a-z]/.test(s)) s = 'f_' + s;
  if (s.length > 64) s = s.slice(0, 64).replace(/_+$/, '');
  return s;
}
