/**
 * #1112 — Bedrock tool-definition builder that inlines `input_examples`.
 *
 * The Anthropic Messages API (which Bedrock-served Claude models speak) has
 * no dedicated `input_examples` wire field. The canonical pattern is to inline
 * concrete JSON exemplars into the tool `description` so the model sees the
 * expected input shapes at schema-prompt time.
 *
 * Live evidence (2026-05-25, Sonnet 4.6 via Bedrock): `compose_app` was
 * force-dispatched via `tool_choice: {type:'tool', name:'compose_app'}` on a
 * permission-matrix prompt. The model emitted
 *   { principals: [{...object...}], cells: [] }
 * instead of
 *   { title, principals: [strings], actions: [strings], cells: [{...}] }
 * because the per-template `exampleParams` that `COMPOSE_APP_TOOL.input_examples`
 * populates never reached the wire — the Bedrock serializer at
 * `AWSBedrockProvider.ts` built tool defs with only
 * `{ name, description, input_schema }`, stripping `input_examples`.
 *
 * This helper is the single source of truth for that inlining. The provider
 * calls `buildBedrockToolDef` so its tool serialization stays in sync, and the
 * `AWSBedrockProvider.input-examples.test.ts` suite pins the REAL behavior by
 * importing this same function (no mirror copy).
 */

/** A tool entry in either Anthropic-native or OpenAI-style shape. */
export interface AnyBedrockToolInput {
  name?: unknown;
  description?: unknown;
  input_schema?: unknown;
  input_examples?: unknown;
  function?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
    input_examples?: unknown;
  };
}

/** Minimal Anthropic-on-Bedrock tool definition shape. */
export interface BedrockToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Build the tool `description`, inlining any `input_examples` as fenced JSON
 * blocks after the base description. Un-serializable examples (circular refs)
 * are skipped silently rather than throwing.
 */
export function buildBedrockToolDescription(tool: AnyBedrockToolInput): string {
  const baseDescription =
    (typeof tool.function?.description === 'string' && tool.function.description) ||
    (typeof tool.description === 'string' && tool.description) ||
    '';
  const examples = tool.function?.input_examples ?? tool.input_examples;
  if (!Array.isArray(examples) || examples.length === 0) {
    return baseDescription;
  }

  const lines = ['', '', '## Example inputs (use these shapes verbatim — do not invent new shapes):'];
  for (const ex of examples) {
    let body: string;
    try {
      body = JSON.stringify(ex, null, 2);
    } catch {
      continue; // skip un-serializable example (circular refs etc)
    }
    lines.push('```json');
    lines.push(body);
    lines.push('```');
  }
  return baseDescription + lines.join('\n');
}

/**
 * Build the `{ name, description, input_schema }` Bedrock tool def, inlining
 * `input_examples` into the description. The `schemaTransform` hook lets the
 * provider apply its `flattenTopLevelUnions` normalization to the schema while
 * keeping the description/example logic here as the single SoT.
 */
export function buildBedrockToolDef(
  tool: AnyBedrockToolInput,
  schemaTransform: (schema: Record<string, unknown>) => Record<string, unknown> = (s) => s,
): BedrockToolDef {
  const name =
    (typeof tool.function?.name === 'string' && tool.function.name) ||
    (typeof tool.name === 'string' && tool.name) ||
    '';
  const rawSchema = (tool.function?.parameters ?? tool.input_schema) as unknown;
  const schema = rawSchema && typeof rawSchema === 'object' ? (rawSchema as Record<string, unknown>) : {};
  return {
    name,
    description: buildBedrockToolDescription(tool),
    input_schema: schemaTransform(schema),
  };
}
