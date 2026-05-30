/**
 * ToolMetadataOverlay — keyed by tool_name, supplies hand-curated
 * usage metadata that's strictly merged into the indexed tool record
 * BEFORE upserting to pgvector/Milvus.
 *
 * Source of truth: JSON file at services/openagentic-api/data/tool-metadata-overlay.json
 *   (loaded synchronously at boot; small fixture, no streaming needed)
 *
 * Merge rules:
 *   1. Hand-curated overlay row, when present, wins on every field.
 *   2. Fields missing from the overlay fall through to
 *      inferToolMetadataFromName output.
 *   3. The merged record is what the indexer persists.
 *
 * No regex anywhere. Pure JSON load + property merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadToolMetadataOverlay,
  mergeOverlayWithInference,
  clearToolMetadataOverlayCache,
  type ToolMetadataOverlayEntry,
} from '../ToolMetadataOverlay.js';

describe('ToolMetadataOverlay', () => {
  beforeEach(() => {
    clearToolMetadataOverlayCache();
  });

  afterEach(() => {
    clearToolMetadataOverlayCache();
  });

  it('loadToolMetadataOverlay reads the JSON overlay and returns a Map keyed by tool_name', () => {
    const overlay = loadToolMetadataOverlay();
    expect(overlay).toBeInstanceOf(Map);
    // At least the 20 hand-curated tools must be in there.
    expect(overlay.size).toBeGreaterThanOrEqual(20);
    expect(overlay.has('azure_list_subscriptions')).toBe(true);
  });

  it('overlay entries include the required deepened fields', () => {
    const overlay = loadToolMetadataOverlay();
    const entry = overlay.get('azure_list_subscriptions');
    expect(entry).toBeDefined();
    expect(typeof entry!.when_to_use).toBe('string');
    expect(entry!.when_to_use.length).toBeGreaterThan(0);
    expect(typeof entry!.when_NOT_to_use).toBe('string');
    expect(Array.isArray(entry!.usage_examples)).toBe(true);
    expect(entry!.usage_examples.length).toBeGreaterThanOrEqual(2);
    expect(typeof entry!.aliases).toBe('string'); // comma-separated
    expect(entry!.aliases).toContain('subs');
    expect(typeof entry!.output_shape).toBe('string');
  });

  it('overlay aliases for azure_list_subscriptions contain the smoking-gun keywords', () => {
    const overlay = loadToolMetadataOverlay();
    const entry = overlay.get('azure_list_subscriptions');
    const aliases = entry!.aliases.split(',').map((s) => s.trim());
    expect(aliases).toContain('subs');
    expect(aliases).toContain('subscriptions');
    expect(aliases).toContain('azure subs');
  });

  it('overlay includes all 20 top hand-curated tools', () => {
    const overlay = loadToolMetadataOverlay();
    const expected = [
      'azure_list_subscriptions',
      'azure_list_resource_groups',
      'azure_list_vms',
      'azure_list_storage_accounts',
      'azure_list_app_services',
      'aws_list_accounts',
      'aws_identity',
      'aws_list_ec2_instances',
      'aws_list_s3_buckets',
      'gcp_list_projects',
      'gcp_list_billing_accounts',
      'gcp_list_compute_instances',
      'k8s_list_nodes',
      'k8s_list_pods',
      'k8s_list_namespaces',
      'tool_search',
      'agent_search',
      'agent_list',
      'web_search',
      'web_fetch',
    ];
    for (const name of expected) {
      expect(overlay.has(name), `Missing overlay row for '${name}'`).toBe(true);
    }
  });

  it('mergeOverlayWithInference: overlay fields win over inference', () => {
    const overlay: ToolMetadataOverlayEntry = {
      when_to_use: 'Use when X.',
      when_NOT_to_use: 'Do NOT use when Y.',
      usage_examples: [{ prompt: 'p1', picked_because: 'r1' }],
      aliases: 'a, b, c',
      output_shape: 'shape',
      cost_class: 'read',
      requires_capabilities: 'azure',
      cloud_provider: 'azure',
      service: 'arm',
      verb: 'list',
      related_tools: 'foo, bar',
    };
    const merged = mergeOverlayWithInference('azure_list_subscriptions', overlay);
    expect(merged.when_to_use).toBe('Use when X.');
    expect(merged.aliases).toContain('a');
    // Even when overlay has aliases, the merged aliases should also include
    // inferred fallbacks if the overlay didn't repeat them. Hand-curated wins
    // means we take overlay verbatim for STRING fields. For aliases the contract
    // is: overlay first, append inferred aliases that aren't already in overlay.
    expect(merged.cloud_provider).toBe('azure');
    expect(merged.verb).toBe('list');
  });

  it('mergeOverlayWithInference: missing overlay fields fall through to inference', () => {
    // Only when_to_use supplied — verb/cost_class/cloud_provider come from inference.
    const overlay: ToolMetadataOverlayEntry = {
      when_to_use: 'Use to list resource groups.',
    };
    const merged = mergeOverlayWithInference('azure_list_resource_groups', overlay);
    expect(merged.when_to_use).toBe('Use to list resource groups.');
    expect(merged.cloud_provider).toBe('azure'); // from inference
    expect(merged.verb).toBe('list');             // from inference
    expect(merged.cost_class).toBe('read');       // from inference
  });

  it('mergeOverlayWithInference works with no overlay (pure inference)', () => {
    const merged = mergeOverlayWithInference('aws_terminate_instance', undefined);
    expect(merged.cloud_provider).toBe('aws');
    expect(merged.verb).toBe('terminate');
    expect(merged.cost_class).toBe('destructive');
    // Defaults for the curated-only fields.
    expect(merged.when_to_use).toBe('');
    expect(merged.usage_examples).toEqual([]);
  });

  it('mergeOverlayWithInference appends inferred aliases without losing overlay aliases', () => {
    // Overlay says 'foo, bar'; inferred says 'subs, subscriptions'. Merged
    // must include all four (overlay first, then non-duplicate inferred).
    const overlay: ToolMetadataOverlayEntry = { aliases: 'foo, bar' };
    const merged = mergeOverlayWithInference('azure_list_subscriptions', overlay);
    const aliases = merged.aliases.split(',').map((s) => s.trim());
    expect(aliases).toContain('foo');
    expect(aliases).toContain('bar');
    expect(aliases).toContain('subs');
    expect(aliases).toContain('subscriptions');
  });
});
