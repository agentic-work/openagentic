/**
 * inferToolMetadataFromName — pure helper that infers cascade metadata
 * fields from a tool's NAME using lexical conventions only (no LLM,
 * no regex). Used as a fallback when no hand-curated overlay row exists
 * for a tool.
 *
 * Convention (all snake_case, lower):
 *   {provider}_{verb}_{resource}        e.g. azure_list_subscriptions
 *   {provider}_{verb}                   e.g. aws_identity
 *   {namespace}_{verb}_{resource}       e.g. k8s_list_pods
 *   {bare_verb}                         e.g. web_search, tool_search
 *
 * Inferred fields:
 *   - cloud_provider:        azure | aws | gcp | k8s | platform | undefined
 *   - service:               arm | iam | ec2 | s3 | gke | undefined (best-effort)
 *   - verb:                  list | get | create | update | delete |
 *                            terminate | query | execute | search
 *   - cost_class:            read | mutating | destructive (derived from verb)
 *   - aliases:               comma-separated abbreviations + pluralizations
 *
 * Inference is INFORMATIONAL — the hand-curated overlay always wins.
 * Inferred fields are returned with `inferred: true` flag so callers can
 * tell them apart from authoritative values.
 */

import { describe, it, expect } from 'vitest';
import { inferToolMetadataFromName } from '../inferToolMetadataFromName.js';

describe('inferToolMetadataFromName', () => {
  it('infers azure_list_subscriptions correctly', () => {
    const m = inferToolMetadataFromName('azure_list_subscriptions');
    expect(m.cloud_provider).toBe('azure');
    expect(m.verb).toBe('list');
    expect(m.service).toBe('arm');
    expect(m.cost_class).toBe('read');
    // Aliases must include common abbreviations of "subscriptions"
    expect(m.aliases).toContain('subs');
    expect(m.aliases).toContain('subscriptions');
  });

  it('infers aws_terminate_instance as destructive', () => {
    const m = inferToolMetadataFromName('aws_terminate_instance');
    expect(m.cloud_provider).toBe('aws');
    expect(m.verb).toBe('terminate');
    expect(m.cost_class).toBe('destructive');
  });

  it('infers aws_list_ec2_instances correctly', () => {
    const m = inferToolMetadataFromName('aws_list_ec2_instances');
    expect(m.cloud_provider).toBe('aws');
    expect(m.verb).toBe('list');
    expect(m.service).toBe('ec2');
    expect(m.cost_class).toBe('read');
  });

  it('infers gcp_list_projects correctly', () => {
    const m = inferToolMetadataFromName('gcp_list_projects');
    expect(m.cloud_provider).toBe('gcp');
    expect(m.verb).toBe('list');
    expect(m.cost_class).toBe('read');
  });

  it('infers k8s_list_pods correctly', () => {
    const m = inferToolMetadataFromName('k8s_list_pods');
    expect(m.cloud_provider).toBe('k8s');
    expect(m.verb).toBe('list');
    expect(m.cost_class).toBe('read');
  });

  it('classifies create/update verbs as mutating', () => {
    expect(inferToolMetadataFromName('azure_create_vm').cost_class).toBe('mutating');
    expect(inferToolMetadataFromName('azure_update_resource_group').cost_class).toBe('mutating');
  });

  it('classifies delete/terminate/destroy verbs as destructive', () => {
    expect(inferToolMetadataFromName('azure_delete_vm').cost_class).toBe('destructive');
    expect(inferToolMetadataFromName('aws_destroy_stack').cost_class).toBe('destructive');
    expect(inferToolMetadataFromName('gcp_terminate_instance').cost_class).toBe('destructive');
  });

  it('infers tool_search as platform/search/read', () => {
    const m = inferToolMetadataFromName('tool_search');
    expect(m.cloud_provider).toBe('platform');
    expect(m.verb).toBe('search');
    expect(m.cost_class).toBe('read');
  });

  it('infers web_search and web_fetch as platform/read', () => {
    expect(inferToolMetadataFromName('web_search').cloud_provider).toBe('platform');
    expect(inferToolMetadataFromName('web_search').cost_class).toBe('read');
    expect(inferToolMetadataFromName('web_fetch').cloud_provider).toBe('platform');
    expect(inferToolMetadataFromName('web_fetch').cost_class).toBe('read');
  });

  it('infers verb "get" as read (single resource)', () => {
    const m = inferToolMetadataFromName('aws_get_bucket_policy');
    expect(m.verb).toBe('get');
    expect(m.cost_class).toBe('read');
  });

  it('returns inferred:true so callers can distinguish from curated overlay', () => {
    const m = inferToolMetadataFromName('azure_list_subscriptions');
    expect(m.inferred).toBe(true);
  });

  it('returns sane defaults for unrecognized tool names', () => {
    const m = inferToolMetadataFromName('weird_unknown_xyz');
    // Verb falls through to undefined or 'execute'
    expect(m.cost_class).toBe('mutating'); // unknown = assume mutating (safer)
    expect(m.cloud_provider).toBeUndefined();
  });

  it('handles bare names (no underscores)', () => {
    const m = inferToolMetadataFromName('memorize');
    expect(m.cloud_provider).toBe('platform');
  });

  it('strips common plural suffixes for aliases (subscriptions → subs)', () => {
    const m = inferToolMetadataFromName('azure_list_subscriptions');
    // The resource was "subscriptions"; should include "subs", "subscription", "subscriptions"
    expect(m.aliases).toContain('subscriptions');
    expect(m.aliases).toContain('subscription');
    expect(m.aliases).toContain('subs');
  });

  it('produces non-empty aliases for typical cloud tools', () => {
    const m = inferToolMetadataFromName('azure_list_resource_groups');
    expect(m.aliases.length).toBeGreaterThan(0);
    expect(m.aliases).toContain('resource_groups');
  });
});
