/**
 * toSearchEmbeddingText — deepened embedding text (2026-05-11).
 *
 * The embedded text now includes aliases + when_to_use + usage_examples
 * (flattened) so the cosine-search recall jumps for queries like
 *   "show me my azure subs"
 * which would otherwise miss `azure_list_subscriptions` when the
 * description doesn't share the keyword "subs".
 *
 * Order: tool_name → description → category → when_to_use → aliases →
 *        usage_examples (joined prompts) → goldenPrompts.
 *
 * Backwards-compat: existing signature (toolName, description, category,
 * goldenPrompts) still works — new fields are optional.
 */

import { describe, it, expect } from 'vitest';
import { toSearchEmbeddingText } from '../extractToolMetadata.js';

describe('toSearchEmbeddingText — deepened fields (2026-05-11)', () => {
  it('includes when_to_use and aliases in the embedded text', () => {
    const text = toSearchEmbeddingText({
      toolName: 'azure_list_subscriptions',
      description: 'List Azure subscriptions for the caller.',
      category: 'cloud-list',
      goldenPrompts: [],
      when_to_use: 'Use when the user asks for Azure subscriptions visible to the caller.',
      aliases: 'subs, subscriptions, azure subs, ms subs',
      usage_examples: [
        { prompt: 'show me my azure subs', picked_because: "user said 'azure subs'" },
        { prompt: 'list subscriptions', picked_because: 'direct ask' },
      ],
    });
    expect(text).toContain('azure_list_subscriptions');
    expect(text).toContain('subs');
    expect(text).toContain('azure subs');
    expect(text).toContain('Azure subscriptions visible to the caller');
    expect(text).toContain('show me my azure subs');
  });

  it('omits empty new-shape fields cleanly (no leading/trailing space)', () => {
    const text = toSearchEmbeddingText({
      toolName: 'x',
      description: '',
      category: undefined,
      goldenPrompts: [],
      when_to_use: '',
      aliases: '',
      usage_examples: [],
    });
    expect(text).toBe('x');
  });

  it('keeps backwards-compat: existing 4-field signature still works', () => {
    const text = toSearchEmbeddingText({
      toolName: 'aws_list_s3_buckets',
      description: 'List S3 buckets.',
      category: 'cloud-list',
      goldenPrompts: ['list s3 buckets'],
    });
    expect(text).toContain('aws_list_s3_buckets');
    expect(text).toContain('list s3 buckets');
  });

  it('aliases get folded individually so they each contribute to embedding', () => {
    const text = toSearchEmbeddingText({
      toolName: 'azure_list_subscriptions',
      description: 'List Azure subscriptions.',
      category: undefined,
      goldenPrompts: [],
      aliases: 'subs, azure subs, ms subs',
    });
    // All three alias tokens must appear in the embedded text.
    expect(text).toContain('subs');
    expect(text).toContain('azure subs');
    expect(text).toContain('ms subs');
  });

  it('usage_examples contribute the prompt field (rationale field stays out)', () => {
    const text = toSearchEmbeddingText({
      toolName: 'aws_list_ec2_instances',
      description: 'List EC2 instances.',
      category: undefined,
      goldenPrompts: [],
      usage_examples: [
        { prompt: 'what EC2 boxes are running', picked_because: "'EC2 boxes' = ec2 instances" },
      ],
    });
    expect(text).toContain('what EC2 boxes are running');
    // 'picked_because' is metadata — NOT in the embed surface.
    expect(text).not.toContain("'EC2 boxes' = ec2 instances");
  });
});
