/**
 * WorkflowCompiler — exhaustive guard suite.
 *
 * The compiler is what the engine consults BEFORE every run to reject
 * malformed flows up-front. Coverage was 4.53% (0% function) — every
 * error code was a runtime-only path until this suite locked them in.
 *
 * One test per error code in CompilationResult; topological-sort
 * guarantees; warnings vs errors separation.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowCompiler, type CompilationError } from '../WorkflowCompiler.js';

const compiler = new WorkflowCompiler();

function flow(nodes: any[], edges: any[] = []): any {
  return { nodes, edges };
}

const T = {
  trigger: (id = 'trig', extra: Record<string, any> = {}) => ({
    id,
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { label: 'manual', triggerType: 'manual', ...extra },
  }),
  text: (id: string, extra: Record<string, any> = {}) => ({
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { label: 'note', content: 'hello', ...extra },
  }),
  edge: (id: string, source: string, target: string) => ({ id, source, target }),
};

describe('WorkflowCompiler', () => {
  describe('basic structural errors', () => {
    it('EMPTY_WORKFLOW when nodes array is empty', () => {
      const r = compiler.compile(flow([]));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: CompilationError) => e.code === 'EMPTY_WORKFLOW')).toBe(true);
    });

    it('MISSING_NODE_ID when a node has no id', () => {
      const r = compiler.compile(flow([{ type: 'trigger', data: {}, position: { x: 0, y: 0 } } as any]));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: CompilationError) => e.code === 'MISSING_NODE_ID')).toBe(true);
    });

    it('DUPLICATE_NODE_ID when two nodes share an id', () => {
      const r = compiler.compile(flow([T.trigger('same'), T.text('same')]));
      expect(r.valid).toBe(false);
      const dup = r.errors.find((e: CompilationError) => e.code === 'DUPLICATE_NODE_ID');
      expect(dup).toBeTruthy();
      expect(dup!.nodeId).toBe('same');
    });

    it('UNKNOWN_NODE_TYPE for a type that is neither schema-driven nor in the legacy allowlist', () => {
      const r = compiler.compile(
        flow([T.trigger(), { id: 'bad', type: 'definitely_not_a_node_type', data: {}, position: { x: 0, y: 0 } } as any]),
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e: CompilationError) => e.code === 'UNKNOWN_NODE_TYPE' && e.nodeId === 'bad')).toBe(true);
    });
  });

  describe('edge validation', () => {
    it('DUPLICATE_EDGE_ID when two edges share an id', () => {
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b')],
          [T.edge('e1', 'a', 'b'), T.edge('e1', 'a', 'b')],
        ),
      );
      expect(r.valid).toBe(false);
      const dup = r.errors.find((e: CompilationError) => e.code === 'DUPLICATE_EDGE_ID');
      expect(dup).toBeTruthy();
    });

    it('DANGLING_EDGE_SOURCE when source node id does not exist', () => {
      const r = compiler.compile(
        flow([T.trigger('a'), T.text('b')], [T.edge('e', 'ghost', 'b')]),
      );
      expect(r.errors.some((e: CompilationError) => e.code === 'DANGLING_EDGE_SOURCE')).toBe(true);
    });

    it('DANGLING_EDGE_TARGET when target node id does not exist', () => {
      const r = compiler.compile(
        flow([T.trigger('a'), T.text('b')], [T.edge('e', 'a', 'ghost')]),
      );
      expect(r.errors.some((e: CompilationError) => e.code === 'DANGLING_EDGE_TARGET')).toBe(true);
    });
  });

  describe('cycle detection', () => {
    it('CYCLE_DETECTED on a 2-node cycle', () => {
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b')],
          [T.edge('e1', 'a', 'b'), T.edge('e2', 'b', 'a')],
        ),
      );
      expect(r.errors.some((e: CompilationError) => e.code === 'CYCLE_DETECTED')).toBe(true);
      expect(r.metadata.hasCycles).toBe(true);
    });

    it('does NOT flag a self-loop on a control-flow node (loop) — those are intentional', () => {
      // Loop nodes are control-flow and back-edges to them are part of
      // their semantic. The engine compiler exempts these — see CONTROL_FLOW_TYPES.
      const r = compiler.compile(
        flow(
          [
            T.trigger('a'),
            { id: 'l', type: 'loop', data: { label: 'loop' }, position: { x: 0, y: 0 } } as any,
            T.text('b'),
          ],
          [
            T.edge('e1', 'a', 'l'),
            T.edge('e2', 'l', 'b'),
            T.edge('e3', 'b', 'l'), // back-edge — control-flow exemption
          ],
        ),
      );
      expect(r.errors.some((e: CompilationError) => e.code === 'CYCLE_DETECTED')).toBe(false);
    });
  });

  describe('topological sort', () => {
    it('produces an executionOrder that respects edge order (a → b → c)', () => {
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b'), T.text('c')],
          [T.edge('e1', 'a', 'b'), T.edge('e2', 'b', 'c')],
        ),
      );
      expect(r.valid).toBe(true);
      const ord = r.executionOrder;
      expect(ord.indexOf('a')).toBeLessThan(ord.indexOf('b'));
      expect(ord.indexOf('b')).toBeLessThan(ord.indexOf('c'));
    });

    it('produces an executionOrder when graph is a fan-out (one source, two sinks)', () => {
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b'), T.text('c')],
          [T.edge('e1', 'a', 'b'), T.edge('e2', 'a', 'c')],
        ),
      );
      expect(r.valid).toBe(true);
      const ord = r.executionOrder;
      expect(ord[0]).toBe('a');
      expect(ord).toContain('b');
      expect(ord).toContain('c');
    });

    it('returns valid=false but executionOrder=[] on cycle', () => {
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b')],
          [T.edge('e1', 'a', 'b'), T.edge('e2', 'b', 'a')],
        ),
      );
      expect(r.valid).toBe(false);
      expect(r.executionOrder).toEqual([]);
    });
  });

  describe('warnings vs errors separation', () => {
    it('valid=true on a clean flow even when warnings are produced', () => {
      // A clean fan-in/fan-out flow — nothing should error, anything
      // surfaced is a warning at most.
      const r = compiler.compile(
        flow(
          [T.trigger('a'), T.text('b')],
          [T.edge('e1', 'a', 'b')],
        ),
      );
      expect(r.valid).toBe(true);
      expect(r.errors).toEqual([]);
    });
  });
});
