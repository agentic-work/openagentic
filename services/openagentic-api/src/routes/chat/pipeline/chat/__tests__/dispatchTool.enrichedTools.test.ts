/**
 * dispatchTool — EnrichedTool registry wire-up (Phase 5 / Task 5.4).
 *
 * the design notes
 * the design notes (Phase 5)
 *
 * Verifies that when `runChat` loads enriched tools from `EnrichedToolService`
 * via `service.toMetadata(row)`, the resulting `enrichedTools` map drives
 * `splitEnvelope`'s `outputTemplate` + `truncate_summary` exactly as
 * production wires it.
 *
 * These tests use the real splitter (not a mock) so we pin the contract
 * end-to-end: stored row → toMetadata → dispatchTool → splitter → ToolResult.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeDispatch } from '../dispatchTool.js';
import { EnrichedToolService } from '../../../../../services/EnrichedToolService.js';

// Mock the inner dispatcher so we can drive what the underlying tool returns.
vi.mock('../dispatchChatToolCall.js', () => ({
  dispatchChatToolCall: vi.fn(),
}));

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

function makeRunCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 's',
    userId: 'u',
  } as any;
}

function makeRow(partial: any) {
  return {
    slug: partial.slug,
    display_name: partial.slug,
    description: 'd',
    output_template: partial.output_template ?? null,
    truncate_summary: partial.truncate_summary ?? null,
    input_schema: { type: 'object' },
    output_schema: null,
    mcp_server: partial.mcp_server ?? null,
    category: partial.category ?? 'meta',
    tier: 1,
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: null,
    updated_by: null,
  };
}

function makePrismaMock(rows: any[]) {
  return {
    enrichedTool: {
      findUnique: ({ where: { slug } }: any) =>
        Promise.resolve(rows.find((r: any) => r.slug === slug) ?? null),
      findMany: ({ where }: any = {}) =>
        Promise.resolve(
          rows.filter((r: any) => {
            if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
            return true;
          }),
        ),
      upsert: () => Promise.resolve(),
      update: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  } as any;
}

describe('makeDispatch — EnrichedTool registry wire-up', () => {
  it('when enrichedTools[name] is undefined → splitter has no outputTemplate', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { items: [1, 2] } });

    const dispatch = makeDispatch({ v2Deps: {} as any, enrichedTools: {} });
    const result = await dispatch(makeRunCtx(), { name: 'unknown_tool', input: {} });

    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.outputTemplate).toBeUndefined();
  });

  it('when enrichedTools[name] from EnrichedToolService → outputTemplate flows to ToolResult', async () => {
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { items: ['a'] } });

    // Build the registry the way production does it.
    const prisma = makePrismaMock([
      makeRow({ slug: 'k8s_list_pods', output_template: 'k8s_pod_list', truncate_summary: '{{count}} pods' }),
    ]);
    const svc = new EnrichedToolService(prisma);
    const row = await svc.getBySlug('k8s_list_pods');
    const md = svc.toMetadata(row!);

    const enrichedTools = { [md.slug]: { outputTemplate: md.outputTemplate, truncate_summary: md.truncate_summary } };
    const dispatch = makeDispatch({ v2Deps: {} as any, enrichedTools });

    const result = await dispatch(makeRunCtx(), { name: 'k8s_list_pods', input: {} });

    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.outputTemplate).toBe('k8s_pod_list');
  });

  it('when enriched truncate_summary is set + result overflows → splitter invokes truncate fn', async () => {
    // Build a result big enough to overflow (>30KB default threshold).
    const bigArray = Array.from({ length: 5000 }, (_, i) => ({ name: `pod-${i}`, status: 'Running' }));
    (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { count: bigArray.length, pods: bigArray } });

    const prisma = makePrismaMock([
      makeRow({
        slug: 'k8s_list_pods',
        output_template: 'k8s_pod_list',
        truncate_summary: '{{count}} pods total.',
      }),
    ]);
    const svc = new EnrichedToolService(prisma);
    const row = await svc.getBySlug('k8s_list_pods');
    const md = svc.toMetadata(row!);

    const dispatch = makeDispatch({
      v2Deps: {} as any,
      enrichedTools: { [md.slug]: { outputTemplate: md.outputTemplate, truncate_summary: md.truncate_summary } },
      // Provide a stub storage so the overflow branch fires.
      largeResultStorage: { put: vi.fn().mockResolvedValue('handle-abc') },
      thresholdBytes: 1000, // tighten for test speed
    });

    const result = await dispatch(makeRunCtx(), { name: 'k8s_list_pods', input: {} });

    expect(result.envelope).toBeDefined();
    expect(result.envelope!._meta.artifactHandle).toBe('handle-abc');
    expect(result.envelope!.structuredContent.summary).toBe('5000 pods total.');
    expect(result.envelope!.structuredContent.truncated).toBe(true);
  });

  it('production wiring: listEnabled → toMetadata → enrichedTools map', async () => {
    const prisma = makePrismaMock([
      makeRow({ slug: 'tool_search', output_template: 'tool_search_results', truncate_summary: '{{count}} matches' }),
      makeRow({ slug: 'azure_list_vms', output_template: 'azure_vm_list', truncate_summary: '{{count}} VMs', mcp_server: 'oap-azure-mcp', category: 'cloud-ops' }),
    ]);
    const svc = new EnrichedToolService(prisma);

    // This is what runChat will do at pipeline construction.
    const enabled = await svc.listEnabled();
    const enrichedTools: Record<string, { outputTemplate?: string; truncate_summary?: any }> = {};
    for (const row of enabled) {
      const md = svc.toMetadata(row);
      enrichedTools[md.slug] = { outputTemplate: md.outputTemplate, truncate_summary: md.truncate_summary };
    }

    expect(Object.keys(enrichedTools).sort()).toEqual(['azure_list_vms', 'tool_search']);
    expect(enrichedTools.azure_list_vms.outputTemplate).toBe('azure_vm_list');
    expect(enrichedTools.tool_search.outputTemplate).toBe('tool_search_results');
  });
});
