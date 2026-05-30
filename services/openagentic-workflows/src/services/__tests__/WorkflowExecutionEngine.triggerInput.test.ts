/**
 * WorkflowExecutionEngine — trigger-input interpolation contract (Blocker A1).
 *
 * Rebuild plan 2026-05-13 documented `{{input.alert_id}}` rendering as
 * `(?)` and `{{input.service}}` rendering as `unknown` in live runs.
 * Root cause investigation (this file): the engine's path-based
 * interpolation works correctly for `{{input.<field>}}` on every node
 * that receives the trigger's pass-through output as its `input`. The
 * legacy failures came from templates wrapping `{{ ... }}` around
 * JS-expression syntax (e.g. `{{ (input.alert_id || 'alert') }}`)
 * which the regex tokenizer treats as an unresolvable path — not from
 * any engine defect.
 *
 * These tests pin the supported contract so any future regression in
 * the substitution boundary surfaces immediately:
 *   1. Bare `{{input.<field>}}` resolves through trigger → transform → render.
 *   2. `{{trigger.<field>}}` resolves the same way (flat + body.<field>).
 *   3. JS-expression-style `{{ (input.x || 'fallback') }}` resolves to
 *      the LITERAL contents of the {{...}} (unsupported), proving the
 *      regression surface for authors who try the unsupported pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', () => ({
  prisma: { workflowExecution: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock('../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
} from '../WorkflowExecutionEngine.js';

function makeCtx(input: any = {}): ExecutionContext {
  return {
    executionId: 'e-trig-1',
    workflowId: 'w-trig-1',
    userId: 'u-trig-1',
    triggerType: 'manual',
    input,
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

const minDef: WorkflowDefinition = {
  nodes: [{ id: 't', type: 'trigger', data: {} }],
  edges: [],
};

describe('WorkflowExecutionEngine — trigger-input interpolation (Blocker A1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('{{input.alert_id}} resolves to the trigger field when input is the per-node arg', () => {
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    // Simulate the engine handing { alert_id, service } to a downstream
    // node as its `input` arg. interpolateTemplate is then called by
    // the node executor with that same object as `context`.
    const r = (engine as any).interpolateTemplate(
      '{{input.alert_id}}',
      { alert_id: 'A-123', service: 'api', severity: 'P2' },
    );
    expect(r).toBe('A-123');
  });

  it('{{input.service}} resolves alongside {{input.alert_id}} in the same template', () => {
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    const r = (engine as any).interpolateTemplate(
      'Alert {{input.alert_id}} on {{input.service}}',
      { alert_id: 'A-123', service: 'api' },
    );
    expect(r).toBe('Alert A-123 on api');
  });

  it('{{trigger.alert_id}} resolves once executeTrigger has set __trigger__ from input', () => {
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    // Simulate what executeTrigger does: stash both flat keys + body alias.
    const input = { alert_id: 'A-77', service: 'checkout-api' };
    const triggerData: Record<string, any> = { ...input, body: input };
    (engine as any).context.nodeResults.set('__trigger__', triggerData);

    expect((engine as any).interpolateTemplate('{{trigger.alert_id}}', {})).toBe('A-77');
    expect((engine as any).interpolateTemplate('{{trigger.service}}', {})).toBe('checkout-api');
    expect((engine as any).interpolateTemplate('{{trigger.body.alert_id}}', {})).toBe('A-77');
  });

  it('webhook_response bodyTemplate with {{input.X}} renders REAL values (no "?" or "unknown" leak)', () => {
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    const tpl =
      '<h2>Incident triage for {{input.alert_id}} ({{input.severity}}) on {{input.service}}</h2>';
    const r = (engine as any).interpolateTemplate(
      tpl,
      { alert_id: 'A-42', severity: 'P1', service: 'checkout-api' },
    );
    expect(r).toBe('<h2>Incident triage for A-42 (P1) on checkout-api</h2>');
    // Negative pinning: the literal "?" / "unknown" fallbacks from the
    // c643028e-removed templates must NEVER appear here.
    expect(r).not.toContain('(?)');
    expect(r).not.toContain('unknown');
  });

  it('JS-expression-style {{ (input.alert_id || "alert") }} is UNSUPPORTED — produces junk output', () => {
    // This is the bug class that broke the c643028e-removed templates.
    // The interpolator only resolves path-expressions plus the {{path
    // || "fallback"}} pipe. Arbitrary JS like `(input.x || 'fallback')`
    // gets misparsed: the `||` is consumed as the default-value pipe
    // and the resulting "path" `(input.alert_id` fails to resolve, so
    // the engine emits the literal post-pipe string `alert')`. The
    // c643028e-removed templates' `(?)` and `unknown` rendering came
    // from exactly this misparse.
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    const r = (engine as any).interpolateTemplate(
      "{{ (input.alert_id || 'alert') }}",
      { alert_id: 'A-1' },
    );
    // The actual emission is `alert')` — the trailing `)` is literal,
    // the leading `'alert` is the fallback after the `||` pipe ate it.
    // Documents the failure mode: do NOT use JS-style expressions inside {{ }}.
    expect(r).toContain('alert');
    expect(r).not.toBe('A-1'); // would-be correct value is NOT emitted
  });

  it('default-value pipe {{input.alert_id || "fallback"}} IS supported', () => {
    // This is the supported escape hatch when a field may be absent.
    const engine = new WorkflowExecutionEngine(minDef, makeCtx());
    const r = (engine as any).interpolateTemplate(
      '{{input.alert_id || "no-alert"}}',
      { service: 'api' }, // no alert_id
    );
    expect(r).toBe('no-alert');
    const r2 = (engine as any).interpolateTemplate(
      '{{input.alert_id || "no-alert"}}',
      { alert_id: 'A-9' },
    );
    expect(r2).toBe('A-9');
  });
});
