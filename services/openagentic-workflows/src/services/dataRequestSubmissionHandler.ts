/**
 * dataRequestSubmissionHandler — the SUBMIT half of the flows "human_input" /
 * "request_data" HITL feature.
 *
 * The engine half (commit 199760e2) PAUSES a run, persists a
 * WorkflowDataRequest row, and emits a `needs_input` NDJSON frame. This module
 * is what lets a user (proxied by the api) submit their typed answers and
 * resume the run:
 *
 *   1. look up the pending WorkflowDataRequest row by requestId,
 *   2. validate the submitted `values` against the stored `fields[]`
 *      (required present, enum in options, basic type coercion),
 *   3. mark the row provided (status / values / provided_by / decided_at),
 *   4. re-enter the engine via resumeExecutionHandler with
 *        fromNodeId   = row.node_id
 *        resumeInput  = { status:'provided', values, providedBy, providedAt }
 *      so downstream `{{steps.<id>.output.values.<field>}}` resolves (the
 *      engine's resumeExecution() MERGES resumeInput into the node result).
 *
 * Sister of the HITL-approval resume path; the approval branch in index.ts is
 * left untouched and runs verbatim when a submission is NOT a data-request.
 *
 * ── Secret-field handling ────────────────────────────────────────────────
 * A field of type `secret` MUST NOT have its submitted value echoed into
 * execution data (nodeResults / output / the persisted `values` JSON). The
 * validator strips secret values from the engine-bound `values` and reports
 * the secret field names via `secretFields`. The persisted row stores a
 * redaction marker, not the raw secret. Full vault wiring (persisting the
 * secret into WorkflowSecretService and exposing it to the node as a
 * secret-ref) is a follow-up — see the TODO below. Until then we fail-safe:
 * the secret is acknowledged-as-provided but never lands in plaintext
 * anywhere downstream.
 */

import { resumeExecutionHandler, type ResumeExecutionInput } from './resumeExecutionHandler.js';
import type { ExecutionEvent } from './WorkflowExecutionEngine.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

// Redaction marker persisted in place of a secret value. Never the raw value.
const SECRET_REDACTION = '[secret:provided]';

export interface DataRequestField {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
  placeholder?: string;
  validation?: unknown;
}

export interface ValidateResult {
  ok: boolean;
  /** Coerced + redacted values safe to forward to the engine. */
  values?: Record<string, unknown>;
  /** Names of secret-typed fields that were provided (value redacted). */
  secretFields?: string[];
  error?: string;
}

/**
 * Validate `submitted` against the data-request `fields[]`.
 *
 *  - required field absent / blank → reject
 *  - enum value not in options     → reject
 *  - number field not coercible    → reject
 *  - boolean field                 → coerce "true"/"false"/1/0 → boolean
 *  - secret field                  → value REDACTED in the returned values
 *  - absent optional with default  → default applied
 *
 * Unknown extra keys are ignored (not forwarded) — only declared fields are
 * surfaced to the engine.
 */
export function validateDataRequestValues(
  fields: DataRequestField[],
  submitted: Record<string, unknown> | null | undefined,
): ValidateResult {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { ok: false, error: 'data request has no fields to validate against' };
  }
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    return { ok: false, error: 'submitted values must be an object keyed by field name' };
  }

  const out: Record<string, unknown> = {};
  const secretFields: string[] = [];

  for (const field of fields) {
    if (!field?.name) continue;
    const name = field.name;
    const type = (field.type || 'string').toLowerCase();
    const has = Object.prototype.hasOwnProperty.call(submitted, name);
    let raw = has ? submitted[name] : undefined;

    // Treat blank strings as "not provided" for required/default purposes.
    const isBlank =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim().length === 0);

    if (isBlank) {
      if (field.default !== undefined) {
        out[name] = field.default;
        continue;
      }
      if (field.required) {
        return { ok: false, error: `field '${name}' is required` };
      }
      // optional + absent + no default → omit entirely
      continue;
    }

    switch (type) {
      case 'number':
      case 'integer': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n)) {
          return { ok: false, error: `field '${name}' must be a number, got '${String(raw)}'` };
        }
        out[name] = type === 'integer' ? Math.trunc(n) : n;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') {
          out[name] = raw;
        } else {
          const s = String(raw).trim().toLowerCase();
          if (['true', '1', 'yes', 'on'].includes(s)) out[name] = true;
          else if (['false', '0', 'no', 'off'].includes(s)) out[name] = false;
          else return { ok: false, error: `field '${name}' must be a boolean, got '${String(raw)}'` };
        }
        break;
      }
      case 'enum':
      case 'select': {
        const opts = Array.isArray(field.options) ? field.options : [];
        const val = typeof raw === 'string' ? raw : String(raw);
        if (opts.length > 0 && !opts.includes(val)) {
          return {
            ok: false,
            error: `field '${name}' value '${val}' is not one of the allowed options: ${opts.join(', ')}`,
          };
        }
        out[name] = val;
        break;
      }
      case 'secret':
      case 'password': {
        // SECURITY: never echo a secret into execution data. We record that it
        // was provided but redact the value. Real secret persistence is a
        // follow-up (vault wiring) — see module TODO.
        secretFields.push(name);
        out[name] = SECRET_REDACTION;
        break;
      }
      default: {
        // string / text / freeform
        out[name] = typeof raw === 'string' ? raw : String(raw);
      }
    }
  }

  return { ok: true, values: out, secretFields };
}

// ──────────────────────────────────────────────────────────────────────────
// submitDataRequest — lookup + validate + persist + resume
// ──────────────────────────────────────────────────────────────────────────

export interface DataRequestSubmission {
  executionId: string;
  requestId: string;
  values: Record<string, unknown>;
  providedBy?: string;
  providedAt?: string;
}

export interface SubmitDataRequestResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** true when the requestId did not resolve to a row (→ HTTP 404). */
  notFound?: boolean;
  /** true when validation/state rejected the submission (→ HTTP 400). */
  invalid?: boolean;
}

/** Minimal prisma surface the handler needs — injectable for unit tests. */
export interface DataRequestPrisma {
  workflowDataRequest: {
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  workflowExecution: {
    findUnique(args: any): Promise<any>;
  };
}

export interface SubmitDataRequestDeps {
  prisma: DataRequestPrisma;
  /** Defaults to the real resumeExecutionHandler; injectable for tests. */
  resume?: (payload: ResumeExecutionInput, onEvent: (e: ExecutionEvent) => void) => Promise<{ success: boolean; output: any; error?: string }>;
  now?: () => Date;
}

export async function submitDataRequest(
  submission: DataRequestSubmission,
  deps: SubmitDataRequestDeps,
  onEvent: (event: ExecutionEvent) => void,
): Promise<SubmitDataRequestResult> {
  const prisma = deps.prisma;
  const resume = deps.resume ?? resumeExecutionHandler;
  const now = deps.now ?? (() => new Date());

  const { executionId, requestId, values, providedBy, providedAt } = submission;

  if (!requestId) {
    return { success: false, invalid: true, error: 'requestId is required' };
  }

  // 1. Look up the request row.
  const row = await prisma.workflowDataRequest.findUnique({ where: { id: requestId } });
  if (!row) {
    return { success: false, notFound: true, error: `data request '${requestId}' not found` };
  }

  // Guard: the request must belong to the claimed execution.
  if (executionId && row.execution_id && row.execution_id !== executionId) {
    return {
      success: false,
      invalid: true,
      error: `data request '${requestId}' does not belong to execution '${executionId}'`,
    };
  }

  // Guard: only a pending request can be answered.
  if (row.status && row.status !== 'pending') {
    return {
      success: false,
      invalid: true,
      error: `data request '${requestId}' is already '${row.status}', expected 'pending'`,
    };
  }

  // 2. Validate the submitted values against the stored fields[].
  const fields = Array.isArray(row.fields) ? (row.fields as DataRequestField[]) : [];
  const validation = validateDataRequestValues(fields, values);
  if (!validation.ok) {
    return { success: false, invalid: true, error: validation.error };
  }
  const safeValues = validation.values || {};
  const secretFields = validation.secretFields || [];

  // 3. Mark the row provided. Persisted `values` are the redacted/coerced set —
  //    a secret-typed value is stored as the redaction marker, never plaintext.
  const decidedAt = now();
  if (secretFields.length > 0) {
    // TODO(secret-vault): persist the raw secret into WorkflowSecretService and
    // expose a secret-ref to the resumed node. WorkflowSecretService is not
    // wired into this microservice yet; until it is we fail-SAFE by redacting
    // the value everywhere (row + engine) rather than risk plaintext leakage.
    logger.warn(
      { requestId, executionId, secretFields },
      '[dataRequestSubmission] secret field(s) provided — value redacted from execution data (vault wiring TODO)',
    );
  }
  await prisma.workflowDataRequest.update({
    where: { id: requestId },
    data: {
      status: 'provided',
      values: safeValues as unknown,
      provided_by: providedBy ?? null,
      decided_at: decidedAt,
    },
  });

  // 4. Hydrate the saved execution state + definition and resume the engine
  //    from the request's node with the canonical resumeInput shape that the
  //    engine's resumeExecution() merge-path expects.
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: row.execution_id },
    include: { version: true },
  });
  if (!execution) {
    return { success: false, error: `execution '${row.execution_id}' not found for data request '${requestId}'` };
  }

  const definition = execution.version?.definition;
  if (!definition?.nodes?.length) {
    return { success: false, error: `no workflow definition found for execution '${row.execution_id}'` };
  }

  // The engine persisted the suspend-time snapshot under execution.state; the
  // data-request row's context_data is the fallback (it captured input +
  // nodeResults at requestData() time).
  const state = (execution.state && typeof execution.state === 'object' ? execution.state : {}) as Record<string, any>;
  const ctx = (row.context_data && typeof row.context_data === 'object' ? row.context_data : {}) as Record<string, any>;

  const resumePayload: ResumeExecutionInput = {
    workflowId: execution.workflow_id,
    executionId: row.execution_id,
    definition,
    fromNodeId: row.node_id,
    resumeInput: {
      status: 'provided',
      values: safeValues,
      providedBy: providedBy ?? null,
      providedAt: providedAt ?? decidedAt.toISOString(),
    },
    state: {
      input: state.input ?? ctx.input ?? {},
      variables: state.variables ?? {},
      nodeResults: state.nodeResults ?? ctx.nodeResults ?? {},
      startTimeMs: execution.started_at?.getTime?.() ?? Date.now(),
    },
    userId: execution.started_by || '',
    tenantId: execution.tenant_id ?? row.tenant_id ?? null,
  };

  try {
    const result = await resume(resumePayload, onEvent);
    return { success: !!result.success, output: result.output, error: result.error };
  } catch (err: any) {
    logger.error(
      { err: err.message, requestId, executionId: row.execution_id, nodeId: row.node_id },
      '[dataRequestSubmission] engine threw during resume',
    );
    return { success: false, error: err.message || 'engine threw during resume' };
  }
}

/**
 * Discriminate whether a /resume-execution body is a data-request submission
 * (vs the legacy HITL-approval resume that carries definition + fromNodeId +
 * state). A data-request submission is identified by an explicit
 * `kind: 'data_request'` OR by the presence of `requestId` with NO
 * pre-serialized `state`/`definition` (the approval path always carries those).
 */
export function isDataRequestSubmission(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  if (body.kind === 'data_request') return true;
  if (body.kind === 'approval') return false;
  return (
    typeof body.requestId === 'string' &&
    body.requestId.length > 0 &&
    !body.definition &&
    !body.state
  );
}
