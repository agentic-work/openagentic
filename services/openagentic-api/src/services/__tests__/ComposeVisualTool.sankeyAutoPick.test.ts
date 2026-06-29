/**
 * Phase 28 — sankey auto-pick: when input.template === 'sankey' but the
 * `flows` describe a 3-column dependency (i.e. some `to` nodes also
 * appear as `from` nodes for downstream flows), upgrade silently to the
 * `sankey_3col` template using the existing renderer.
 *
 * The model picks "sankey" with the simpler shape; the dispatcher
 * detects the 3-column structure and routes to the 3-col gradient
 * renderer for free.
 */

import { describe, it, expect } from 'vitest';
import { isSankey3Col, mapSankeyTo3Col } from '../ComposeVisualTool.js';

describe('sankey auto-pick (Phase 28)', () => {
  it('isSankey3Col detects 3-column flows where to-nodes are also from-nodes', () => {
    const data = {
      flows: [
        { from: 'prod', to: 'core-api', value: 12450 },
        { from: 'prod', to: 'data', value: 8460 },
        { from: 'core-api', to: 'compute', value: 8000 },
        { from: 'core-api', to: 'storage', value: 4450 },
        { from: 'data', to: 'sql', value: 8460 },
      ],
    };
    expect(isSankey3Col(data)).toBe(true);
  });

  it('isSankey3Col returns false for plain 2-column flows', () => {
    const data = {
      flows: [
        { from: 'prod', to: 'compute', value: 100 },
        { from: 'prod', to: 'storage', value: 50 },
        { from: 'dev', to: 'sandbox', value: 25 },
      ],
    };
    expect(isSankey3Col(data)).toBe(false);
  });

  it('isSankey3Col returns false for empty / malformed input', () => {
    expect(isSankey3Col(null)).toBe(false);
    expect(isSankey3Col({})).toBe(false);
    expect(isSankey3Col({ flows: [] })).toBe(false);
    expect(isSankey3Col({ flows: 'nope' })).toBe(false);
  });

  it('mapSankeyTo3Col converts {flows} into {left, mid, right, flows_lm, flows_mr}', () => {
    const data = {
      flows: [
        { from: 'prod', to: 'core-api', value: 1000 },
        { from: 'prod', to: 'data', value: 500 },
        { from: 'core-api', to: 'compute', value: 600 },
        { from: 'core-api', to: 'storage', value: 400 },
        { from: 'data', to: 'sql', value: 500 },
      ],
    };
    const out = mapSankeyTo3Col(data);
    expect(out).not.toBeNull();
    expect(out!.left.map((n) => n.name)).toEqual(['prod']);
    expect(out!.mid.map((n) => n.name).sort()).toEqual(['core-api', 'data']);
    expect(out!.right.map((n) => n.name).sort()).toEqual(['compute', 'sql', 'storage']);
    expect(out!.flows_lm).toHaveLength(2);
    expect(out!.flows_mr).toHaveLength(3);
  });

  it('mapSankeyTo3Col returns null for non-3-col data', () => {
    expect(mapSankeyTo3Col({ flows: [{ from: 'a', to: 'b', value: 1 }] })).toBeNull();
  });
});
