/**
 * extractToolMetadata — pure helper that pulls the per-tool metadata
 * block out of a proxy tool definition for the indexer + ToolRanker.
 *
 * Shape (per the all-MCP refactor brief):
 *   metadata: {
 *     category: string                     // matches IntentClassifier intents
 *     destructiveness: 'read-only' | 'mutating' | 'destructive'
 *     hitlRisk: 'low' | 'medium' | 'high'
 *     requiresConsent: boolean
 *     cost: 'free' | 'metered' | 'expensive'
 *     idempotent: boolean
 *     averageLatencyMs: number
 *     goldenPrompts: string[]              // ≥3 user-style trigger prompts
 *   }
 *
 * Reads from BOTH `tool.metadata` and `tool.function.metadata` because
 * different MCP server frameworks emit at different nesting depths
 * (FastMCP top-level vs spec-shape nested).
 *
 * Falls back to `inferCategory(name, description)` when metadata is
 * absent or doesn't carry a category — preserves existing behavior.
 *
 * Filters out unknown keys + invalid enum values rather than throwing
 * (indexer must keep importing valid tools even when one is malformed).
 */

import { describe, it, expect } from 'vitest';
import { extractToolMetadata } from '../extractToolMetadata.js';

function inferCategoryStub(name: string, _desc: string): string | undefined {
  if (name.startsWith('aws_list_') || name.startsWith('azure_list_')) return 'cloud-list';
  return undefined;
}

describe('extractToolMetadata', () => {
  it('returns the metadata block when present at tool.metadata (top-level)', () => {
    const tool = {
      function: { name: 'azure_list_subscriptions', description: 'x', parameters: {} },
      metadata: {
        category: 'cloud-list',
        destructiveness: 'read-only',
        hitlRisk: 'low',
        requiresConsent: false,
        cost: 'free',
        idempotent: true,
        averageLatencyMs: 800,
        goldenPrompts: [
          'list my azure subscriptions',
          'show me my azure subs',
          'what subscriptions do i have',
        ],
      },
    };
    const m = extractToolMetadata(tool, inferCategoryStub);
    expect(m.category).toBe('cloud-list');
    expect(m.destructiveness).toBe('read-only');
    expect(m.hitlRisk).toBe('low');
    expect(m.requiresConsent).toBe(false);
    expect(m.cost).toBe('free');
    expect(m.idempotent).toBe(true);
    expect(m.averageLatencyMs).toBe(800);
    expect(m.goldenPrompts).toHaveLength(3);
    expect(m.goldenPrompts).toContain('list my azure subscriptions');
  });

  it('also reads from tool.function.metadata (nested) for spec-shape MCP servers', () => {
    const tool = {
      function: {
        name: 'gcp_list_cloud_run_services',
        description: 'x',
        parameters: {},
        metadata: {
          category: 'cloud-list',
          goldenPrompts: ['list my cloud run services'],
        },
      },
    };
    const m = extractToolMetadata(tool, inferCategoryStub);
    expect(m.category).toBe('cloud-list');
    expect(m.goldenPrompts).toEqual(['list my cloud run services']);
  });

  it('falls back to inferCategory when metadata is absent', () => {
    const tool = {
      function: { name: 'aws_list_iam_users', description: 'List IAM users', parameters: {} },
    };
    const m = extractToolMetadata(tool, inferCategoryStub);
    // No metadata block at all — category comes from inferCategory.
    expect(m.category).toBe('cloud-list');
    expect(m.goldenPrompts).toEqual([]);
  });

  it('falls back to inferCategory when metadata is present but lacks category', () => {
    const tool = {
      function: { name: 'aws_list_iam_users', description: 'x', parameters: {} },
      metadata: {
        destructiveness: 'read-only',
        // category intentionally missing
      },
    };
    const m = extractToolMetadata(tool, inferCategoryStub);
    expect(m.category).toBe('cloud-list');
    expect(m.destructiveness).toBe('read-only');
  });

  it('rejects invalid enum values (drops them so the indexer keeps importing)', () => {
    const tool = {
      function: { name: 'x', description: 'x', parameters: {} },
      metadata: {
        destructiveness: 'CATASTROPHIC', // not in enum
        hitlRisk: 'extremely-high',      // not in enum
        cost: 'tier-7',                  // not in enum
      },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.destructiveness).toBeUndefined();
    expect(m.hitlRisk).toBeUndefined();
    expect(m.cost).toBeUndefined();
  });

  it('coerces requiresConsent and idempotent to boolean strictly', () => {
    const tool = {
      function: { name: 'x', description: 'x', parameters: {} },
      metadata: {
        requiresConsent: 'yes',  // truthy string — explicitly NOT coerced; must be bool
        idempotent: 1,           // truthy number — same
      },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.requiresConsent).toBeUndefined();
    expect(m.idempotent).toBeUndefined();
  });

  it('only accepts goldenPrompts as an array of non-empty strings', () => {
    const tool = {
      function: { name: 'x', description: 'x', parameters: {} },
      metadata: {
        goldenPrompts: ['valid prompt', '', 42, null, 'another valid'],
      },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.goldenPrompts).toEqual(['valid prompt', 'another valid']);
  });

  it('clamps averageLatencyMs to a sane positive integer', () => {
    const tool = {
      function: { name: 'x', description: 'x', parameters: {} },
      metadata: { averageLatencyMs: -100 },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.averageLatencyMs).toBeUndefined();
  });

  it('returns an empty-but-shape-stable object when tool has no metadata at all', () => {
    const tool = { function: { name: 'x', description: 'x', parameters: {} } };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m).toEqual({
      category: undefined,
      destructiveness: undefined,
      hitlRisk: undefined,
      requiresConsent: undefined,
      cost: undefined,
      idempotent: undefined,
      averageLatencyMs: undefined,
      goldenPrompts: [],
    });
  });

  it('reads tool._meta (MCP spec canonical) at highest priority', () => {
    // FastMCP's @mcp.tool(meta={...}) serializes to MCP wire field _meta
    // per modelcontextprotocol.io spec. This is the authoritative location
    // for cascade-relevant fields (category/hitlRisk/goldenPrompts/...).
    const tool = {
      function: { name: 'azure_list_subscriptions', description: 'x', parameters: {} },
      _meta: {
        category: 'cloud-list',
        hitlRisk: 'low',
        goldenPrompts: ['list my azure subs'],
      },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.category).toBe('cloud-list');
    expect(m.hitlRisk).toBe('low');
    expect(m.goldenPrompts).toEqual(['list my azure subs']);
  });

  it('_meta beats both metadata and annotations when all three exist', () => {
    const tool = {
      function: { name: 'x', description: 'x', parameters: {} },
      _meta: { category: 'meta-wins' },
      metadata: { category: 'metadata-loses' },
      annotations: { category: 'annotations-loses' },
    };
    expect(extractToolMetadata(tool, () => undefined).category).toBe('meta-wins');
  });

  it('also reads from tool.annotations (MCP spec / FastMCP shape)', () => {
    // FastMCP's @mcp.tool(annotations={...}) attaches a top-level
    // `annotations` field on the tool spec per the MCP standard. The
    // proxy spreads tools verbatim, so `annotations` is what reaches
    // the indexer for Python MCP servers using FastMCP.
    const tool = {
      function: {
        name: 'azure_list_subscriptions',
        description: 'x',
        parameters: {},
      },
      annotations: {
        category: 'cloud-list',
        destructiveness: 'read-only',
        goldenPrompts: ['list my azure subs'],
      },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.category).toBe('cloud-list');
    expect(m.destructiveness).toBe('read-only');
    expect(m.goldenPrompts).toEqual(['list my azure subs']);
  });

  it('precedence: metadata > function.metadata > annotations > function.annotations', () => {
    // metadata wins
    const t1 = {
      function: { name: 'x', description: 'x', parameters: {}, annotations: { category: 'fn-ann' } },
      annotations: { category: 'top-ann' },
      metadata: { category: 'top-meta' },
    };
    expect(extractToolMetadata(t1, () => undefined).category).toBe('top-meta');

    // function.metadata wins over annotations
    const t2 = {
      function: { name: 'x', description: 'x', parameters: {}, metadata: { category: 'fn-meta' } },
      annotations: { category: 'top-ann' },
    };
    expect(extractToolMetadata(t2, () => undefined).category).toBe('fn-meta');

    // top annotations win over function.annotations
    const t3 = {
      function: { name: 'x', description: 'x', parameters: {}, annotations: { category: 'fn-ann' } },
      annotations: { category: 'top-ann' },
    };
    expect(extractToolMetadata(t3, () => undefined).category).toBe('top-ann');
  });

  it('top-level tool.metadata takes precedence over tool.function.metadata when both exist', () => {
    const tool = {
      function: {
        name: 'x',
        description: 'x',
        parameters: {},
        metadata: { category: 'nested-wins-loser' },
      },
      metadata: { category: 'top-level-wins' },
    };
    const m = extractToolMetadata(tool, () => undefined);
    expect(m.category).toBe('top-level-wins');
  });
});

describe('extractToolMetadata.toSearchEmbeddingText', () => {
  it('joins toolName + description + category + goldenPrompts into one string for the embedding', async () => {
    const { toSearchEmbeddingText } = await import('../extractToolMetadata.js');
    const text = toSearchEmbeddingText({
      toolName: 'azure_list_subscriptions',
      description: 'List the Azure AD tenant subscriptions visible to the caller.',
      category: 'cloud-list',
      goldenPrompts: ['list my azure subs', 'show subscriptions', 'what billing accounts'],
    });
    expect(text).toContain('azure_list_subscriptions');
    expect(text).toContain('cloud-list');
    expect(text).toContain('list my azure subs');
    expect(text).toContain('show subscriptions');
  });

  it('omits empty parts cleanly (no double spaces)', async () => {
    const { toSearchEmbeddingText } = await import('../extractToolMetadata.js');
    const text = toSearchEmbeddingText({
      toolName: 'x',
      description: '',
      category: undefined,
      goldenPrompts: [],
    });
    expect(text).toBe('x');
  });
});
