/**
 * ELK.js Layout Engine
 *
 * Provides professional-grade graph layouts for React Flow diagrams.
 * Supports multiple layout algorithms for different diagram types.
 *
 * Layout Algorithms:
 * - layered: Best for flowcharts, DAGs, hierarchies (Sugiyama-style)
 * - force: Network graphs, organic layouts
 * - radial: Mind maps, org charts (nodes arranged in circles)
 * - stress: Complex interconnected graphs
 * - mrtree: Tree structures with proper parent-child spacing
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';
import type { DiagramNode, DiagramEdge, DiagramType } from './ReactFlowDiagram';

// ELK instance (singleton)
const elk = new ELK();

// ELK algorithm mapping based on diagram type
const LAYOUT_ALGORITHMS: Record<string, string> = {
  flowchart: 'layered',
  process: 'layered',
  sequence: 'layered',
  architecture: 'layered',
  statechart: 'layered',
  erd: 'layered',
  mindmap: 'mrtree',
  orgchart: 'mrtree',
  network: 'force',
  timeline: 'layered',
};

// ELK layout options by algorithm
const LAYOUT_OPTIONS: Record<string, Record<string, string>> = {
  layered: {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN', // TOP_DOWN for vertical, LEFT_RIGHT for horizontal
    'elk.spacing.nodeNode': '80',
    'elk.spacing.edgeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    'elk.layered.spacing.edgeNodeBetweenLayers': '40',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.partitioning.activate': 'true',
  },
  force: {
    'elk.algorithm': 'force',
    'elk.force.iterations': '300',
    'elk.spacing.nodeNode': '100',
    'elk.force.repulsion': '5.0',
    'elk.force.temperature': '0.001',
  },
  radial: {
    'elk.algorithm': 'radial',
    'elk.radial.radius': '200',
    'elk.spacing.nodeNode': '60',
    'elk.radial.compactor': 'WEDGE_COMPACTION',
    'elk.radial.centerOnRoot': 'true',
  },
  stress: {
    'elk.algorithm': 'stress',
    'elk.stress.desiredEdgeLength': '150',
    'elk.spacing.nodeNode': '80',
  },
  mrtree: {
    'elk.algorithm': 'mrtree',
    'elk.direction': 'DOWN',
    'elk.spacing.nodeNode': '60',
    'elk.mrtree.weighting': 'CONSTRAINT',
    'elk.mrtree.searchOrder': 'DFS',
  },
};

export interface ElkLayoutOptions {
  algorithm?: keyof typeof LAYOUT_OPTIONS;
  direction?: 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
  nodeWidth?: number;
  nodeHeight?: number;
  spacing?: number;
}

/**
 * Get ELK algorithm for diagram type
 */
export function getAlgorithmForType(type: DiagramType, layout?: string): string {
  if (layout === 'horizontal') return 'layered';
  if (layout === 'vertical') return 'layered';
  if (layout === 'radial') return 'radial';
  if (layout === 'force') return 'force';
  return LAYOUT_ALGORITHMS[type] || 'layered';
}

/**
 * Get ELK direction for layout orientation
 */
export function getDirection(layout?: string): string {
  if (layout === 'horizontal') return 'RIGHT';
  return 'DOWN';
}

/**
 * Convert diagram nodes/edges to ELK graph format
 */
function toElkGraph(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: ElkLayoutOptions = {}
): {
  id: string;
  layoutOptions: Record<string, string>;
  children: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ id: string; sources: string[]; targets: string[] }>;
} {
  const algorithm = options.algorithm || 'layered';
  const direction = options.direction || 'DOWN';
  const nodeWidth = options.nodeWidth || 180;
  const nodeHeight = options.nodeHeight || 70;

  // Get base layout options for algorithm
  const layoutOptions = LAYOUT_OPTIONS[algorithm] ? { ...LAYOUT_OPTIONS[algorithm] } : { ...LAYOUT_OPTIONS.layered };

  // Override direction if specified
  if (layoutOptions['elk.direction']) {
    layoutOptions['elk.direction'] = direction;
  }

  // Override spacing if specified
  if (options.spacing) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.spacing);
  }

  return {
    id: 'root',
    layoutOptions,
    children: nodes.map(node => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: edges.map((edge, i) => ({
      id: edge.id || `e${i}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/**
 * Layout nodes using ELK.js
 * Returns positioned React Flow nodes
 */
export async function layoutWithElk(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramType: DiagramType = 'flowchart',
  layout?: 'horizontal' | 'vertical' | 'radial' | 'force',
  customOptions: ElkLayoutOptions = {}
): Promise<{ x: number; y: number; id: string }[]> {
  // Determine algorithm and direction
  const algorithm = customOptions.algorithm || getAlgorithmForType(diagramType, layout);
  const direction = customOptions.direction || getDirection(layout);

  const elkGraph = toElkGraph(nodes, edges, {
    ...customOptions,
    algorithm: algorithm as keyof typeof LAYOUT_OPTIONS,
    direction: direction as 'DOWN' | 'UP' | 'LEFT' | 'RIGHT',
  });

  try {
    const layoutedGraph = await elk.layout(elkGraph);

    // Extract positions from layouted graph
    return (layoutedGraph.children || []).map(node => ({
      id: node.id,
      x: node.x || 0,
      y: node.y || 0,
    }));
  } catch (error) {
    console.error('ELK layout failed:', error);
    // Return original positions as fallback
    return nodes.map((node, i) => ({
      id: node.id,
      x: (i % 4) * 200,
      y: Math.floor(i / 4) * 150,
    }));
  }
}

/**
 * Create React Flow nodes with ELK-calculated positions
 */
export async function createLayoutedNodes(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramType: DiagramType = 'flowchart',
  layout?: 'horizontal' | 'vertical' | 'radial' | 'force',
  nodeStyle: (node: DiagramNode, index: number) => React.CSSProperties = () => ({})
): Promise<Node[]> {
  const positions = await layoutWithElk(nodes, edges, diagramType, layout);
  const positionMap = new Map(positions.map(p => [p.id, { x: p.x, y: p.y }]));

  return nodes.map((node, index) => {
    const pos = positionMap.get(node.id) || { x: 0, y: 0 };

    return {
      id: node.id,
      type: 'default',
      position: pos,
      data: {
        label: node.label,
        description: node.description,
      },
      className: 'react-flow-node-animated',
      style: nodeStyle(node, index),
      sourcePosition: layout === 'horizontal' ? 'right' : 'bottom',
      targetPosition: layout === 'horizontal' ? 'left' : 'top',
    } as Node;
  });
}

/**
 * Presets for common diagram types
 */
export const ELK_PRESETS = {
  flowchart: {
    algorithm: 'layered' as const,
    direction: 'DOWN' as const,
    spacing: 80,
  },
  architecture: {
    algorithm: 'layered' as const,
    direction: 'RIGHT' as const,
    spacing: 100,
  },
  mindmap: {
    algorithm: 'mrtree' as const,
    direction: 'DOWN' as const,
    spacing: 60,
  },
  network: {
    algorithm: 'force' as const,
    spacing: 100,
  },
  orgchart: {
    algorithm: 'mrtree' as const,
    direction: 'DOWN' as const,
    spacing: 80,
  },
};
