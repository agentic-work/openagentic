/**
 * EnrichedToolService — TDD spec for Phase 5.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §5
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md (Phase 5)
 *
 * Per-T1-tool metadata SoT. Service exposes:
 *   - getBySlug(slug)
 *   - listEnabled(opts?)
 *   - upsert(input)
 *   - toggle(slug, enabled, updatedBy?)
 *   - delete(slug)
 *   - toMetadata(row)  → { slug, outputTemplate?, truncate_summary?(raw)→StructuredContent }
 *
 * truncate_summary stored as a Handlebars-lite template string compiled
 * at toMetadata() time. Path syntax: {{a.b.c}} and {{items.[0].name}}.
 * Unknown paths render as '?'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnrichedToolService } from '../EnrichedToolService.js';

type Row = {
  slug: string;
  display_name: string;
  description: string;
  output_template: string | null;
  truncate_summary: string | null;
  input_schema: any;
  output_schema: any;
  mcp_server: string | null;
  category: string;
  tier: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
};

function makeRow(partial: Partial<Row>): Row {
  return {
    slug: partial.slug ?? 'sample_tool',
    display_name: partial.display_name ?? 'Sample',
    description: partial.description ?? 'desc',
    output_template: partial.output_template ?? null,
    truncate_summary: partial.truncate_summary ?? null,
    input_schema: partial.input_schema ?? { type: 'object', properties: {} },
    output_schema: partial.output_schema ?? null,
    mcp_server: partial.mcp_server ?? null,
    category: partial.category ?? 'meta',
    tier: partial.tier ?? 1,
    enabled: partial.enabled ?? true,
    created_at: new Date('2026-05-09'),
    updated_at: new Date('2026-05-09'),
    created_by: null,
    updated_by: null,
  };
}

function makePrismaMock(rows: Row[] = []) {
  const store = [...rows];
  return {
    enrichedTool: {
      findUnique: vi.fn(({ where: { slug } }: any) => {
        return Promise.resolve(store.find(r => r.slug === slug) ?? null);
      }),
      findMany: vi.fn(({ where, orderBy: _o }: any = {}) => {
        return Promise.resolve(
          store.filter(r => {
            if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
            if (where?.category && r.category !== where.category) return false;
            if (where?.mcp_server && r.mcp_server !== where.mcp_server) return false;
            return true;
          }),
        );
      }),
      upsert: vi.fn(({ where: { slug }, create, update }: any) => {
        const existing = store.find(r => r.slug === slug);
        if (existing) {
          Object.assign(existing, update, { updated_at: new Date() });
          return Promise.resolve(existing);
        }
        const row = makeRow({ slug, ...create });
        store.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn(({ where: { slug }, data }: any) => {
        const existing = store.find(r => r.slug === slug);
        if (!existing) throw new Error('not found');
        Object.assign(existing, data, { updated_at: new Date() });
        return Promise.resolve(existing);
      }),
      delete: vi.fn(({ where: { slug } }: any) => {
        const idx = store.findIndex(r => r.slug === slug);
        if (idx >= 0) store.splice(idx, 1);
        return Promise.resolve();
      }),
    },
    __store: store,
  } as any;
}

describe('EnrichedToolService', () => {
  let prisma: any;
  let svc: EnrichedToolService;

  beforeEach(() => {
    prisma = makePrismaMock([
      makeRow({ slug: 'azure_list_vms', mcp_server: 'oap-azure-mcp', category: 'cloud-ops', output_template: 'azure_vm_list', truncate_summary: '{{count}} VMs' }),
      makeRow({ slug: 'k8s_list_pods', mcp_server: 'oap-kubernetes-mcp', category: 'k8s', output_template: 'k8s_pod_list', truncate_summary: '{{count}} pods' }),
      makeRow({ slug: 'disabled_tool', enabled: false, category: 'meta' }),
    ]);
    svc = new EnrichedToolService(prisma);
  });

  it('getBySlug returns row when present', async () => {
    const row = await svc.getBySlug('azure_list_vms');
    expect(row).not.toBeNull();
    expect(row?.slug).toBe('azure_list_vms');
    expect(row?.output_template).toBe('azure_vm_list');
  });

  it('getBySlug returns null when missing', async () => {
    const row = await svc.getBySlug('nonexistent');
    expect(row).toBeNull();
  });

  it('listEnabled filters by enabled=true', async () => {
    const rows = await svc.listEnabled();
    expect(rows.length).toBe(2); // disabled_tool excluded
    expect(rows.every(r => r.enabled)).toBe(true);
  });

  it('listEnabled filters by category', async () => {
    const rows = await svc.listEnabled({ category: 'cloud-ops' });
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe('azure_list_vms');
  });

  it('listEnabled filters by mcpServer', async () => {
    const rows = await svc.listEnabled({ mcpServer: 'oap-kubernetes-mcp' });
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe('k8s_list_pods');
  });

  it('upsert creates new row when slug does not exist', async () => {
    const created = await svc.upsert({
      slug: 'new_tool',
      display_name: 'New Tool',
      description: 'fresh',
      input_schema: { type: 'object', properties: {} },
      category: 'meta',
      mcp_server: null,
      tier: 1,
      enabled: true,
      output_template: null,
      truncate_summary: null,
      output_schema: null,
      created_by: null,
      updated_by: null,
    });
    expect(created.slug).toBe('new_tool');
    expect(prisma.enrichedTool.upsert).toHaveBeenCalled();
  });

  it('upsert updates existing row when slug exists', async () => {
    await svc.upsert({
      slug: 'azure_list_vms',
      display_name: 'List Azure VMs (updated)',
      description: 'desc',
      input_schema: { type: 'object', properties: {} },
      category: 'cloud-ops',
      mcp_server: 'oap-azure-mcp',
      tier: 1,
      enabled: true,
      output_template: 'azure_vm_list',
      truncate_summary: '{{count}} VMs',
      output_schema: null,
      created_by: null,
      updated_by: null,
    });
    const after = await svc.getBySlug('azure_list_vms');
    expect(after?.display_name).toBe('List Azure VMs (updated)');
  });

  it('toggle flips enabled flag', async () => {
    const row = await svc.toggle('azure_list_vms', false, 'admin@x.com');
    expect(row.enabled).toBe(false);
    expect(row.updated_by).toBe('admin@x.com');
  });

  it('delete removes row', async () => {
    await svc.delete('azure_list_vms');
    const after = await svc.getBySlug('azure_list_vms');
    expect(after).toBeNull();
  });

  it('toMetadata returns slug + outputTemplate + truncate_summary fn', () => {
    const row = makeRow({
      slug: 'azure_list_vms',
      output_template: 'azure_vm_list',
      truncate_summary: '{{count}} VMs',
    });
    const md = svc.toMetadata(row);
    expect(md.slug).toBe('azure_list_vms');
    expect(md.outputTemplate).toBe('azure_vm_list');
    expect(typeof md.truncate_summary).toBe('function');
  });

  it('toMetadata truncate_summary compiles template with {{count}} substitution', () => {
    const row = makeRow({
      slug: 't',
      truncate_summary: '{{count}} items.',
    });
    const md = svc.toMetadata(row);
    const result = md.truncate_summary!({ count: 7 });
    expect(result.summary).toBe('7 items.');
    expect(result.truncated).toBe(true);
  });

  it('toMetadata truncate_summary handles {{items.[0].name}} path syntax', () => {
    const row = makeRow({
      slug: 't',
      truncate_summary: 'First: {{items.[0].name}}',
    });
    const md = svc.toMetadata(row);
    const result = md.truncate_summary!({ items: [{ name: 'apple' }, { name: 'banana' }] });
    expect(result.summary).toBe('First: apple');
  });

  it('toMetadata truncate_summary returns "?" for unknown paths', () => {
    const row = makeRow({
      slug: 't',
      truncate_summary: '{{count}} known: {{missing.path}}',
    });
    const md = svc.toMetadata(row);
    const result = md.truncate_summary!({ count: 3 });
    expect(result.summary).toBe('3 known: ?');
  });

  it('toMetadata returns truncate_summary undefined when row has no template', () => {
    const row = makeRow({ slug: 't', truncate_summary: null });
    const md = svc.toMetadata(row);
    expect(md.truncate_summary).toBeUndefined();
  });

  it('toMetadata returns outputTemplate undefined when row has none', () => {
    const row = makeRow({ slug: 't', output_template: null });
    const md = svc.toMetadata(row);
    expect(md.outputTemplate).toBeUndefined();
  });
});
