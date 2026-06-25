/**
 * dataRequestSubmissionHandler — TDD for the workflows-svc POST
 * /resume-execution `data_request` branch.
 *
 * The flows "human_input"/"request_data" HITL feature pauses a run, persists a
 * WorkflowDataRequest row + emits a `needs_input` frame. This handler is the
 * SUBMIT half: a user (proxied by the api) supplies their typed `values`; we
 *   1. look up the pending WorkflowDataRequest row,
 *   2. validate `values` against the stored `fields[]` (required present, enum
 *      in options, basic type coercion, NO unknown fields silently dropped on
 *      required),
 *   3. mark the row provided (status/values/provided_by/decided_at),
 *   4. re-enter the engine via resumeExecutionHandler with
 *      fromNodeId = row.node_id and
 *      resumeInput = { status:'provided', values, providedBy, providedAt }.
 *
 * The handler is testable as a pure function: prisma + resumeExecutionHandler
 * are injected so we assert wiring without a DB or a real engine run.
 *
 * Secret-field rule: a field of type `secret` must NEVER have its submitted
 * value echoed into the engine's resumeInput/nodeResults (no secret in
 * execution data). The handler redacts secret values from the resumeInput it
 * passes to the engine while still persisting acknowledgement that the field
 * was provided.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateDataRequestValues,
  submitDataRequest,
  type DataRequestField,
} from '../dataRequestSubmissionHandler.js';

// ──────────────────────────────────────────────────────────────────────────
// validateDataRequestValues — pure field validation
// ──────────────────────────────────────────────────────────────────────────
describe('validateDataRequestValues', () => {
  const fields: DataRequestField[] = [
    { name: 'schema', label: 'Schema', type: 'enum', required: true, options: ['sales', 'marketing'] },
    { name: 'limit', label: 'Row limit', type: 'number', required: false },
    { name: 'dry_run', label: 'Dry run', type: 'boolean', required: false },
    { name: 'note', label: 'Note', type: 'string', required: false },
  ];

  it('accepts a valid submission and coerces basic types', () => {
    const r = validateDataRequestValues(fields, { schema: 'sales', limit: '25', dry_run: 'true', note: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ schema: 'sales', limit: 25, dry_run: true, note: 'hi' });
  });

  it('rejects when a required field is missing', () => {
    const r = validateDataRequestValues(fields, { limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/schema/);
    expect(r.error).toMatch(/required/i);
  });

  it('rejects when a required field is an empty string', () => {
    const r = validateDataRequestValues(fields, { schema: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/schema/);
  });

  it('rejects an enum value not in options', () => {
    const r = validateDataRequestValues(fields, { schema: 'finance' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/finance/);
    expect(r.error).toMatch(/sales|marketing|option/i);
  });

  it('rejects a non-numeric number field', () => {
    const r = validateDataRequestValues(fields, { schema: 'sales', limit: 'lots' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit/);
  });

  it('rejects when values is not an object', () => {
    const r = validateDataRequestValues(fields, null as any);
    expect(r.ok).toBe(false);
  });

  it('rejects when fields[] is empty / missing', () => {
    const r = validateDataRequestValues([], { schema: 'sales' });
    expect(r.ok).toBe(false);
  });

  it('keeps a default for an absent optional field when the field declares one', () => {
    const withDefault: DataRequestField[] = [
      { name: 'schema', type: 'enum', required: true, options: ['sales'] },
      { name: 'limit', type: 'number', required: false, default: 100 },
    ];
    const r = validateDataRequestValues(withDefault, { schema: 'sales' });
    expect(r.ok).toBe(true);
    expect(r.values!.limit).toBe(100);
  });

  it('redacts secret-typed field values from the engine-bound values', () => {
    const withSecret: DataRequestField[] = [
      { name: 'token', type: 'secret', required: true },
      { name: 'schema', type: 'enum', required: true, options: ['sales'] },
    ];
    const r = validateDataRequestValues(withSecret, { token: 's3cr3t', schema: 'sales' });
    expect(r.ok).toBe(true);
    // The validated values surface non-secret fields verbatim …
    expect(r.values!.schema).toBe('sales');
    // … but the secret value MUST NOT be echoed into engine-bound data.
    expect(r.values!.token).not.toBe('s3cr3t');
    // The secret field name is reported so the caller knows it was provided.
    expect(r.secretFields).toContain('token');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// submitDataRequest — lookup + validate + persist + resume
// ──────────────────────────────────────────────────────────────────────────
describe('submitDataRequest', () => {
  const NOW = new Date('2026-05-31T12:00:00Z');

  function makePrisma(row: any) {
    return {
      workflowDataRequest: {
        findUnique: vi.fn().mockResolvedValue(row),
        update: vi.fn().mockResolvedValue({ ...row, status: 'provided' }),
      },
      workflowExecution: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'exec-1',
          workflow_id: 'wf-1',
          started_by: 'owner-1',
          started_at: NOW,
          tenant_id: 'tnt-1',
          state: { input: { foo: 'bar' }, variables: { v: 1 }, nodeResults: { trigger: { ok: true } } },
          version: {
            definition: {
              nodes: [
                { id: 'trigger', type: 'trigger', data: {} },
                { id: 'hi', type: 'human_input', data: {} },
                { id: 'pt', type: 'prompt_template', data: {} },
              ],
              edges: [
                { id: 'e1', source: 'trigger', target: 'hi' },
                { id: 'e2', source: 'hi', target: 'pt' },
              ],
            },
          },
        }),
      },
    };
  }

  const baseRow = {
    id: 'dr-1',
    execution_id: 'exec-1',
    node_id: 'hi',
    status: 'pending',
    tenant_id: 'tnt-1',
    fields: [
      { name: 'schema', type: 'enum', required: true, options: ['sales', 'marketing'] },
    ],
    context_data: { input: { foo: 'bar' }, nodeResults: { trigger: { ok: true } } },
  };

  let resumeSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resumeSpy = vi.fn().mockResolvedValue({ success: true, output: { done: true } });
  });

  it('looks up the row, validates, marks it provided, and resumes from node_id', async () => {
    const prisma = makePrisma(baseRow);
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'dr-1', values: { schema: 'sales' }, providedBy: 'u-1', providedAt: NOW.toISOString() },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );

    expect(result.success).toBe(true);

    // Row marked provided.
    expect(prisma.workflowDataRequest.update).toHaveBeenCalledOnce();
    const updateArg = prisma.workflowDataRequest.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'dr-1' });
    expect(updateArg.data.status).toBe('provided');
    expect(updateArg.data.values).toEqual({ schema: 'sales' });
    expect(updateArg.data.provided_by).toBe('u-1');
    expect(updateArg.data.decided_at).toEqual(NOW);

    // Engine resumed from the request's node with the canonical resumeInput.
    expect(resumeSpy).toHaveBeenCalledOnce();
    const payload = resumeSpy.mock.calls[0][0];
    expect(payload.fromNodeId).toBe('hi');
    expect(payload.executionId).toBe('exec-1');
    expect(payload.resumeInput).toMatchObject({ status: 'provided', values: { schema: 'sales' }, providedBy: 'u-1' });
    // State hydrated from the execution row.
    expect(payload.state.input).toEqual({ foo: 'bar' });
    expect(payload.state.nodeResults).toMatchObject({ trigger: { ok: true } });
    // Tenant carried through.
    expect(payload.tenantId).toBe('tnt-1');
  });

  it('rejects (no resume, no mark-provided) when validation fails', async () => {
    const prisma = makePrisma(baseRow);
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'dr-1', values: { schema: 'finance' }, providedBy: 'u-1' },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finance|option/i);
    expect(prisma.workflowDataRequest.update).not.toHaveBeenCalled();
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('404s when the request row does not exist', async () => {
    const prisma = makePrisma(null);
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'missing', values: { schema: 'sales' }, providedBy: 'u-1' },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );
    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('rejects a row that is already provided (not pending)', async () => {
    const prisma = makePrisma({ ...baseRow, status: 'provided' });
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'dr-1', values: { schema: 'sales' }, providedBy: 'u-1' },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already|provided|pending/i);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('rejects when the requestId belongs to a different execution', async () => {
    const prisma = makePrisma({ ...baseRow, execution_id: 'exec-OTHER' });
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'dr-1', values: { schema: 'sales' }, providedBy: 'u-1' },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/execution/i);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it('never persists or forwards a secret-typed field value into engine data', async () => {
    const secretRow = {
      ...baseRow,
      fields: [
        { name: 'token', type: 'secret', required: true },
        { name: 'schema', type: 'enum', required: true, options: ['sales'] },
      ],
    };
    const prisma = makePrisma(secretRow);
    const result = await submitDataRequest(
      { executionId: 'exec-1', requestId: 'dr-1', values: { token: 'TOPSECRET', schema: 'sales' }, providedBy: 'u-1' },
      { prisma: prisma as any, resume: resumeSpy, now: () => NOW },
      () => {},
    );
    expect(result.success).toBe(true);

    // Persisted values must not contain the raw secret.
    const persisted = JSON.stringify(prisma.workflowDataRequest.update.mock.calls[0][0].data.values);
    expect(persisted).not.toContain('TOPSECRET');

    // Engine resumeInput must not carry the raw secret either.
    const resumePayload = JSON.stringify(resumeSpy.mock.calls[0][0]);
    expect(resumePayload).not.toContain('TOPSECRET');
  });
});
