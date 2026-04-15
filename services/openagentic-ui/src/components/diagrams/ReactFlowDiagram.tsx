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

import React, { useCallback, useMemo, useEffect, useState, memo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  MarkerType,
  Position,
  BackgroundVariant,
  Handle,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';

// Initialize ELK instance
const elk = new ELK();

// =============================================================================
// TYPES
// =============================================================================

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'architecture'
  | 'mindmap'
  | 'orgchart'
  | 'statechart'
  | 'erd'
  | 'network'
  | 'timeline'
  | 'process';

export type NodeShape =
  | 'rectangle'
  | 'rounded'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'database'
  | 'cloud'
  | 'server'
  | 'container';

export type EdgeStyle = 'solid' | 'dashed' | 'dotted' | 'animated';

export interface DiagramNode {
  id: string;
  label: string;
  description?: string;
  shape?: NodeShape;
  color?: string;
  icon?: string;
  group?: string;
  metadata?: Record<string, unknown>;
}

export interface DiagramEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  style?: EdgeStyle;
  color?: string;
  animated?: boolean;
}

export interface DiagramDefinition {
  type: DiagramType;
  title?: string;
  description?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layout?: 'horizontal' | 'vertical' | 'radial' | 'force';
  theme?: 'light' | 'dark';
}

interface ReactFlowDiagramProps {
  diagram: DiagramDefinition;
  className?: string;
  height?: number | string;
  interactive?: boolean;
  showMiniMap?: boolean;
  showControls?: boolean;
}

// =============================================================================
// THEME DETECTION
// =============================================================================

const useThemeDetection = () => {
  const [isDark, setIsDark] = useState(true);
  // eslint-disable-next-line no-restricted-syntax -- Fallback color for initial state
  const [accentColor, setAccentColor] = useState('#0A84FF');

  useEffect(() => {
    const detectTheme = () => {
      const dataTheme = document.documentElement.getAttribute('data-theme');
      const hasLightClass = document.body.classList.contains('light-theme');
      setIsDark(dataTheme !== 'light' && !hasLightClass);

      const computedStyle = getComputedStyle(document.documentElement);
      const accent =
        computedStyle.getPropertyValue('--user-accent-primary').trim() ||
        computedStyle.getPropertyValue('--color-primary').trim() ||
        // eslint-disable-next-line no-restricted-syntax -- Fallback color
        '#0A84FF';
      setAccentColor(accent);
    };

    detectTheme();
    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return { isDark, accentColor };
};

// =============================================================================
// COLOR UTILITIES
// =============================================================================

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const cleanHex = hex.replace('#', '');
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(c => c + c).join('')
    : cleanHex;
  return {
    r: parseInt(fullHex.substring(0, 2), 16) || 0,
    g: parseInt(fullHex.substring(2, 4), 16) || 0,
    b: parseInt(fullHex.substring(4, 6), 16) || 0,
  };
};

// eslint-disable-next-line no-restricted-syntax -- Fallback color in function signature
const resolveColor = (color?: string, accent: string = '#0A84FF'): string => {
  if (!color) return accent;
  const colorMap: Record<string, string> = {
    primary: accent,
    accent: accent,
    secondary: '#3B82F6',
    blue: '#3b82f6',
    green: '#00D26A',
    red: '#ef4444',
    yellow: '#f59e0b',
    orange: '#f97316',
    purple: '#a855f7',
    pink: '#ec4899',
    cyan: '#06b6d4',
    teal: '#14b8a6',
    indigo: '#6366f1',
    gray: '#6b7280',
    azure: '#0078D4',
    gcp: '#4285F4',
    aws: '#FF9900',
    kubernetes: '#326CE5',
    docker: '#2496ED',
  };
  return colorMap[color.toLowerCase()] || color;
};

// =============================================================================
// CUSTOM NODE COMPONENT - This is key for reliable styling
// =============================================================================

interface CustomNodeData {
  label: string;
  description?: string;
  shape?: NodeShape;
  color?: string;
  isDark?: boolean;
  accentColor?: string;
  isHorizontal?: boolean;
  [key: string]: unknown;
}

const CustomNode = memo(({ data, selected }: NodeProps<Node<CustomNodeData>>) => {
  const {
    label,
    description,
    shape = 'rounded',
    color,
    isDark = true,
    // eslint-disable-next-line no-restricted-syntax -- Fallback color
    accentColor = '#0A84FF',
    isHorizontal = false,
  } = data;

  const resolvedColor = resolveColor(color, accentColor);
  const rgb = hexToRgb(resolvedColor);

  // Build the gradient and glow based on resolved color
  const bgGradient = isDark
    ? `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08) 100%)`
    : `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05) 100%)`;

  const borderColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
  const glowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;

  // Shape-specific styles
  const shapeStyles: Record<NodeShape, React.CSSProperties> = {
    rectangle: { borderRadius: '8px' },
    rounded: { borderRadius: '16px' },
    diamond: { borderRadius: '4px', transform: 'rotate(45deg)' },
    circle: { borderRadius: '50%', minWidth: '100px', minHeight: '100px', justifyContent: 'center' },
    hexagon: { borderRadius: '16px', clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' },
    database: { borderRadius: '8px', borderTop: `4px solid ${resolvedColor}` },
    cloud: { borderRadius: '50px' },
    server: { borderRadius: '8px', borderLeft: `4px solid ${resolvedColor}` },
    container: { borderRadius: '12px', borderStyle: 'dashed' },
  };

  const baseStyle: React.CSSProperties = {
    background: bgGradient,
    border: `2px solid ${borderColor}`,
    padding: '14px 20px',
    minWidth: '140px',
    maxWidth: '220px',
    color: isDark ? '#f8fafc' : '#1e293b',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    textAlign: 'center' as const,
    backdropFilter: 'blur(12px)',
    boxShadow: selected
      ? `0 0 0 2px ${resolvedColor}, 0 0 30px ${glowColor}, 0 8px 32px rgba(0,0,0,0.3)`
      : `0 0 20px ${glowColor}, 0 8px 32px rgba(0,0,0,0.2)`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    ...shapeStyles[shape],
  };

  return (
    <div style={baseStyle} className="custom-diagram-node">
      {/* Handles for connections */}
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        style={{ background: resolvedColor, border: 'none', width: 8, height: 8 }}
      />

      {/* Content - counter-rotate for diamond shape */}
      <div style={{ transform: shape === 'diamond' ? 'rotate(-45deg)' : 'none' }}>
        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
        {description && (
          <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px', fontWeight: 400 }}>
            {description}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        style={{ background: resolvedColor, border: 'none', width: 8, height: 8 }}
      />
    </div>
  );
});

CustomNode.displayName = 'CustomNode';

// Node types registry
const nodeTypes = {
  custom: CustomNode,
};

// =============================================================================
// ELK LAYOUT
// =============================================================================

const isLinearChain = (nodes: DiagramNode[], edges: DiagramEdge[]): boolean => {
  if (nodes.length <= 2) return true;
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  nodes.forEach((n) => {
    inCount.set(n.id, 0);
    outCount.set(n.id, 0);
  });
  edges.forEach((e) => {
    inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
    outCount.set(e.source, (outCount.get(e.source) || 0) + 1);
  });
  for (const node of nodes) {
    if ((inCount.get(node.id) || 0) > 1 || (outCount.get(node.id) || 0) > 1) {
      return false;
    }
  }
  return true;
};

// eslint-disable-next-line no-restricted-syntax -- Fallback color in function signature
const runElkLayout = async (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: 'horizontal' | 'vertical' | 'radial' | 'force' = 'vertical',
  diagramType: DiagramType = 'flowchart',
  isDark: boolean = true,
  accentColor: string = '#0A84FF'
): Promise<{ nodes: Node<CustomNodeData>[]; edges: Edge[]; isHorizontal: boolean }> => {
  if (nodes.length === 0) return { nodes: [], edges: [], isHorizontal: false };

  const isLinear = isLinearChain(nodes, edges);
  // Force horizontal for linear chains - much more readable
  const effectiveLayout = isLinear ? 'horizontal' : layout;
  const isHorizontal = effectiveLayout === 'horizontal';

  // ELK layout options
  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': isHorizontal ? 'RIGHT' : 'DOWN',
    'elk.spacing.nodeNode': '80',
    'elk.layered.spacing.nodeNodeBetweenLayers': isHorizontal ? '150' : '100',
    'elk.edgeRouting': 'SPLINES',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  };

  // Calculate node sizes
  const getNodeSize = (node: DiagramNode) => {
    const labelLen = node.label.length;
    const width = Math.max(140, Math.min(220, labelLen * 10 + 40));
    const height = node.description ? 80 : 60;
    if (node.shape === 'circle') return { width: 100, height: 100 };
    return { width, height };
  };

  // Build ELK graph
  const elkNodes = nodes.map((node) => {
    const size = getNodeSize(node);
    return { id: node.id, width: size.width, height: size.height };
  });

  const elkEdges = edges.map((edge, i) => ({
    id: edge.id || `e-${i}`,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const elkGraph = {
    id: 'root',
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const layoutResult = await elk.layout(elkGraph);

    // Convert to React Flow nodes
    const rfNodes: Node<CustomNodeData>[] = nodes.map((node) => {
      const elkNode = layoutResult.children?.find((n) => n.id === node.id);
      const position = elkNode ? { x: elkNode.x || 0, y: elkNode.y || 0 } : { x: 0, y: 0 };

      return {
        id: node.id,
        type: 'custom',
        position,
        data: {
          label: node.label,
          description: node.description,
          shape: node.shape || 'rounded',
          color: node.color,
          isDark,
          accentColor,
          isHorizontal,
        },
      };
    });

    // Convert to React Flow edges
    const rfEdges: Edge[] = edges.map((edge, i) => {
      const edgeColor = resolveColor(edge.color, accentColor);
      return {
        id: edge.id || `e-${i}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'smoothstep',
        animated: edge.animated || edge.style === 'animated',
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
          ...(edge.style === 'dashed' && { strokeDasharray: '8 4' }),
          ...(edge.style === 'dotted' && { strokeDasharray: '2 2' }),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 20,
          height: 20,
        },
        labelStyle: {
          fontSize: 11,
          fontWeight: 600,
          fill: isDark ? '#e5e7eb' : '#374151',
        },
        labelBgStyle: {
          fill: isDark ? 'rgba(30, 30, 46, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          fillOpacity: 1,
        },
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 6,
      };
    });

    return { nodes: rfNodes, edges: rfEdges, isHorizontal };
  } catch (error) {
    console.error('[ELK] Layout failed:', error);
    // Fallback: simple grid
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const rfNodes: Node<CustomNodeData>[] = nodes.map((node, i) => ({
      id: node.id,
      type: 'custom',
      position: { x: (i % cols) * 250, y: Math.floor(i / cols) * 150 },
      data: {
        label: node.label,
        description: node.description,
        shape: node.shape || 'rounded',
        color: node.color,
        isDark,
        accentColor,
        isHorizontal: false,
      },
    }));
    const rfEdges: Edge[] = edges.map((edge, i) => ({
      id: edge.id || `e-${i}`,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
    }));
    return { nodes: rfNodes, edges: rfEdges, isHorizontal: false };
  }
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const ReactFlowDiagram: React.FC<ReactFlowDiagramProps> = ({
  diagram,
  className = '',
  height = 500,
  interactive = true,
  showMiniMap = false,
  showControls = true,
}) => {
  const { isDark: detectedIsDark, accentColor } = useThemeDetection();
  const isDark = diagram.theme === 'light' ? false : diagram.theme === 'dark' ? true : detectedIsDark;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Run layout
  useEffect(() => {
    const doLayout = async () => {
      setIsLoading(true);
      const result = await runElkLayout(
        diagram.nodes,
        diagram.edges,
        diagram.layout,
        diagram.type,
        isDark,
        accentColor
      );
      setNodes(result.nodes);
      setEdges(result.edges);
      setIsLoading(false);
    };
    doLayout();
  }, [diagram, isDark, accentColor, setNodes, setEdges]);

  const rgb = hexToRgb(accentColor);
  const accentRgba = (opacity: number) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;

  return (
    <div
      className={`react-flow-diagram ${className}`}
      style={{
        height,
        width: '100%',
        borderRadius: '16px',
        border: `1px solid ${accentRgba(0.2)}`,
        background: isDark
          ? `linear-gradient(180deg, ${accentRgba(0.05)} 0%, transparent 100%), rgba(30, 30, 46, 0.8)`
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(20px)',
        boxShadow: isDark
          ? `0 0 40px ${accentRgba(0.15)}, 0 20px 60px rgba(0, 0, 0, 0.3)`
          : '0 4px 20px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      {diagram.title && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${accentRgba(0.15)}`,
            background: accentRgba(0.05),
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: accentColor,
              boxShadow: `0 0 12px ${accentRgba(0.6)}`,
            }}
          />
          <span style={{ fontSize: '14px', fontWeight: 600, color: isDark ? '#f8fafc' : '#1e293b' }}>
            {diagram.title}
          </span>
          {diagram.description && (
            <span style={{ fontSize: '12px', opacity: 0.6, color: isDark ? '#94a3b8' : '#64748b' }}>
              — {diagram.description}
            </span>
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            color: isDark ? '#94a3b8' : '#64748b',
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              border: `2px solid ${accentRgba(0.3)}`,
              borderTopColor: accentColor,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>Calculating layout...</span>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={interactive ? onNodesChange : undefined}
          onEdgesChange={interactive ? onEdgesChange : undefined}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.5 }}
          nodesDraggable={interactive}
          nodesConnectable={false}
          elementsSelectable={interactive}
          panOnDrag={interactive}
          zoomOnScroll={interactive}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={24}
            color={isDark ? accentRgba(0.08) : 'rgba(0,0,0,0.06)'}
          />
          {showControls && (
            <Controls
              style={{
                background: isDark ? 'rgba(30, 30, 46, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                borderRadius: '10px',
                border: `1px solid ${accentRgba(0.2)}`,
                boxShadow: `0 4px 20px rgba(0, 0, 0, 0.2)`,
              }}
            />
          )}
          {showMiniMap && (
            <MiniMap
              nodeColor={(n) => resolveColor(n.data?.color as string | undefined, accentColor)}
              maskColor={isDark ? 'rgba(30, 30, 46, 0.85)' : 'rgba(255, 255, 255, 0.85)'}
              style={{
                background: isDark ? 'rgba(30, 30, 46, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                borderRadius: '10px',
                border: `1px solid ${accentRgba(0.2)}`,
              }}
            />
          )}
        </ReactFlow>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .custom-diagram-node:hover {
          transform: translateY(-2px) scale(1.02);
          z-index: 100;
        }
      `}</style>
    </div>
  );
};

// =============================================================================
// JSON PARSER
// =============================================================================

export const parseDiagramJson = (json: string): DiagramDefinition | null => {
  const trimmed = json.trim();

  // Check for incomplete JSON (still streaming)
  if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) return null;
  const openBraces = (trimmed.match(/{/g) || []).length;
  const closeBraces = (trimmed.match(/}/g) || []).length;
  if (openBraces !== closeBraces) return null;

  try {
    const parsed = JSON.parse(json);
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) return null;

    const nodes: DiagramNode[] = parsed.nodes.map((n: any, i: number) => ({
      id: n.id || `node-${i}`,
      label: n.label || `Node ${i + 1}`,
      description: n.description,
      shape: n.shape || 'rounded',
      color: n.color,
      icon: n.icon,
      group: n.group,
      metadata: n.metadata,
    }));

    const edges: DiagramEdge[] = (parsed.edges || []).map((e: any, i: number) => ({
      id: e.id || `edge-${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      style: e.style || 'solid',
      color: e.color,
      animated: e.animated,
    }));

    return {
      type: parsed.type || 'flowchart',
      title: parsed.title,
      description: parsed.description,
      nodes,
      edges,
      layout: parsed.layout || 'vertical',
      theme: parsed.theme,
    };
  } catch {
    return null;
  }
};

export default ReactFlowDiagram;
