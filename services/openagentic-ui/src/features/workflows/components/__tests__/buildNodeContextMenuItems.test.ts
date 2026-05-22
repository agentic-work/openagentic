/**
 * buildNodeContextMenuItems — pure factory that builds the menu
 * items shown on right-click of a canvas node. Keeping this pure
 * lets us unit-test the rule logic (which entries appear, which
 * are disabled, in what order) without dragging React Flow into
 * the test.
 *
 * Spec:
 *   - Always: Configure, Duplicate, Disable/Enable, Delete (in
 *     that order; Delete is danger-flagged).
 *   - Each item's onSelect calls the matching handler with the
 *     node's id (Configure passes the whole node so the inspector
 *     can hydrate).
 *   - When the node is already disabled (data.disabled === true),
 *     the toggle item label flips from "Disable" to "Enable".
 *   - The 'trigger' node type cannot be deleted — its Delete
 *     entry renders disabled.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Node } from 'reactflow';
import { buildNodeContextMenuItems } from '../buildNodeContextMenuItems';

function mkNode(partial: Partial<Node> = {}): Node {
  return {
    id: partial.id ?? 'n1',
    type: partial.type ?? 'mcp_tool',
    position: { x: 0, y: 0 },
    data: partial.data ?? {},
    ...partial,
  } as Node;
}

describe('buildNodeContextMenuItems', () => {
  const handlers = {
    onConfigure: vi.fn(),
    onDuplicate: vi.fn(),
    onToggleDisabled: vi.fn(),
    onDelete: vi.fn(),
  };

  it('returns Configure, Duplicate, Disable, Delete in order for a normal node', () => {
    const items = buildNodeContextMenuItems(mkNode(), handlers);
    expect(items.map((i) => i.id)).toEqual(['configure', 'duplicate', 'toggle-disabled', 'delete']);
    expect(items.map((i) => i.label)).toEqual(['Configure', 'Duplicate', 'Disable', 'Delete']);
  });

  it('flips Disable → Enable when the node is already disabled', () => {
    const items = buildNodeContextMenuItems(
      mkNode({ data: { disabled: true } }),
      handlers,
    );
    const toggle = items.find((i) => i.id === 'toggle-disabled')!;
    expect(toggle.label).toBe('Enable');
  });

  it('marks the Delete item with danger=true', () => {
    const items = buildNodeContextMenuItems(mkNode(), handlers);
    const del = items.find((i) => i.id === 'delete')!;
    expect(del.danger).toBe(true);
  });

  it('disables Delete on a trigger node (the flow needs an entry point)', () => {
    const items = buildNodeContextMenuItems(mkNode({ type: 'trigger' }), handlers);
    const del = items.find((i) => i.id === 'delete')!;
    expect(del.disabled).toBe(true);
  });

  it('Configure receives the whole node, others receive the node id', () => {
    const localHandlers = {
      onConfigure: vi.fn(),
      onDuplicate: vi.fn(),
      onToggleDisabled: vi.fn(),
      onDelete: vi.fn(),
    };
    const node = mkNode({ id: 'abc' });
    const items = buildNodeContextMenuItems(node, localHandlers);
    items.find((i) => i.id === 'configure')!.onSelect();
    items.find((i) => i.id === 'duplicate')!.onSelect();
    items.find((i) => i.id === 'toggle-disabled')!.onSelect();
    items.find((i) => i.id === 'delete')!.onSelect();
    expect(localHandlers.onConfigure).toHaveBeenCalledWith(node);
    expect(localHandlers.onDuplicate).toHaveBeenCalledWith('abc');
    expect(localHandlers.onToggleDisabled).toHaveBeenCalledWith('abc');
    expect(localHandlers.onDelete).toHaveBeenCalledWith('abc');
  });
});
