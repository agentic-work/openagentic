/**
 * applyTruncateTemplate — generic per-tool truncate_summary builder.
 *
 * Why this test exists: EnrichedToolService's `compileTruncateSummary` only
 * does `{{path}}` substitution — every per-tool template needs to manually
 * encode `count` / `state_counts` / sample-array digests in raw paths,
 * making the templates fragile for arrays-of-objects where the row shape
 * varies. `applyTruncateTemplate` adds a small DSL layer on top:
 *
 *   - `{{count}}`             — array length (or object key count)
 *   - `{{tenant_count}}`      — distinct value count for `digest_keys` path
 *   - `{{sample_names}}`      — first 5 items rendered as comma-joined string
 *   - `{{top_10_summary}}`    — first 10 items rendered as bullet list
 *   - dot-path resolution     — `{{state_counts.running}}` works for nested objects
 *   - missing path → "?"      — fail-soft, never crash a tool dispatch
 *
 * Plus the helper returns a `StructuredContent` with `data` = digest
 * object (just the extracted keys, not the full raw payload). The model
 * sees a 2KB summary instead of a 5MB inline blob; the full payload lives
 * in Redis behind the `artifactHandle`.
 *
 * Plan: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6.2
 *       (per-tool truncate_summary seeds).
 */
import { describe, it, expect } from 'vitest';
import { applyTruncateTemplate } from '../applyTruncateTemplate.js';

describe('applyTruncateTemplate', () => {
  it('substitutes {{count}} with top-level array length', () => {
    const raw = { subscriptions: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const out = applyTruncateTemplate(raw, {
      template: '{{count}} subscriptions.',
      digestKeys: [],
      countPath: 'subscriptions',
    });
    expect(out.summary).toBe('3 subscriptions.');
    expect(out.truncated).toBe(true);
  });

  it('extracts dot-path digest values via digestKeys', () => {
    const raw = {
      subscription_id: 'sub-xyz',
      state_counts: { running: 12, stopped: 3 },
    };
    const out = applyTruncateTemplate(raw, {
      template: 'subscription {{subscription_id}} has {{state_counts.running}} running.',
      digestKeys: ['subscription_id', 'state_counts'],
    });
    expect(out.summary).toBe('subscription sub-xyz has 12 running.');
    expect(out.data).toEqual({
      subscription_id: 'sub-xyz',
      state_counts: { running: 12, stopped: 3 },
    });
  });

  it('extracts sample arrays — first N items, comma-joined names', () => {
    const raw = {
      items: [
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' },
        { name: 'Delta' },
        { name: 'Epsilon' },
        { name: 'Zeta' },
        { name: 'Eta' },
      ],
    };
    const out = applyTruncateTemplate(raw, {
      template: 'First 5: {{sample_names}}.',
      digestKeys: ['sample'],
      countPath: 'items',
      samplePath: 'items',
      sampleNameKey: 'name',
      sampleSize: 5,
    });
    // Only the first 5 names appear.
    expect(out.summary).toBe('First 5: Alpha, Beta, Gamma, Delta, Epsilon.');
  });

  it('renders "?" for missing-key paths (fail-soft)', () => {
    const raw = { count: 3 };
    const out = applyTruncateTemplate(raw, {
      template: 'has {{count}} items; first is {{items.[0].name}}.',
      digestKeys: [],
    });
    expect(out.summary).toBe('has 3 items; first is ?.');
  });

  it('summarizes 10MB payload into < 2KB (digest fits in model context)', () => {
    const items: Array<Record<string, string>> = [];
    for (let i = 0; i < 50_000; i++) {
      // Each row ~200 bytes => ~10MB total
      items.push({
        id: `id-${i}`,
        name: `Item ${i}`,
        filler: 'x'.repeat(150),
      });
    }
    const raw = { items };
    const rawSize = JSON.stringify(raw).length;
    expect(rawSize).toBeGreaterThan(5 * 1024 * 1024); // sanity — well above 30KB inline cap

    const out = applyTruncateTemplate(raw, {
      template: '{{count}} items. First 5: {{sample_names}}.',
      digestKeys: ['count'],
      countPath: 'items',
      samplePath: 'items',
      sampleNameKey: 'name',
      sampleSize: 5,
    });

    const outSize = JSON.stringify(out).length;
    expect(outSize).toBeLessThan(2048);
    expect(out.summary).toMatch(/^50000 items\. First 5: Item 0, Item 1, Item 2, Item 3, Item 4\.$/);
  });

  it('handles malformed raw (string, null, undefined) without crashing', () => {
    expect(() =>
      applyTruncateTemplate(null, { template: '{{count}}', digestKeys: [] }),
    ).not.toThrow();
    expect(() =>
      applyTruncateTemplate(undefined, { template: '{{count}}', digestKeys: [] }),
    ).not.toThrow();
    expect(() =>
      applyTruncateTemplate('a string', { template: '{{count}}', digestKeys: [] }),
    ).not.toThrow();

    const out = applyTruncateTemplate(null, {
      template: '{{count}} items.',
      digestKeys: [],
    });
    expect(out.summary).toBe('? items.');
    expect(out.truncated).toBe(true);
  });
});
