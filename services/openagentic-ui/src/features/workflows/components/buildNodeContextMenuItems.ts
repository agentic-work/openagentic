/**
 * buildNodeContextMenuItems
 *
 * Pure factory — returns the menu entries shown when the user
 * right-clicks a canvas node. Kept pure so the rule logic (which
 * items show, which are disabled, label flips for stateful items)
 * can be exercised without mounting React Flow.
 *
 * Wire-up: WorkflowsContainer renders <NodeContextMenu items={...}/>
 * with the result of this call, fed by WorkflowCanvas's
 * onNodeContextMenu callback.
 */

import type { Node } from 'reactflow';
import type { NodeContextMenuItem } from './NodeContextMenu';

export interface NodeContextMenuHandlers {
  /** Open the inspector / node-properties panel for this node. */
  onConfigure: (node: Node) => void;
  /** Duplicate the node (copy + paste-with-offset). */
  onDuplicate: (nodeId: string) => void;
  /** Toggle data.disabled — disabled nodes are skipped at run time. */
  onToggleDisabled: (nodeId: string) => void;
  /** Delete the node from the canvas. */
  onDelete: (nodeId: string) => void;
}

export function buildNodeContextMenuItems(
  node: Node,
  handlers: NodeContextMenuHandlers,
): NodeContextMenuItem[] {
  const isDisabled = (node.data as { disabled?: boolean } | undefined)?.disabled === true;
  const isTrigger = node.type === 'trigger';

  return [
    {
      id: 'configure',
      label: 'Configure',
      onSelect: () => handlers.onConfigure(node),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: '⌘D',
      onSelect: () => handlers.onDuplicate(node.id),
    },
    {
      id: 'toggle-disabled',
      label: isDisabled ? 'Enable' : 'Disable',
      onSelect: () => handlers.onToggleDisabled(node.id),
    },
    {
      id: 'delete',
      label: 'Delete',
      shortcut: 'Del',
      danger: true,
      // Triggers anchor a flow's input — deleting them leaves the flow
      // unrunnable, so we disable rather than allow accidental removal.
      disabled: isTrigger,
      onSelect: () => handlers.onDelete(node.id),
    },
  ];
}
