/**
 * Phase 11 — architecture completeness test.
 *
 * Pins the 10 outputTemplate slugs that the chat-pipeline refactor
 * design audit identified as required primitives. Every slug here
 * MUST resolve to a concrete component (not the StreamingMarkdown
 * fallback) — if a future refactor removes a registry entry, this
 * test trips and the regression is surfaced in CI.
 *
 * the design notes
 * the design notes
 *       Phase 11, Task 11.30 (registry completeness arch test).
 */

import { describe, it, expect } from 'vitest';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';

const REQUIRED_SLUGS: ReadonlyArray<string> = [
  'dc_map',
  'gate',
  'gap_list',
  'stack_grid',
  'viz_head',
  'findings_severity',
  'cost_savings',
  'runbook_steps',
  'wave_timeline',
  'agent_tree',
];

describe('arch: FrameRendererRegistry covers all 10 Phase 11 primitives', () => {
  it.each(REQUIRED_SLUGS)('%s slug resolves to a concrete component (not the fallback)', (slug) => {
    expect(FrameRendererRegistry.has(slug)).toBe(true);
    const C = FrameRendererRegistry.lookup(slug);
    expect(C).toBeDefined();
    // Must NOT be the StreamingMarkdown fallback.
    expect((C as { displayName?: string }).displayName).not.toBe('StreamingMarkdown');
  });

  it('every slug resolves to a function or class component', () => {
    for (const slug of REQUIRED_SLUGS) {
      const C = FrameRendererRegistry.lookup(slug);
      expect(typeof C === 'function' || typeof C === 'object').toBe(true);
    }
  });
});
