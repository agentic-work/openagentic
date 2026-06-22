/**
 * P0b sev-0: pod-env exfil via {{env.X}} template is BLOCKED.
 *
 * Sister fix to the workflows-service interpolation patch. The api also
 * runs WorkflowExecutionEngine, and prior to this commit its
 * interpolateTemplate had the same `?? process.env[envVar]` fallback.
 * Any workflow author could write {{env.WORKFLOW_SECRET_KEY}} or
 * {{env.AWS_SECRET_ACCESS_KEY}} into a node field and the engine would
 * paste the pod env var into the rendered output. Audit
 * AUDIT-2026-05-03 sev-0. Fix: env.X resolves only via the engine-
 * controlled context.variables allow-list; process.env is never read.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

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
} from './WorkflowExecutionEngine.js';

const minimalDef: WorkflowDefinition = {
  nodes: [{ id: 't', type: 'trigger', data: {} }],
  edges: [],
};

function makeCtx(): ExecutionContext {
  return {
    executionId: 'e-1',
    workflowId: 'w-1',
    userId: 'u-1',
    triggerType: 'manual',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

const interp = (engine: WorkflowExecutionEngine, tpl: string) =>
  (engine as any).interpolateTemplate(tpl, {}) as string;

describe('api WorkflowExecutionEngine — env exfil blocked (P0b)', () => {
  const ORIGINAL_SECRET = process.env.WORKFLOW_SECRET_KEY;
  const ORIGINAL_AWS = process.env.AWS_SECRET_ACCESS_KEY;
  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.WORKFLOW_SECRET_KEY;
    else process.env.WORKFLOW_SECRET_KEY = ORIGINAL_SECRET;
    if (ORIGINAL_AWS === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = ORIGINAL_AWS;
  });

  it('blocks {{env.WORKFLOW_SECRET_KEY}}', () => {
    process.env.WORKFLOW_SECRET_KEY = 'master-key-leak-test';
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
    const r = interp(engine, '{{env.WORKFLOW_SECRET_KEY}}');
    expect(r).toBe('');
    expect(r).not.toContain('master-key-leak-test');
  });

  it('blocks {{env.AWS_SECRET_ACCESS_KEY}}', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret-leak-test';
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
    const r = interp(engine, '{{env.AWS_SECRET_ACCESS_KEY}}');
    expect(r).toBe('');
  });

  it('blocks any arbitrary {{env.X}}', () => {
    process.env.WF_API_TEST_VAR = 'hello-from-pod-env';
    try {
      const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
      const r = interp(engine, '{{env.WF_API_TEST_VAR}}');
      expect(r).toBe('');
    } finally {
      delete process.env.WF_API_TEST_VAR;
    }
  });

  it('still honors explicit context.variables seeding under env.* (allow-list)', () => {
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
    (engine as any).context.variables.set('env.MY_ALLOWED_VAR', 'explicit-allow');
    const r = interp(engine, '{{env.MY_ALLOWED_VAR}}');
    expect(r).toBe('explicit-allow');
  });

  it('returns empty string on unset env var (no leaked template literal)', () => {
    delete process.env.WF_DEFINITELY_UNSET_VAR;
    const engine = new WorkflowExecutionEngine(minimalDef, makeCtx());
    const r = interp(engine, '{{env.WF_DEFINITELY_UNSET_VAR}}');
    expect(r).toBe('');
  });
});
