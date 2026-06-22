/**
 * human_input node executor (alias: request_data).
 *
 * The HITL DATA-REQUEST primitive: pause the workflow, emit a typed form to
 * the user, resume with their answers. This is the sibling of human_approval
 * — it reuses the SAME pause/persist/resume substrate, but collects typed
 * VALUES instead of an approve/reject decision.
 *
 * Flow:
 *   1. The executor validates the configured fields[] and interpolates the
 *      title/description templates.
 *   2. It delegates to the engine-wired ctx.requestData hook, which:
 *        createDataRequestRecord → workflowExecution.update(awaiting_input)
 *        → emitEvent('needs_input', { requestId, nodeId, title, fields }).
 *   3. It returns `{ status: 'awaiting_input', requestId, fields, ... }`.
 *      The engine's pause logic recognises `awaiting_input` (mirror of the
 *      `awaiting_approval` pause check), emits `execution_paused`, and stops
 *      downstream execution.
 *   4. On resume, POST /resume-execution carries `{ values }`; the engine
 *      merges that into this node's result so downstream nodes resolve
 *      `{{steps.<id>.output.values.<fieldName>}}`.
 *
 * Mirrors human_approval/executor.ts. The schema-level outputAssertion only
 * checks `non_empty_fields` because `awaiting_input` is a legitimate paused
 * state — asserting on `status === 'provided'` would treat every paused
 * request as a fake-success failure.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export interface HumanInputField {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'enum' | 'secret' | 'boolean' | 'file' | 'date' | 'json';
  required?: boolean;
  options?: string[];
  default?: unknown;
  placeholder?: string;
  validation?: string | { min?: number; max?: number };
}

function normalizeFields(raw: unknown): HumanInputField[] {
  if (!Array.isArray(raw)) return [];
  const out: HumanInputField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const name = (f as any).name;
    if (typeof name !== 'string' || name.length === 0) continue;
    const type = (f as any).type;
    out.push({
      name,
      label: typeof (f as any).label === 'string' ? (f as any).label : name,
      type: (typeof type === 'string' ? type : 'string') as HumanInputField['type'],
      required: (f as any).required === true,
      options: Array.isArray((f as any).options) ? (f as any).options : undefined,
      default: (f as any).default,
      placeholder: typeof (f as any).placeholder === 'string' ? (f as any).placeholder : undefined,
      validation: (f as any).validation,
    });
  }
  return out;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) {
    throw new Error('aborted');
  }

  const data = (node.data || {}) as Record<string, any>;

  const fields = normalizeFields(data.fields);
  if (fields.length === 0) {
    // Surfaced by the schema-level non_empty_fields assertion too, but fail
    // fast with a clear message rather than emitting a blank form.
    throw new Error(
      `human_input node "${node.id}" has no valid fields[] — configure at least one { name, type } field`,
    );
  }

  const timeoutSeconds: number = Number.isFinite(data.timeout) ? Number(data.timeout) : 86400;
  const timeoutAction: string =
    data.timeoutAction === 'use_default' ? 'use_default' : 'fail';
  const assignTo: string[] = Array.isArray(data.assignTo) ? data.assignTo : [];
  const channel: string =
    typeof data.channel === 'string' && data.channel.length > 0 ? data.channel : 'chat';

  // 'use_default' is only safe if every required field actually has a default,
  // otherwise a timeout would resume with a missing required value. Fail-closed.
  if (timeoutAction === 'use_default') {
    const missing = fields.filter((f) => f.required && f.default === undefined).map((f) => f.name);
    if (missing.length > 0) {
      throw new Error(
        `human_input node "${node.id}" uses timeoutAction='use_default' but required field(s) ${missing.join(', ')} have no default`,
      );
    }
  }

  const title =
    typeof data.title === 'string'
      ? ctx.interpolateTemplate(data.title, input)
      : 'Additional information needed';
  const description =
    typeof data.description === 'string' ? ctx.interpolateTemplate(data.description, input) : '';

  if (!ctx.requestData) {
    throw new Error(
      'human_input node requires ctx.requestData hook — engine is not wired correctly',
    );
  }

  ctx.logger.info(
    { nodeId: node.id, fieldCount: fields.length, timeoutSeconds, channel },
    '[human_input] Pausing workflow to request data from user',
  );

  const request = await ctx.requestData({
    nodeId: node.id,
    fields: fields as unknown as Array<Record<string, unknown>>,
    title,
    description,
    timeoutSeconds,
    timeoutAction,
    assignTo,
    channel,
    input,
  });

  return {
    status: 'awaiting_input',
    requestId: request.id,
    fields,
    title,
    description,
    expiresAt: request.timeout_at,
  };
}
