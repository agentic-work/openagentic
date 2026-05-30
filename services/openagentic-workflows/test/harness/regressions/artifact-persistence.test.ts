/**
 * Regression: webhook_response persists its rendered body as an artifact
 * when `persistAsArtifact: true` is set on the node.
 *
 * Closes the artifacts-in-flows gap from 2026-05-14 — the workflow-engine
 * has no `render_artifact` / `compose_visual` node types (those exist only
 * on the chat path). The cleanest "flow produces an artifact" surface is
 * `webhook_response` since every existing AIOps template already terminates
 * there with a rendered HTML body.
 *
 * Contract pinned here:
 *
 *   1. `persistAsArtifact: true` → executor calls `ctx.persistArtifact`
 *      with the resolved body + mime type + title.
 *   2. Default (`persistAsArtifact` absent / false) → no persist call,
 *      backward compat with every existing flow.
 *   3. `artifactTitle` template is interpolated against the input.
 *   4. `artifactKind: 'html_report'` is forwarded so the artifacts library
 *      can render the right preview.
 *   5. The executor return shape gains `artifactId` when persistence ran.
 *   6. Engine wiring: when persistArtifact hook fires, prisma.artifactFile.create
 *      lands a row keyed on the engine's `userId` (matches the artifacts
 *      list endpoint's `where: { user_id }` filter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

describe('webhook_response — artifact persistence (persistAsArtifact flag)', () => {
  beforeEach(() => {
    vi.mocked((prisma as any).artifactFile.create).mockReset();
    vi.mocked((prisma as any).artifactFile.create).mockImplementation(
      async ({ data }: any) => ({ ...data }),
    );
  });

  it('persistAsArtifact:true → ctx.persistArtifact called with body + interpolated title', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'report',
            type: 'webhook_response',
            data: {
              statusCode: 200,
              headers: '{"Content-Type":"text/html"}',
              bodyTemplate:
                '<div class="pod-health-report"><h2>K8s Pod Health — {{namespace}}</h2></div>',
              persistAsArtifact: true,
              artifactTitle: 'K8s Pod Health Report — {{namespace}}',
              artifactKind: 'html_report',
              artifactTags: ['aiops', 'k8s'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'report' }],
      },
      input: { namespace: 'agentic-dev' },
      userId: 'harness-user-42',
    });

    expect(result.status).toBe('completed');

    // The engine must have wired persistArtifact → prisma.artifactFile.create.
    const createMock = vi.mocked((prisma as any).artifactFile.create);
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0][0] as { data: Record<string, any> };
    expect(args.data.user_id).toBe('harness-user-42');
    expect(args.data.title).toBe('K8s Pod Health Report — agentic-dev');
    expect(args.data.mime_type).toBe('text/html');
    // Tags include the user-specified tags AND the artifactKind (so the
    // artifacts library can filter by kind via the tag dimension).
    expect(args.data.tags).toEqual(
      expect.arrayContaining(['aiops', 'k8s', 'html_report']),
    );
    expect(typeof args.data.extracted_text).toBe('string');
    expect(args.data.extracted_text).toContain(
      '<h2>K8s Pod Health — agentic-dev</h2>',
    );
    expect(typeof args.data.file_size).toBe('number');
    expect(args.data.file_size).toBeGreaterThan(0);

    // Executor result envelope surfaces artifactId for downstream chaining.
    const out = result.outputs.report as { artifactId?: string; body?: string };
    expect(typeof out.artifactId).toBe('string');
    expect(out.artifactId).toMatch(/^artifact_/);
  });

  it('persistAsArtifact omitted → no persist call (backward compat)', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'report',
            type: 'webhook_response',
            data: {
              statusCode: 200,
              bodyTemplate: '{"ok":true}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'report' }],
      },
      input: {},
      userId: 'harness-user-43',
    });

    expect(result.status).toBe('completed');
    expect(vi.mocked((prisma as any).artifactFile.create)).not.toHaveBeenCalled();
    const out = result.outputs.report as { artifactId?: string };
    expect(out.artifactId).toBeUndefined();
  });

  it('persistAsArtifact:false → no persist call', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'report',
            type: 'webhook_response',
            data: {
              bodyTemplate: '<p>nope</p>',
              persistAsArtifact: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'report' }],
      },
      input: {},
      userId: 'harness-user-44',
    });

    expect(result.status).toBe('completed');
    expect(vi.mocked((prisma as any).artifactFile.create)).not.toHaveBeenCalled();
  });

  it('persists JSON body with application/json mime when Content-Type header says so', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'report',
            type: 'webhook_response',
            data: {
              statusCode: 200,
              headers: '{"Content-Type":"application/json"}',
              bodyTemplate: '{"namespace":"{{namespace}}","ok":true}',
              persistAsArtifact: true,
              artifactTitle: 'JSON Report {{namespace}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'report' }],
      },
      input: { namespace: 'kube-system' },
      userId: 'harness-user-45',
    });

    expect(result.status).toBe('completed');
    const createMock = vi.mocked((prisma as any).artifactFile.create);
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0][0] as { data: Record<string, any> };
    expect(args.data.mime_type).toBe('application/json');
    expect(args.data.title).toBe('JSON Report kube-system');
    expect(args.data.extracted_text).toContain('"namespace":"kube-system"');
  });

  it('defaults artifactTitle to "Workflow output — <executionId>" when not provided', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'report',
            type: 'webhook_response',
            data: {
              statusCode: 200,
              bodyTemplate: '<p>untitled</p>',
              persistAsArtifact: true,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'report' }],
      },
      input: {},
      userId: 'harness-user-46',
      executionId: 'exec-no-title-1',
    });

    expect(result.status).toBe('completed');
    const createMock = vi.mocked((prisma as any).artifactFile.create);
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0][0] as { data: Record<string, any> };
    expect(args.data.title).toBe('Workflow output — exec-no-title-1');
    // Default tags include 'flow-output' so the artifacts UI can filter.
    expect(args.data.tags).toContain('flow-output');
  });
});
