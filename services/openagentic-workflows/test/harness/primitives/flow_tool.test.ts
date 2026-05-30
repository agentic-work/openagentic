/**
 * flow_tool — Flows harness test.
 *
 * Verifies the sub-flow-as-tool primitive through the full
 * WorkflowExecutionEngine path: trigger → flow_tool → assert sub-flow
 * executed + parent extracted the value. Mocks prisma.workflow.findUnique
 * so the engine's executeSubWorkflow hook can resolve the wrapped
 * workflow id deterministically.
 *
 * Gap-analysis 2026-05-14 P0 #3. Reference: Langflow
 *   src/lfx/src/lfx/components/flow_controls/flow_tool.py
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

const TENANT = 't-harness-flow-tool';

const LEAF_DEFINITION = {
  nodes: [
    { id: 'leaf_trigger', type: 'trigger', data: { triggerType: 'manual' } },
    {
      id: 'leaf_response',
      type: 'webhook_response',
      data: {
        statusCode: 200,
        bodyTemplate:
          'summary={{trigger.body.time_window}}|namespace={{trigger.body.namespace}}',
      },
    },
  ],
  edges: [{ id: 'leaf_e1', source: 'leaf_trigger', target: 'leaf_response' }],
};

describe('flow_tool node — sub-flow as callable tool', () => {
  beforeEach(() => {
    Object.values(prisma as any).forEach((t: any) => {
      if (t && typeof t.findUnique?.mockReset === 'function') t.findUnique.mockReset();
    });
  });

  it('happy path: maps inputs, runs sub-flow, extracts value by dot path', async () => {
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue({
      id: 'wf-leaf-1',
      name: 'analyze_logs_leaf',
      definition: LEAF_DEFINITION,
    } as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ft',
            type: 'flow_tool',
            data: {
              flowId: 'wf-leaf-1',
              toolName: 'analyze_logs',
              toolDescription: 'Run the analyze_logs leaf flow.',
              inputMapping: {
                time_window: '{{trigger.body.time_window}}',
                namespace: '{{trigger.body.namespace}}',
              },
              outputExtract: 'body',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ft' }],
      },
      tenantId: TENANT,
      input: { body: { time_window: '15m', namespace: 'agentic-dev' } },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ft as {
      value: unknown;
      extracted: string;
      flowId: string;
      toolName: string;
      raw: unknown;
    };
    expect(out.flowId).toBe('wf-leaf-1');
    expect(out.toolName).toBe('analyze_logs');
    expect(out.extracted).toBe('body');
    // Single terminal node (webhook_response) → engine unwraps the per-node
    // envelope and returns the executor's output directly:
    // `{ statusCode, body, delivered, resolvedHeaders }`. We extract `body`.
    expect(out.value).toBe('summary=15m|namespace=agentic-dev');

    // Verify the engine resolved the wrapped flow via prisma — proves the
    // wire-up between flow_tool → ctx.executeSubWorkflow → prisma is live.
    // The engine also looks up the *parent* workflow id at startup (to load
    // workflow-level settings — `WorkflowExecutionEngine.ts:438`), so we
    // assert against any matching call rather than the first one.
    const calls = vi.mocked((prisma as any).workflow.findUnique).mock.calls;
    const subFlowLookup = calls.find(
      (c: unknown[]) =>
        (c[0] as { where?: { id?: string } })?.where?.id === 'wf-leaf-1',
    );
    expect(subFlowLookup).toBeDefined();
  });

  it('returns the full sub-flow output when outputExtract is empty', async () => {
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue({
      id: 'wf-leaf-2',
      name: 'echo_leaf',
      definition: LEAF_DEFINITION,
    } as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ft',
            type: 'flow_tool',
            data: {
              flowId: 'wf-leaf-2',
              inputMapping: {
                time_window: '{{trigger.body.time_window}}',
                namespace: '{{trigger.body.namespace}}',
              },
              // outputExtract omitted → return full output
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ft' }],
      },
      tenantId: TENANT,
      input: { body: { time_window: '5m', namespace: 'prod' } },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ft as { value: unknown; extracted: string };
    expect(out.extracted).toBe('');
    // Full sub-flow output: webhook_response returns the raw envelope.
    expect(out.value).toMatchObject({
      statusCode: 200,
      body: expect.any(String),
      delivered: true,
    });
  });

  it('emits node_error when flowId is missing', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ft',
            type: 'flow_tool',
            data: {
              // no flowId
              toolName: 'orphan',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ft' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/flowId|flow_tool/i);
  });

  it('emits node_error when sub-flow is not found in prisma', async () => {
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue(null as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ft',
            type: 'flow_tool',
            data: {
              flowId: 'wf-nonexistent',
              inputMapping: {},
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ft' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/not found|flow_tool|wf-nonexistent/i);
  });

  it('passes the full input through when inputMapping is empty', async () => {
    vi.mocked((prisma as any).workflow.findUnique).mockResolvedValue({
      id: 'wf-leaf-3',
      name: 'passthrough_leaf',
      definition: LEAF_DEFINITION,
    } as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ft',
            type: 'flow_tool',
            data: {
              flowId: 'wf-leaf-3',
              inputMapping: {},
              outputExtract: 'body',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ft' }],
      },
      tenantId: TENANT,
      input: { body: { time_window: '1h', namespace: 'kube-system' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.ft as { value: unknown };
    // Leaf webhook_response renders trigger.body.time_window + trigger.body.namespace,
    // so passing the full upstream input through (which contains `body`) lets the
    // template substitution find the same values.
    expect(out.value).toBe('summary=1h|namespace=kube-system');
  });
});
