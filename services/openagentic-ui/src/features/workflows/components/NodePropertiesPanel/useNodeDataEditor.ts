/**
 * useNodeDataEditor — the data-editing backbone of the Node Properties Panel.
 *
 * Owns the working copy of the selected node's data (`nodeData`), the dirty
 * flag (`hasChanges`), the typed setter (`updateData`), the two single-spot
 * assertion helpers (`selectValue` / `asField`), and the narrowed readers
 * (`fieldStr` / `fieldNum` / `fieldBool` / `fieldRaw`).
 *
 * Behaviour is preserved exactly from the pre-split inline implementation —
 * every `field*` reader returns the fallback for ANY falsy stored value (the
 * same truthiness test `||` applied at the original call sites).
 */

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Node } from 'reactflow';
import type { NodeData } from '../../types/workflow.types';
import type { NodeDataEditor } from './types';

export function useNodeDataEditor(node: Node<NodeData> | null): NodeDataEditor {
  const [nodeData, setNodeData] = useState<NodeData>(node?.data || {} as NodeData);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (node?.data) {
      setNodeData(node.data);
      setHasChanges(false);
    }
  }, [node]);

  // Typed setter. `NodeData` carries a `[key: string]: unknown` index signature,
  // so `keyof NodeData` admits both the declared fields (typed precisely) and any
  // extended string key (typed `unknown`). That lets every call site pass the
  // real value with no cast:
  //   - declared field  -> value is checked against its exact type
  //   - extended field  -> value widens to `unknown`, so anything is accepted
  // The only sites that still need a hint are <select> handlers whose
  // `e.target.value` is a raw `string` feeding a string-literal union — those use
  // `selectValue()` below, which asserts once, in one place, instead of per site.
  const updateData = <K extends keyof NodeData>(key: K, value: NodeData[K]) => {
    setNodeData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // Narrow a change/select event's string value to a declared union field type.
  // Centralises the single unavoidable assertion (a `<select>` always yields a
  // raw `string`) so call sites read `updateData('operator', selectValue(e, 'operator'))`
  // rather than an untyped cast on `e.target.value` at every handler.
  const selectValue = <K extends keyof NodeData>(
    e: ChangeEvent<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>,
    _key: K,
  ): NodeData[K] => e.target.value as NodeData[K];

  // Same single-assertion idea for custom select components whose onChange hands
  // back a raw `string` (not a DOM event) destined for a string-literal union field.
  const asField = <K extends keyof NodeData>(value: string, _key: K): NodeData[K] =>
    value as NodeData[K];

  // Typed reads off `nodeData` for fields the interface exposes only via the
  // `unknown` index signature (extended node-type fields like `webhookUrl`,
  // `message`, `expression`, …). These replace untyped `nodeData` field reads
  // with a single narrowed accessor and never widen to `any`. Each preserves the
  // original `field || fallback` read semantics exactly: the helper
  // returns `fallback` for ANY falsy stored value (the same truthiness test `||`
  // applied), so swapping the cast for the helper is behaviour-preserving.
  const fieldStr = (key: string, fallback = ''): string => {
    const v = (nodeData as Record<string, unknown>)[key];
    return v ? (typeof v === 'string' ? v : String(v)) : fallback;
  };
  const fieldNum = (key: string, fallback: number): number => {
    const v = (nodeData as Record<string, unknown>)[key];
    if (!v) return fallback;
    if (typeof v === 'number') return v;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  };
  const fieldBool = (key: string): boolean =>
    Boolean((nodeData as Record<string, unknown>)[key]);
  // Raw escape hatch for the few reads consumed as `unknown` (Array.isArray,
  // JSON.stringify, comparisons) — still typed, never `any`.
  const fieldRaw = (key: string): unknown => (nodeData as Record<string, unknown>)[key];

  return {
    nodeData,
    hasChanges,
    setHasChanges,
    updateData,
    selectValue,
    asField,
    fieldStr,
    fieldNum,
    fieldBool,
    fieldRaw,
  };
}
