/**
 * Pre-flight validator tests — specifically pins the transform node
 * schema gap reported by user 2026-05-14 round 2.
 *
 * The validator was flagging every transform node that uses the modern
 * `operations[]` shape as "missing transformType", which surfaces in the
 * canvas as a "2 Errors" toolbar pill on every template using the shape.
 *
 * Engine contract (services/shared/workflow-engine/src/nodes/transform/
 * executor.ts:117): `operations[]` is the canonical, priority shape;
 * the legacy `transformType` is a fallback. The validator must mirror
 * that — either shape (with the appropriate sibling fields) is valid.
 */
import { describe, it, expect } from 'vitest';
import { validateNode } from '../workflowValidator';

const NO_EDGES: any[] = [];
const NO_NODES: any[] = [];

describe('workflowValidator — transform node schema', () => {
  it('zero errors when operations[] is non-empty (modern shape)', () => {
    const result = validateNode(
      'transform-1',
      'transform',
      {
        operations: [
          { op: 'set', target: 'foo', value: 'bar' },
        ],
      },
      NO_EDGES,
      NO_NODES,
    );
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('zero errors when transformType is set (legacy shape)', () => {
    const result = validateNode(
      'transform-2',
      'transform',
      { transformType: 'map', transformExpression: 'x => x' },
      NO_EDGES,
      NO_NODES,
    );
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('zero errors when both shapes coexist', () => {
    const result = validateNode(
      'transform-3',
      'transform',
      {
        transformType: 'map',
        operations: [{ op: 'set', target: 'foo', value: 'bar' }],
      },
      NO_EDGES,
      NO_NODES,
    );
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('one error when neither shape is set (legitimate missing config)', () => {
    const result = validateNode(
      'transform-4',
      'transform',
      {},
      NO_EDGES,
      NO_NODES,
    );
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('one error when operations is empty array', () => {
    const result = validateNode(
      'transform-5',
      'transform',
      { operations: [] },
      NO_EDGES,
      NO_NODES,
    );
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
