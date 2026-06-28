/**
 * EnrichedToolSeeder — boot-time seeder for the EnrichedTool registry.
 *
 * the design notes
 * the design notes (Phase 5)
 *
 * Lands the canonical T1-tool metadata rows on first boot and updates
 * existing rows on every subsequent boot (idempotent). Admin edits via
 * the admin UI take precedence — `enabled` is preserved and only
 * structural fields (display_name / description / output_template /
 * truncate_summary / schemas / category / tier / mcp_server) get
 * refreshed if the seed list ships an updated value.
 */

import { loggers } from '../utils/logger.js';
import type { EnrichedToolService, EnrichedToolUpsertInput } from './EnrichedToolService.js';

/**
 * Default T1 tools shipped with the platform. Order is alphabetical-by-slug
 * within each category, but the seeder does not depend on order.
 */
const SEED_ENRICHED_TOOLS: EnrichedToolUpsertInput[] = [
  // ── Azure (cloud-ops) ────────────────────────────────────────────────
  // 2026-05-11 — templates upgraded with auto-tokens ({{count}} and
  // {{sample_names}} now resolve from the raw array shape when the raw
  // doesn't carry literal `.count` / `.sample_names` properties). The
  // model channel stays under 2KB even when the raw payload is multi-MB;
  // the full payload sits in Redis behind `_meta.artifactHandle` and the
  // model can call `read_large_result(handle)` for paged retrieval.
  {
    slug: 'azure_list_subscriptions',
    display_name: 'List Azure Subscriptions',
    description: 'List all subscriptions in the connected Azure tenant.',
    output_template: 'azure_subscription_list',
    truncate_summary:
      '{{count}} Azure subscriptions. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full inventory.',
    input_schema: { type: 'object', properties: {} },
    mcp_server: 'oap-azure-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'azure_list_resource_groups',
    display_name: 'List Resource Groups',
    description: 'List resource groups in a given Azure subscription.',
    output_template: 'azure_rg_list',
    truncate_summary:
      '{{count}} resource groups in subscription {{subscription_id}}. ' +
      'First 5: {{sample_names}}. Use read_large_result(handle) for full list.',
    input_schema: {
      type: 'object',
      properties: { subscription_id: { type: 'string' } },
      required: ['subscription_id'],
    },
    mcp_server: 'oap-azure-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'azure_list_vms',
    display_name: 'List Azure VMs',
    description: 'List virtual machines in an Azure subscription / resource group.',
    output_template: 'azure_vm_list',
    truncate_summary: '{{count}} VMs. Running: {{running}}, Stopped: {{stopped}}.',
    input_schema: {
      type: 'object',
      properties: {
        subscription_id: { type: 'string' },
        resource_group: { type: 'string' },
      },
      required: ['subscription_id'],
    },
    mcp_server: 'oap-azure-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },

  // ── Kubernetes ───────────────────────────────────────────────────────
  {
    slug: 'k8s_list_pods',
    display_name: 'List K8s Pods',
    description: 'List pods in a Kubernetes namespace.',
    output_template: 'k8s_pod_list',
    truncate_summary:
      '{{count}} pods. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full list.',
    input_schema: {
      type: 'object',
      properties: { namespace: { type: 'string' } },
    },
    mcp_server: 'oap-kubernetes-mcp',
    category: 'k8s',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'k8s_list_nodes',
    display_name: 'List K8s Nodes',
    description: 'List nodes in the connected Kubernetes cluster.',
    output_template: 'k8s_node_list',
    truncate_summary:
      '{{count}} nodes in cluster. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full details.',
    input_schema: { type: 'object', properties: {} },
    mcp_server: 'oap-kubernetes-mcp',
    category: 'k8s',
    tier: 1,
    enabled: true,
  },

  // ── AWS (cloud-ops) ──────────────────────────────────────────────────
  {
    slug: 'aws_list_accounts',
    display_name: 'List AWS Accounts',
    description: 'List accounts in the connected AWS Organization.',
    output_template: 'aws_account_list',
    truncate_summary:
      '{{count}} AWS accounts in org. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full list.',
    input_schema: { type: 'object', properties: {} },
    mcp_server: 'oap-aws-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'aws_list_ec2_instances',
    display_name: 'List EC2 Instances',
    description: 'List EC2 instances in a given AWS region.',
    output_template: 'aws_ec2_list',
    truncate_summary:
      '{{count}} EC2 instances. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full details.',
    input_schema: {
      type: 'object',
      properties: { region: { type: 'string' } },
    },
    mcp_server: 'oap-aws-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },

  // ── GCP (cloud-ops) ──────────────────────────────────────────────────
  {
    slug: 'gcp_list_projects',
    display_name: 'List GCP Projects',
    description: 'List projects in the connected Google Cloud organization.',
    output_template: 'gcp_project_list',
    truncate_summary:
      '{{count}} GCP projects. First 5: {{sample_names}}. ' +
      'Use read_large_result(handle) for full list.',
    input_schema: { type: 'object', properties: {} },
    mcp_server: 'oap-gcp-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'gcp_list_compute_instances',
    display_name: 'List Compute Instances',
    description: 'List Google Compute Engine VMs in a given project.',
    output_template: 'gcp_compute_list',
    truncate_summary: '{{count}} GCE instances.',
    input_schema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
    mcp_server: 'oap-gcp-mcp',
    category: 'cloud-ops',
    tier: 1,
    enabled: true,
  },

  // ── Search / data ────────────────────────────────────────────────────
  {
    slug: 'web_search',
    display_name: 'Web Search',
    description: 'Search the public web via the oap-web-mcp connector.',
    output_template: 'web_search_results',
    truncate_summary: '{{count}} web results for "{{query}}".',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    mcp_server: 'oap-web-mcp',
    category: 'data',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'kb_search',
    display_name: 'Knowledge Base Search',
    description: 'Search the platform knowledge base + RAG corpus.',
    output_template: 'kb_search_results',
    truncate_summary: '{{count}} hits for "{{query}}".',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    mcp_server: null,
    category: 'data',
    tier: 1,
    enabled: true,
  },

  // ── Meta-tools (T1 catalog discovery + interactive) ──────────────────
  {
    slug: 'tool_search',
    display_name: 'Tool Search',
    description: 'Discover MCP tools that match an intent. Use this to expand the tool catalog mid-turn.',
    output_template: 'tool_search_results',
    truncate_summary:
      '{{count}} matching tools (showing top 5). First 5: {{sample_names}}.',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string' },
        top_k: { type: 'integer' },
      },
      required: ['intent'],
    },
    mcp_server: null,
    category: 'meta',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'agent_search',
    display_name: 'Agent Search',
    description: 'Discover sub-agents that match a capability hint.',
    output_template: 'agent_search_results',
    truncate_summary:
      '{{count}} matching agents (showing top 5). First 5: {{sample_names}}.',
    input_schema: {
      type: 'object',
      properties: { intent: { type: 'string' } },
      required: ['intent'],
    },
    mcp_server: null,
    category: 'meta',
    tier: 1,
    enabled: true,
  },
  {
    slug: 'request_clarification',
    display_name: 'Request Clarification',
    description: 'Ask the user a clarifying question with optional pre-set choices.',
    output_template: 'request_clarification',
    truncate_summary: '{{count}} options offered.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array' },
      },
      required: ['question'],
    },
    mcp_server: null,
    category: 'meta',
    tier: 1,
    enabled: true,
  },
];

export class EnrichedToolSeeder {
  constructor(private service: EnrichedToolService) {}

  /**
   * Seed every default tool. Returns counts of inserted vs updated rows.
   * `enabled` is NOT overridden on existing rows — admin disables stick.
   */
  async seed(): Promise<{ inserted: number; updated: number; skipped: number }> {
    let inserted = 0;
    let updated = 0;
    const skipped = 0;
    for (const t of SEED_ENRICHED_TOOLS) {
      const existing = await this.service.getBySlug(t.slug);
      if (existing) {
        // Preserve admin-set enabled flag on update
        const merged = { ...t, enabled: existing.enabled };
        await this.service.upsert(merged);
        updated++;
      } else {
        await this.service.upsert(t);
        inserted++;
      }
    }
    return { inserted, updated, skipped };
  }
}

/**
 * Convenience entry point used by the boot path. Logs the result and
 * swallows errors (so a seed failure never aborts startup — admin can
 * seed manually via the admin UI).
 */
export async function seedEnrichedTools(service: EnrichedToolService): Promise<void> {
  const log = loggers.services?.child?.({ service: 'EnrichedToolSeeder' }) ?? loggers.services;
  try {
    const seeder = new EnrichedToolSeeder(service);
    const result = await seeder.seed();
    log.info(result, '[EnrichedToolSeeder] seed complete');
  } catch (err: any) {
    log.warn(
      { err: err?.message ?? String(err) },
      '[EnrichedToolSeeder] seed failed — admin can re-seed via /admin#enriched-tools',
    );
  }
}

/** Test export — full seed list for arch tests + assertions. */
export const SEED_ENRICHED_TOOLS_FOR_TESTS = SEED_ENRICHED_TOOLS;
