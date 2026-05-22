/**
 * ReactFlowArchWidget — inline architecture / topology diagram.
 *
 * Why ReactFlow and not mermaid: mermaid's strict grammar trips on
 * special chars in DNS-style node IDs and edge labels, breaking silently
 * during parse so the UI just shows an empty card. ReactFlow takes a
 * flat {nodes, edges} JSON payload (which LLMs nail) and the renderer
 * is deterministic React.
 *
 * Server contract: `compose_visual` with template='reactflow_arch'
 * returns kind='reactflow_arch' and content = JSON.stringify({nodes, edges}).
 *
 * This widget lives outside the sandboxed iframe path used by the SVG/
 * HTML/mermaid kinds — ReactFlow is a React component that needs the
 * parent React tree + DOM.
 */
import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export interface ReactFlowArchWidgetProps {
  template: string;
  content: string;
  title?: string;
  className?: string;
}

interface ParsedFlow {
  nodes: any[];
  edges: any[];
}

function parseContent(content: string): { ok: true; data: ParsedFlow } | { ok: false; error: string } {
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, error: 'empty content' };
  }
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { ok: false, error: 'content must parse to { nodes: [], edges: [] }' };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as Error).message) : 'parse error';
    return { ok: false, error: `JSON parse failed: ${msg}` };
  }
}

export function ReactFlowArchWidget({ template, content, title, className }: ReactFlowArchWidgetProps) {
  const parsed = useMemo(() => parseContent(content), [content]);

  return (
    <div
      className={['cm-v2', 'cm-widget', 'cm-widget-reactflow', className || ''].filter(Boolean).join(' ')}
      data-widget-template={template}
      data-widget-kind="reactflow_arch"
      style={{ position: 'relative', margin: '12px 0' }}
    >
      <div
        className="cm-viz-head"
        data-testid="widget-viz-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: 'rgba(139,92,246,0.14)',
            display: 'grid',
            placeItems: 'center',
            color: '#8b5cf6',
            fontSize: 13,
          }}
        >
          🗺️
        </div>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: '#f8fafc' }}>
          compose_visual
        </span>
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(139,92,246,0.14)',
            color: '#8b5cf6',
            border: '1px solid rgba(139,92,246,0.32)',
            marginLeft: 4,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {template}
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#71717a' }}>
          {parsed.ok ? `${parsed.data.nodes.length} nodes · ${parsed.data.edges.length} edges` : 'render failed'}
        </span>
      </div>

      {parsed.ok ? (
        <div style={{ width: '100%', height: 420, background: 'transparent' }}>
          <ReactFlow
            nodes={parsed.data.nodes}
            edges={parsed.data.edges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      ) : (
        <div
          data-widget-render-error="true"
          role="alert"
          style={{
            padding: 16,
            color: 'var(--err, #ef4444)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12,
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.18)',
            borderRadius: 6,
            margin: 12,
          }}
        >
          reactflow_arch render failed — {parsed.error}
          {title ? <div style={{ opacity: 0.6, marginTop: 6 }}>title: {title}</div> : null}
        </div>
      )}
    </div>
  );
}

export default ReactFlowArchWidget;
