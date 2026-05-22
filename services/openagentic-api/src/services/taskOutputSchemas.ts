/**
 * taskOutputSchemas — pre-registered output-shape contracts for sub-agent
 * Task dispatches.
 *
 * Cognition's "Don't Build Multi-Agents" (Mar 2026) called out the
 * diverging-implicit-decisions failure mode in parallel sub-agent fan-out:
 * two sub-agents handed the same prompt by a coordinator return outputs
 * that look identical-shape but disagree on substance (one picked "largest
 * subscription", the other "most recent"). The merge step then produces
 * an answer that's inconsistent with both inputs.
 *
 * Fix: give the parent agent a way to demand a SHAPE for sub-agent output.
 * Caller invokes Task with `output_schema_name: 'cloud_resource_listing'`
 * → TaskTool validates the sub-agent's final message JSON against the
 * pre-registered schema → returns either {ok:true, data} or
 * {ok:false, schema_violation: <error>} so the parent agent can recover.
 *
 * Hand-rolled minimal validator (no ajv dep). The schemas here express
 * shape constraints expressive enough for the 4 high-frequency dispatch
 * patterns; richer JSON-Schema features (allOf, oneOf, regex pattern, etc.)
 * are intentionally out of scope — if a richer schema is needed we'll
 * swap in ajv at that point.
 *
 * Wire-in to TaskTool deferred — primitive ships standalone with a real
 * gpt-oss:20b integration test that exercises the validator against
 * actual model output.
 *
 * Source: https://cognition.ai/blog/dont-build-multi-agents
 *         https://modelcontextprotocol.io/specification/2025-11-25/server/tools (outputSchema)
 */

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface SchemaField {
  type: SchemaFieldType;
  required?: boolean;
  /** Enum of allowed string values (only meaningful when type='string'). */
  enum?: string[];
  /** Element shape for array fields. Recursive. */
  items?: SchemaField | Record<string, SchemaField>;
  /** Nested object field map. */
  properties?: Record<string, SchemaField>;
}

export interface TaskOutputSchema {
  /** Top-level field map. Every key here may be required + typed. */
  fields: Record<string, SchemaField>;
  /** Human-readable hint emitted into the retry prompt on validation failure. */
  description: string;
}

export const taskOutputSchemas: Record<string, TaskOutputSchema> = {
  cloud_resource_listing: {
    description:
      'A normalized listing of cloud resources from one or more providers. Use for sub-agents that enumerate accounts / subscriptions / projects / regions / resource groups.',
    fields: {
      provider: { type: 'string', required: true, enum: ['aws', 'azure', 'gcp'] },
      resource_kind: { type: 'string', required: true },
      items: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string' },
            region: { type: 'string' },
          },
        },
      },
    },
  },

  cost_analysis: {
    description:
      'A cost breakdown summary. Use for sub-agents that compute spend across a time window / service / region.',
    fields: {
      period: { type: 'string', required: true },
      total_usd: { type: 'number', required: true },
      breakdown: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', required: true },
            usd: { type: 'number', required: true },
          },
        },
      },
    },
  },

  security_finding: {
    description:
      'A single security finding (vulnerability, misconfiguration, drift). Use for sub-agents that scan a specific scope and report one issue at a time.',
    fields: {
      severity: { type: 'string', required: true, enum: ['low', 'medium', 'high', 'critical'] },
      resource: { type: 'string', required: true },
      description: { type: 'string', required: true },
      remediation: { type: 'string' },
    },
  },

  migration_plan: {
    description:
      'A multi-phase migration plan. Use for sub-agents that produce structured runbooks (e.g., k8s upgrade, datacenter consolidation, schema migration).',
    fields: {
      phases: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', required: true },
            steps: { type: 'array', required: true },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  /** Parsed JSON if ok=true, raw input echoed if ok=false. */
  data?: unknown;
  /** Per-field error messages when ok=false. */
  errors?: string[];
}

function checkField(
  value: unknown,
  spec: SchemaField,
  path: string,
  errors: string[],
): void {
  if (value === undefined || value === null) {
    if (spec.required) errors.push(`${path}: required field missing`);
    return;
  }
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${typeof value}`);
        return;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        errors.push(`${path}: value '${value}' not in enum [${spec.enum.join(', ')}]`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${path}: expected finite number, got ${typeof value}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean, got ${typeof value}`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${typeof value}`);
        return;
      }
      if (spec.items && 'properties' in (spec.items as any)) {
        // Item spec is an object-shape map
        const itemSpec = spec.items as { properties: Record<string, SchemaField> };
        value.forEach((entry, i) => {
          if (typeof entry !== 'object' || entry === null) {
            errors.push(`${path}[${i}]: expected object, got ${typeof entry}`);
            return;
          }
          for (const [k, fieldSpec] of Object.entries(itemSpec.properties)) {
            checkField((entry as Record<string, unknown>)[k], fieldSpec, `${path}[${i}].${k}`, errors);
          }
        });
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`${path}: expected object, got ${typeof value}`);
        return;
      }
      if (spec.properties) {
        for (const [k, fieldSpec] of Object.entries(spec.properties)) {
          checkField((value as Record<string, unknown>)[k], fieldSpec, `${path}.${k}`, errors);
        }
      }
      break;
  }
}

/**
 * Validate a raw JSON string against one of the pre-registered schemas.
 * Returns `{ok:true, data}` on success or `{ok:false, errors}` on any
 * combination of parse failure, missing required fields, or type
 * mismatches. Multiple errors are accumulated — caller emits the full
 * list into the retry prompt so the model can fix all in one pass.
 */
export function validateTaskOutput(
  rawJson: string,
  schemaName: string,
): ValidationResult {
  const schema = taskOutputSchemas[schemaName];
  if (!schema) {
    return { ok: false, errors: [`unknown schema name '${schemaName}'`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return { ok: false, errors: [`JSON parse failed: ${(err as Error).message}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ['top-level value must be a JSON object'] };
  }
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(schema.fields)) {
    checkField((parsed as Record<string, unknown>)[name], spec, name, errors);
  }
  if (errors.length === 0) {
    return { ok: true, data: parsed };
  }
  return { ok: false, errors, data: parsed };
}

/**
 * Build the prompt directive a sub-agent should receive to coerce its
 * final message into a schema-conformant JSON object. Concatenated with
 * the rest of the sub-agent's instructions by TaskTool.
 */
export function buildSchemaDirective(schemaName: string): string {
  const schema = taskOutputSchemas[schemaName];
  if (!schema) return '';
  return [
    `Your final assistant message MUST be a single JSON object matching this shape:`,
    `Schema: ${schemaName} — ${schema.description}`,
    `Required fields and types:`,
    JSON.stringify(schema.fields, null, 2),
    `Do not wrap the JSON in markdown fences. Do not include prose before or after. Just the JSON object.`,
  ].join('\n');
}
