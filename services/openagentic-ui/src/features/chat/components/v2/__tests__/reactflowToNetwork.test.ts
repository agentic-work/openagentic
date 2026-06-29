/**
 * Sev-0 #835 — pin the ReactFlow→Network adapter contract.
 *
 * compose_visual's legacy reactflow_arch payload (the wire shape the model
 * emits today) must translate cleanly into the NetworkData shape consumed
 * by lib/charts Network, which uses d3-force for auto-layout (no model-
 * supplied coordinates required).
 */
import { describe, it, expect } from 'vitest';
import { reactflowToNetwork, parseReactflowContent } from '../reactflowToNetwork';

describe('reactflowToNetwork — pure adapter', () => {
  it('maps ReactFlow v11 {nodes:[{id,data:{label},position}], edges} → NetworkData', () => {
    const rf = {
      nodes: [
        { id: 'afd', data: { label: 'Azure Front Door (Premium)' }, type: 'edge', position: { x: 0, y: 0 } },
        { id: 'appgw-east', data: { label: 'AppGW WAF v2 (East US)' }, type: 'gateway', position: { x: 200, y: 0 } },
        { id: 'pool-east', data: { label: 'Backend Pool (East US 2)' }, type: 'backend', position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: 'e1', source: 'afd', target: 'appgw-east' },
        { id: 'e2', source: 'appgw-east', target: 'pool-east' },
      ],
    };

    const out = reactflowToNetwork(rf);

    expect(out.nodes).toEqual([
      { id: 'afd', name: 'Azure Front Door (Premium)', kind: 'edge' },
      { id: 'appgw-east', name: 'AppGW WAF v2 (East US)', kind: 'gateway' },
      { id: 'pool-east', name: 'Backend Pool (East US 2)', kind: 'backend' },
    ]);
    expect(out.links).toEqual([
      { source: 'afd', target: 'appgw-east', value: 1 },
      { source: 'appgw-east', target: 'pool-east', value: 1 },
    ]);
  });

  it('falls back to id when label missing, omits kind when type absent', () => {
    const rf = { nodes: [{ id: 'orphan' }], edges: [] };
    const out = reactflowToNetwork(rf);
    expect(out.nodes).toEqual([{ id: 'orphan', name: 'orphan' }]);
    expect(out.links).toEqual([]);
  });

  it('accepts top-level label and data.kind alternatives', () => {
    const rf = {
      nodes: [
        { id: '1', label: 'top-level-label', data: { kind: 'compute' } },
      ],
      edges: [],
    };
    const out = reactflowToNetwork(rf);
    expect(out.nodes).toEqual([{ id: '1', name: 'top-level-label', kind: 'compute' }]);
  });

  it('coerces numeric ids to strings + carries edge weight through to link.value', () => {
    const rf = {
      nodes: [{ id: 1, data: { label: 'a' } }, { id: 2, data: { label: 'b' } }],
      edges: [{ source: 1, target: 2, data: { weight: 5 } }],
    };
    const out = reactflowToNetwork(rf);
    expect(out.nodes.map(n => n.id)).toEqual(['1', '2']);
    expect(out.links[0]).toEqual({ source: '1', target: '2', value: 5 });
  });

  it('throws on malformed input', () => {
    expect(() => reactflowToNetwork(null as any)).toThrow();
    expect(() => reactflowToNetwork({ nodes: 'oops' } as any)).toThrow();
    expect(() => reactflowToNetwork({ nodes: [], edges: 'oops' } as any)).toThrow();
  });
});

describe('parseReactflowContent — defensive JSON wire-parse', () => {
  it('parses a valid JSON-stringified RF payload', () => {
    const raw = JSON.stringify({ nodes: [{ id: 'a' }], edges: [] });
    const parsed = parseReactflowContent(raw);
    expect(parsed).toEqual({ nodes: [{ id: 'a' }], edges: [] });
  });

  it('returns null on malformed JSON (so caller renders fallback, not crash)', () => {
    expect(parseReactflowContent('{not json')).toBeNull();
    expect(parseReactflowContent('')).toBeNull();
    expect(parseReactflowContent('"just a string"')).toBeNull();
    expect(parseReactflowContent(JSON.stringify({ nodes: 'not array', edges: [] }))).toBeNull();
  });
});
