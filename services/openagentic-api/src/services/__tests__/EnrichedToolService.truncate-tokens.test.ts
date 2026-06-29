/**
 * EnrichedToolService.compileTruncateSummary — auto-token upgrade.
 *
 * Why this test exists: the existing compiler does pure dot-path lookup, so
 * `{{count}}` only works when raw has a literal `count` property. Real MCP
 * tool results typically return arrays (e.g. `[{name:'sub-1'},...]`) or root
 * objects with the array under a property name (`{subscriptions:[...]}`)
 * and never carry an explicit `count` integer. The seeded templates like
 * `{{count}} Azure subscriptions` therefore resolved to `? Azure subscriptions`.
 *
 * After this slice:
 *   - `{{count}}` auto-resolves to the length of the first top-level array
 *     property (or to the array length when raw is an array itself), but
 *     ONLY when raw doesn't have a literal `.count` property — raw-side
 *     wins for back-compat with the existing tests at
 *     EnrichedToolService.test.ts:211 ({{count}} on {count:7} → "7 items.").
 *   - `{{sample_names}}` resolves to the first 5 items' `name` fields,
 *     comma-joined, drawn from the same array.
 *
 * Pin: every existing test must still pass — the upgrade is additive, never
 * replaces dot-path lookup.
 */
import { describe, it, expect } from 'vitest';
import { compileTruncateSummary } from '../EnrichedToolService.js';

describe('compileTruncateSummary — auto-token upgrade', () => {
  it('{{count}} resolves to top-level array length when raw IS an array', () => {
    const fn = compileTruncateSummary('{{count}} items.');
    const out = fn([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(out.summary).toBe('3 items.');
  });

  it('{{count}} resolves to first-array-property length when raw is an object containing an array', () => {
    const fn = compileTruncateSummary('{{count}} Azure subscriptions.');
    const out = fn({
      subscriptions: [{ id: 's-1' }, { id: 's-2' }, { id: 's-3' }, { id: 's-4' }],
    });
    expect(out.summary).toBe('4 Azure subscriptions.');
  });

  it('raw-side {{count}} property STILL WINS over the auto-token (back-compat)', () => {
    const fn = compileTruncateSummary('{{count}} items.');
    // The original behavior (count=7 from raw.count) must be preserved.
    const out = fn({ count: 7 });
    expect(out.summary).toBe('7 items.');
  });

  it('{{sample_names}} resolves to first-5 item names from the first top-level array', () => {
    const fn = compileTruncateSummary('First 5: {{sample_names}}.');
    const out = fn({
      subscriptions: [
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' },
        { name: 'Delta' },
        { name: 'Epsilon' },
        { name: 'Zeta' },
      ],
    });
    expect(out.summary).toBe('First 5: Alpha, Beta, Gamma, Delta, Epsilon.');
  });

  it('truncated: true is set on every compiled template', () => {
    const fn = compileTruncateSummary('any template');
    const out = fn({ anything: true });
    expect(out.truncated).toBe(true);
  });

  it('large payload produces small summary (< 2KB) — no raw inline', () => {
    const items: Array<Record<string, string>> = [];
    for (let i = 0; i < 10_000; i++) {
      items.push({ name: `Item ${i}`, filler: 'x'.repeat(200) });
    }
    const raw = { items };
    const rawSize = JSON.stringify(raw).length;
    expect(rawSize).toBeGreaterThan(2 * 1024 * 1024);

    const fn = compileTruncateSummary('{{count}} items. First 5: {{sample_names}}.');
    const out = fn(raw);
    const outSize = JSON.stringify(out).length;
    expect(outSize).toBeLessThan(2048);
    expect(out.summary).toBe('10000 items. First 5: Item 0, Item 1, Item 2, Item 3, Item 4.');
  });
});
