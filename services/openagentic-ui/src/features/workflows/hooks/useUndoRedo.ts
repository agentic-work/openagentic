/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Undo/Redo hook for the workflow canvas.
 * Maintains a history stack of node/edge snapshots.
 * Supports Ctrl+Z (undo) and Ctrl+Shift+Z / Ctrl+Y (redo).
 */

import { useCallback, useRef, useEffect } from 'react';
import type { Node, Edge } from 'reactflow';

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(
  nodes: Node[],
  edges: Edge[],
  setNodes: (nodes: Node[] | ((nds: Node[]) => Node[])) => void,
  setEdges: (edges: Edge[] | ((eds: Edge[]) => Edge[])) => void,
) {
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const isProgrammaticRef = useRef(false);
  const lastSnapshotRef = useRef<string>('');

  // Take a snapshot of current state (called on meaningful changes)
  const takeSnapshot = useCallback(() => {
    if (isProgrammaticRef.current) return;

    const snapshot: Snapshot = {
      nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: edges.map(e => ({ ...e })),
    };

    // Deduplicate: skip if identical to last snapshot
    const key = JSON.stringify({ n: snapshot.nodes.map(n => n.id + n.position?.x + n.position?.y), e: snapshot.edges.map(e => e.id) });
    if (key === lastSnapshotRef.current) return;
    lastSnapshotRef.current = key;

    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    // Clear future on new action
    futureRef.current = [];
  }, [nodes, edges]);

  // Undo: pop from history, push current to future
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;

    // Save current state to future
    futureRef.current.push({
      nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: edges.map(e => ({ ...e })),
    });

    // Restore previous state
    const prev = historyRef.current.pop()!;
    isProgrammaticRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    requestAnimationFrame(() => { isProgrammaticRef.current = false; });
  }, [nodes, edges, setNodes, setEdges]);

  // Redo: pop from future, push current to history
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;

    // Save current state to history
    historyRef.current.push({
      nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: edges.map(e => ({ ...e })),
    });

    // Restore next state
    const next = futureRef.current.pop()!;
    isProgrammaticRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    requestAnimationFrame(() => { isProgrammaticRef.current = false; });
  }, [nodes, edges, setNodes, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    takeSnapshot,
    undo,
    redo,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
