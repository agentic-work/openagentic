/**
 * EnrichedToolSeeder — TDD spec for Phase 5 seed.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §5
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md (Phase 5)
 *
 * Seeds ~14 default T1 tools (azure_list_*, k8s_list_*, aws_*, gcp_*, web_search,
 * kb_search, tool_search, agent_search, request_clarification, ...).
 * First-run inserts 14; second-run updates 14 (idempotent).
 */

import { describe, it, expect } from 'vitest';
import {
  EnrichedToolSeeder,
  SEED_ENRICHED_TOOLS_FOR_TESTS,
} from '../EnrichedToolSeeder.js';
import { EnrichedToolService } from '../EnrichedToolService.js';

type Row = any;

function makePrismaMock(initial: Row[] = []) {
  const store = [...initial];
  return {
    enrichedTool: {
      findUnique: ({ where: { slug } }: any) =>
        Promise.resolve(store.find((r: Row) => r.slug === slug) ?? null),
      findMany: () => Promise.resolve(store),
      upsert: ({ where: { slug }, create, update }: any) => {
        const existing = store.find((r: Row) => r.slug === slug);
        if (existing) {
          Object.assign(existing, update, { updated_at: new Date() });
          return Promise.resolve(existing);
        }
        const row = { slug, ...create, created_at: new Date(), updated_at: new Date() };
        store.push(row);
        return Promise.resolve(row);
      },
      update: ({ where: { slug }, data }: any) => {
        const existing = store.find((r: Row) => r.slug === slug);
        if (!existing) throw new Error('not found');
        Object.assign(existing, data, { updated_at: new Date() });
        return Promise.resolve(existing);
      },
      delete: ({ where: { slug } }: any) => {
        const idx = store.findIndex((r: Row) => r.slug === slug);
        if (idx >= 0) store.splice(idx, 1);
        return Promise.resolve();
      },
    },
  } as any;
}

describe('EnrichedToolSeeder', () => {
  it('seeds at least 14 tools on first run (inserted=N, updated=0)', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);

    const result = await seeder.seed();
    expect(result.inserted).toBeGreaterThanOrEqual(14);
    expect(result.updated).toBe(0);
    expect(result.inserted).toBe(SEED_ENRICHED_TOOLS_FOR_TESTS.length);
  });

  it('is idempotent — second run gives inserted=0, updated=N', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);

    await seeder.seed();
    const second = await seeder.seed();
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(SEED_ENRICHED_TOOLS_FOR_TESTS.length);
  });

  it('every seeded row has outputTemplate populated', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);
    await seeder.seed();
    const all = await svc.listAll();
    for (const row of all) {
      expect(row.output_template, `tool ${row.slug} missing output_template`).toBeTruthy();
    }
  });

  it('every seeded row has truncate_summary populated', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);
    await seeder.seed();
    const all = await svc.listAll();
    for (const row of all) {
      expect(row.truncate_summary, `tool ${row.slug} missing truncate_summary`).toBeTruthy();
    }
  });

  it('seeds the 14 named T1 tools (slug spot-checks)', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);
    await seeder.seed();

    const expected = [
      'azure_list_subscriptions',
      'azure_list_resource_groups',
      'azure_list_vms',
      'k8s_list_pods',
      'k8s_list_nodes',
      'aws_list_accounts',
      'aws_list_ec2_instances',
      'gcp_list_projects',
      'gcp_list_compute_instances',
      'web_search',
      'kb_search',
      'tool_search',
      'agent_search',
      'request_clarification',
    ];
    for (const slug of expected) {
      const row = await svc.getBySlug(slug);
      expect(row, `expected seeded slug ${slug}`).not.toBeNull();
    }
  });

  it('seeded rows are categorized correctly', async () => {
    const prisma = makePrismaMock();
    const svc = new EnrichedToolService(prisma);
    const seeder = new EnrichedToolSeeder(svc);
    await seeder.seed();

    const azureVms = await svc.getBySlug('azure_list_vms');
    expect(azureVms?.category).toBe('cloud-ops');
    expect(azureVms?.mcp_server).toBe('oap-azure-mcp');

    const toolSearch = await svc.getBySlug('tool_search');
    expect(toolSearch?.category).toBe('meta');
  });
});
