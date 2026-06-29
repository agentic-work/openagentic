/**
 * B3 / mock-06 — completed tool-card opens to INPUT/RESULT panels.
 *
 * Round-18 chatmode parity gap: the "11 tools completed" group shows each
 * tool as a one-line summary row (Tool Search · List Subscriptions · ...).
 * The user complaint is that clicking those summary rows does NOT expand to
 * show the request/response payload. Mock 06 lines 267-349 specifies each
 * completed tool card MUST be independently openable to a body with a
 * `<pill>INPUT</pill>` section and a `<pill>RESULT</pill>` section.
 *
 * The exact source contract here:
 *   - Each collapsed row carries a `data-collapsed-row` data attribute so
 *     test selectors are stable.
 *   - Each row is a <button> with aria-expanded.
 *   - Clicking it toggles a sibling body with `data-testid="tool-input"`
 *     and `data-testid="tool-result"` (mirrors v2/ToolCard semantics).
 *
 * Source-content style — full runtime mount of AgenticActivityStream is too
 * heavy (3247 LOC, many dynamic imports). We assert the JSX surface so a
 * regression that drops the click handler or the panel data-testids is
 * caught by the architecture suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// God-file decomposition (behavior-preserving): CollapsedToolRow + the
// per-row open-state wiring were extracted into the serial-cluster module.
const SRC = join(__dirname, '..', 'AgenticActivityStream', 'TreeToolCallGroup.tsx');

describe('B3 — completed inline tool row click-to-expand (mock 06:267-349)', () => {
  const src = readFileSync(SRC, 'utf8');

  it('renders each collapsed row as a <button> tagged data-collapsed-row', () => {
    // Pin the collapsed-view block by the loop comment that introduces it.
    // The original site is "/* Collapsed: per-tool one-line summary */".
    expect(src).toMatch(/data-collapsed-row/);
  });

  it('each collapsed row carries aria-expanded reflecting its open state', () => {
    // Inline row uses aria-expanded={isRowOpen} as the disclosure signal.
    expect(src).toMatch(/aria-expanded=\{rowOpen/);
  });

  it('renders <CollapsedToolRow> with onToggle that flips the open state', () => {
    // The extracted row component must expose an onToggle callback so the
    // click handler closes over a per-row state slot rather than a parent
    // monolith — keeps re-renders cheap and selectors stable.
    expect(src).toMatch(/CollapsedToolRow/);
    expect(src).toMatch(/setOpenRowIds/);
  });

  it('open row mounts data-testid="tool-input" + data-testid="tool-result" panels', () => {
    // Mirror v2/ToolCard test contract — the panels carry the same
    // data-testids so the Playwright B3 spec selectors are stable across
    // both the in-flight v2/ToolCard path and the historical-summary path.
    expect(src).toMatch(/data-testid="tool-input"/);
    expect(src).toMatch(/data-testid="tool-result"/);
  });

  it('open row shows INPUT label + RESULT label per mock-06 .t-label pills', () => {
    // The pill markers under the dt of each section. Match either uppercased
    // text node "INPUT" / "RESULT" (mock-style) or aria-label.
    expect(src).toMatch(/>INPUT</);
    expect(src).toMatch(/>RESULT</);
  });
});
