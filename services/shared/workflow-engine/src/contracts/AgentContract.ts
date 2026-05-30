/**
 * AgentContract — typed input/output/toolFlow contracts (Pillar 3).
 *
 * Each registered agent in prisma.agent declares an AgentContract.
 * The agent runner consults it at three points:
 *
 *   1. validateAgentInput  — before LLM tokens are spent
 *   2. validateAgentOutput — before propagating to downstream nodes
 *   3. guardToolCall       — at the tool-dispatch boundary
 *
 * Schema dialect intentionally thin (a strict subset of JSON Schema):
 *   - type ∈ string|number|boolean|object|array
 *   - object: required[] + properties{}
 *   - array: items
 *   - enum (only on string|number primitives)
 *
 * Anything beyond that is YAGNI. If the agent author needs deeper
 * validation, that's what the agent's own LLM checks are for.
 */

export interface JsonSchemaLike {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: string[];
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  enum?: Array<string | number>;
}

export interface AgentContract {
  /** Optional input schema — undefined means caller can send anything. */
  input?: JsonSchemaLike;
  /** Optional output schema — undefined means agent can return anything. */
  output?: JsonSchemaLike;
  /**
   * Whitelist of tool names the agent is allowed to invoke. `["*"]` is
   * an explicit escape hatch for "trust this agent with everything"
   * (used by the supervisor agent during fan-out). Empty array blocks
   * all tools — useful for pure-LLM agents that should not call out.
   */
  allowedTools: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** Human-readable error messages — one per violation, dotted-path style. */
  errors: string[];
}

export interface ToolGuardResult {
  allowed: boolean;
  reason?: string;
}

export function validateAgentInput(
  contract: AgentContract,
  data: unknown,
): ValidationResult {
  if (!contract.input) return { ok: true, errors: [] };
  const errors: string[] = [];
  validate(contract.input, data, '', errors);
  return { ok: errors.length === 0, errors };
}

export function validateAgentOutput(
  contract: AgentContract,
  data: unknown,
): ValidationResult {
  if (!contract.output) return { ok: true, errors: [] };
  const errors: string[] = [];
  validate(contract.output, data, '', errors);
  return { ok: errors.length === 0, errors };
}

export function guardToolCall(
  contract: AgentContract,
  toolName: string,
): ToolGuardResult {
  if (contract.allowedTools.includes('*')) return { allowed: true };
  if (contract.allowedTools.includes(toolName)) return { allowed: true };
  return {
    allowed: false,
    reason: `Tool "${toolName}" is not allowed by this agent's contract (allowedTools=${JSON.stringify(contract.allowedTools)}).`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Recursive validator — mutates `errors` in place.
// ─────────────────────────────────────────────────────────────────────

function validate(
  schema: JsonSchemaLike,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path || '<root>'}: expected string, got ${typeOf(value)}`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path || '<root>'}: enum mismatch — got "${value}", expected one of ${JSON.stringify(schema.enum)}`);
    }
    return;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(`${path || '<root>'}: expected number, got ${typeOf(value)}`);
      return;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path || '<root>'}: enum mismatch — got ${value}, expected one of ${JSON.stringify(schema.enum)}`);
    }
    return;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean')
      errors.push(`${path || '<root>'}: expected boolean, got ${typeOf(value)}`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path || '<root>'}: expected array, got ${typeOf(value)}`);
      return;
    }
    if (schema.items) {
      value.forEach((item, idx) => {
        validate(schema.items!, item, `${path}[${idx}]`, errors);
      });
    }
    return;
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path || '<root>'}: expected object, got ${typeOf(value)}`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const req of schema.required || []) {
      if (!(req in obj)) {
        errors.push(`${path ? `${path}.` : ''}${req}: required field missing`);
      }
    }
    for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
      if (propName in obj) {
        validate(propSchema, obj[propName], `${path ? `${path}.` : ''}${propName}`, errors);
      }
    }
    return;
  }
  // No type annotation → accept anything.
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
