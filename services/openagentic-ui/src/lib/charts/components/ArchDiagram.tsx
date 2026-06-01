/**
 * ArchDiagram — stencil-based architecture diagram.
 *
 * Replaces the old ReactFlow-based `reactflow_arch` compose_visual
 * template + the docs-site ReactFlowDiagram. The model emits resource-
 * typed nodes ({id, type: 'aws_s3', label, sublabel}) and semantic
 * edges ({from, to, kind: 'flow'|'data'|'auth'|'control'}) — no x/y
 * coordinates. Dagre auto-lays out left-to-right (or top-to-bottom
 * via `direction`), every node renders its vendor stencil from
 * src/lib/charts/icons/registry.tsx, edges get semantic styling that
 * reads as Lucidchart-quality without per-node tuning by the LLM.
 *
 * Theme: useThemeTokens drives node chrome + edge color. Each stencil
 * carries its own vendorColor (#FF9900 for AWS, etc) that paints the
 * icon and the top accent rail of the node; the rest of the chrome
 * uses tokens so light/dark + user accent still flow through.
 */
import React, { useMemo, useRef, useState } from 'react'
import dagre from 'dagre'
import { useThemeTokens } from '../hooks/useThemeTokens'
import { useChartFrame } from '../hooks/useChartFrame'
import type { ChartProps } from '../types'
import { getStencil } from '../icons/registry'
import { ChartExpandModal } from '../ChartExpandModal'

export type ArchEdgeKind = 'flow' | 'data' | 'auth' | 'control' | 'event'

export interface ArchNode {
  id: string
  /** Stencil slug, e.g. `aws_s3` / `k8s_pod` / `ml_llm`. Falls back to generic 'service'. */
  type?: string
  label: string
  sublabel?: string
  /** Group id this node belongs to. Renders as a nested container around the node. */
  group?: string
}

export interface ArchEdge {
  from: string
  to: string
  kind?: ArchEdgeKind
  label?: string
  /** Optional explicit color override (rare — semantic `kind` is preferred). */
  color?: string
}

/** Visual kind for a container — drives color + dash style + label chip. */
export type ArchGroupKind =
  | 'org'
  | 'folder'
  | 'account'
  | 'project'
  | 'region'
  | 'az'
  | 'vpc'
  | 'subnet'
  | 'cluster'
  | 'namespace'
  | 'tier'
  | 'zone'
  | 'env'
  | 'generic'

export interface ArchGroup {
  /** Unique group id. */
  id: string
  /** Display label rendered in the container's top-left tag. */
  label: string
  /** Visual kind — drives color + dash style. Default 'generic'. */
  kind?: ArchGroupKind
  /** Optional parent group id for nested containers (e.g. subnet inside vpc inside region). */
  parent?: string
}

export interface ArchDiagramData {
  nodes: ArchNode[]
  edges: ArchEdge[]
  /** Optional container/cluster declarations. When present, dagre compound
   *  layout nests children inside their parent group's bbox and ArchDiagram
   *  draws a labeled container chrome around each. */
  groups?: ArchGroup[]
  /** Layout direction. 'LR' (default) = left to right; 'TB' = top to bottom. */
  direction?: 'LR' | 'TB' | 'RL' | 'BT'
}

const NODE_W = 168
const NODE_H = 78

interface LaidOutNode extends ArchNode {
  x: number
  y: number
}
interface LaidOutEdge extends ArchEdge {
  points: Array<{ x: number; y: number }>
}
interface LaidOutGroup extends ArchGroup {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

function buildLayout(data: ArchDiagramData) {
  const g = new dagre.graphlib.Graph({ compound: true })
  const direction = data.direction ?? 'LR'
  g.setGraph({
    rankdir: direction,
    nodesep: direction === 'LR' || direction === 'RL' ? 28 : 40,
    ranksep: direction === 'LR' || direction === 'RL' ? 72 : 60,
    marginx: 24,
    marginy: 24,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const groups = data.groups ?? []
  const groupSet = new Set(groups.map((g) => g.id))
  // Register group nodes first so children can setParent into them.
  for (const grp of groups) {
    // Empty label here — dagre uses this for layout sizing; we draw our
    // own labeled container chrome on render.
    g.setNode(grp.id, {})
    if (grp.parent && groupSet.has(grp.parent)) {
      g.setParent(grp.id, grp.parent)
    }
  }

  for (const n of data.nodes) {
    g.setNode(n.id, { label: n.label, width: NODE_W, height: NODE_H })
    if (n.group && groupSet.has(n.group)) {
      g.setParent(n.id, n.group)
    }
  }
  for (const e of data.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue
    g.setEdge(e.from, e.to, { weight: 1, kind: e.kind ?? 'flow' })
  }

  dagre.layout(g)

  // depth = how nested a group is (root = 0). drives stroke + fill alpha
  const depthOf = (id: string): number => {
    let d = 0
    let cur: string | undefined = groups.find((x) => x.id === id)?.parent
    while (cur) {
      d++
      cur = groups.find((x) => x.id === cur)?.parent
    }
    return d
  }
  const laidOutGroups: LaidOutGroup[] = groups.map((grp) => {
    const meta: any = g.node(grp.id)
    return {
      ...grp,
      x: meta?.x ?? 0,
      y: meta?.y ?? 0,
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      depth: depthOf(grp.id),
    }
  })

  const nodes: LaidOutNode[] = data.nodes.map((n) => {
    const meta = g.node(n.id)
    return { ...n, x: meta?.x ?? 0, y: meta?.y ?? 0 }
  })
  const edges: LaidOutEdge[] = data.edges.map((e) => {
    const meta = g.edge(e.from, e.to)
    return { ...e, points: (meta?.points ?? []) as Array<{ x: number; y: number }> }
  })
  const graphMeta = g.graph()
  const width = Math.max((graphMeta.width ?? 0) + 48, 480)
  const height = Math.max((graphMeta.height ?? 0) + 48, 240)
  return { nodes, edges, groups: laidOutGroups, width, height }
}

function edgePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  const parts: string[] = [`M${first.x},${first.y}`]
  for (let i = 0; i < rest.length; i++) {
    const cur = rest[i]
    parts.push(`L${cur.x},${cur.y}`)
  }
  return parts.join(' ')
}

function edgeStyleFor(kind: ArchEdgeKind | undefined, tokens: ReturnType<typeof useThemeTokens>): { stroke: string; dash?: string } {
  switch (kind) {
    case 'data':    return { stroke: tokens.info,  dash: '5 3' }
    case 'auth':    return { stroke: tokens.warn,  dash: '2 3' }
    case 'control': return { stroke: tokens.fg2 }
    case 'event':   return { stroke: tokens.ok,    dash: '8 3' }
    case 'flow':
    default:        return { stroke: tokens.accent }
  }
}

/** Visual chrome per group kind: stroke, fill (with theme alpha), and dash style. */
function groupChromeFor(kind: ArchGroupKind | undefined, tokens: ReturnType<typeof useThemeTokens>): {
  stroke: string
  fill: string
  dash?: string
  chip: string
} {
  switch (kind) {
    case 'org':       return { stroke: tokens.accent, fill: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', chip: tokens.accent }
    case 'folder':    return { stroke: tokens.fg2,    fill: 'color-mix(in srgb, var(--color-accent) 4%, transparent)', dash: '6 4', chip: tokens.fg2 }
    case 'account':   return { stroke: tokens.info,   fill: 'color-mix(in srgb, var(--color-nfo) 5%, transparent)', chip: tokens.info }
    case 'project':   return { stroke: tokens.ok,     fill: 'color-mix(in srgb, var(--color-ok) 5%, transparent)', chip: tokens.ok }
    case 'region':    return { stroke: tokens.fg3,    fill: 'color-mix(in srgb, var(--color-fg-subtle) 3%, transparent)', dash: '4 4', chip: tokens.fg2 }
    case 'az':        return { stroke: tokens.fg3,    fill: 'color-mix(in srgb, var(--color-fg-subtle) 5%, transparent)', dash: '2 4', chip: tokens.fg3 }
    case 'vpc':       return { stroke: tokens.info,   fill: 'color-mix(in srgb, var(--color-nfo) 6%, transparent)', chip: tokens.info }
    case 'subnet':    return { stroke: tokens.info,   fill: 'color-mix(in srgb, var(--color-nfo) 4%, transparent)', dash: '4 3', chip: tokens.info }
    case 'cluster':   return { stroke: tokens.accent, fill: 'color-mix(in srgb, var(--color-accent) 5%, transparent)', chip: tokens.accent }
    case 'namespace': return { stroke: tokens.accent, fill: 'color-mix(in srgb, var(--color-accent) 3%, transparent)', dash: '3 3', chip: tokens.accent }
    case 'tier':      return { stroke: tokens.warn,   fill: 'color-mix(in srgb, var(--color-warn) 4%, transparent)', chip: tokens.warn }
    case 'zone':      return { stroke: tokens.fg2,    fill: 'color-mix(in srgb, var(--color-fg-muted) 4%, transparent)', dash: '6 3', chip: tokens.fg2 }
    case 'env':       return { stroke: tokens.fg2,    fill: 'color-mix(in srgb, var(--color-accent) 3%, transparent)', chip: tokens.fg2 }
    case 'generic':
    default:          return { stroke: tokens.line2,  fill: 'color-mix(in srgb, var(--color-fg-muted) 3%, transparent)', chip: tokens.fg3 }
  }
}

interface ArchDiagramBodyProps extends ChartProps<ArchDiagramData> {
  /** Internal: when rendered inside the expand modal we suppress the
   *  modal button and let wheel-zoom fire without the Ctrl modifier so
   *  the diagram feels like a real map view. */
  isExpanded?: boolean
  /** Internal: when in expand-modal mode, the parent owns expand state. */
  onExpandClick?: () => void
}

function ArchDiagramBody({
  data,
  title,
  caption,
  height,
  disableFrame,
  wheelZoom,
  onExpand,
  className,
  isExpanded,
  onExpandClick,
}: ArchDiagramBodyProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const contentRef = useRef<SVGGElement>(null)
  const tokens = useThemeTokens(svgRef)
  const layout = useMemo(() => buildLayout(data), [data])
  const renderH = height ?? Math.max(layout.height, 320)

  // In modal mode wheel zooms without Ctrl (chart owns the wheel); inline
  // mode keeps Ctrl/Cmd gating so the parent page can scroll past the chart.
  const effectiveWheelZoom = isExpanded ? 'always' : (wheelZoom ?? 'modifier')

  useChartFrame(svgRef, contentRef, {
    title: title ?? 'arch-diagram',
    disabled: disableFrame,
    wheelZoom: effectiveWheelZoom,
    onExpand,
    // Smaller step per wheel/button tick — d3-zoom uses k = 2^(-deltaY * 0.002).
    // With our buttons firing deltaY=50 → ~3.5% per click; raw browser wheel
    // ticks (~100 deltaY) → ~7%. Big jumps used to be deltaY=200 → 13%.
    scaleMin: 0.5,
    scaleMax: 6,
  })

  const arrowId = React.useId().replace(/:/g, '_')

  // Synthetic wheel-with-ctrl: re-uses d3-zoom's pipeline so button-zoom
  // and wheel-zoom share state. Smaller deltaY → smoother step.
  const fireZoom = (deltaY: number) => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const rect = svgEl.getBoundingClientRect()
    const ev = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    })
    svgEl.dispatchEvent(ev)
  }
  const fireReset = () => {
    const svgEl = svgRef.current
    if (!svgEl) return
    if (!onExpand) {
      svgEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    }
  }

  const btn: React.CSSProperties = {
    background: tokens.bg1,
    color: tokens.fg2,
    border: `1px solid ${tokens.line2}`,
    borderRadius: 4,
    fontSize: 12,
    fontFamily: tokens.fontMono,
    width: 26,
    height: 24,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%' }} data-aw-chart-frame>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.fg1, padding: '8px 14px 0', fontFamily: tokens.fontUi }}>{title}</div>
      )}
      {!disableFrame && (
        <div
          aria-label="Diagram controls"
          style={{
            position: 'absolute',
            top: title ? 36 : 8,
            right: 10,
            display: 'flex',
            gap: 4,
            zIndex: 2,
          }}
        >
          <button type="button" style={btn} title={isExpanded ? 'Zoom in (wheel works too)' : 'Zoom in (Ctrl/Cmd + scroll)'} onClick={() => fireZoom(-50)}>+</button>
          <button type="button" style={btn} title="Zoom out" onClick={() => fireZoom(50)}>−</button>
          <button type="button" style={btn} title="Reset zoom" onClick={fireReset}>⊙</button>
          {!isExpanded && onExpandClick && (
            <button type="button" style={btn} title="Open in fullscreen" onClick={onExpandClick}>↗</button>
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ display: 'block', width: '100%', height: renderH, cursor: disableFrame ? 'default' : 'grab' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {(['flow', 'data', 'auth', 'event', 'control'] as ArchEdgeKind[]).map((k) => {
            const c =
              k === 'data' ? tokens.info :
              k === 'auth' ? tokens.warn :
              k === 'event' ? tokens.ok :
              k === 'control' ? tokens.fg2 :
              tokens.accent
            return (
              <marker key={k} id={`arr_${k}_${arrowId}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 0,10 z" fill={c} />
              </marker>
            )
          })}
        </defs>

        <g ref={contentRef}>
          {/* Groups: rendered below edges + nodes; deeper groups paint on top
              so nested containers stay visible. */}
          {[...(layout.groups ?? [])].sort((a, b) => a.depth - b.depth).map((grp) => {
            const chrome = groupChromeFor(grp.kind, tokens)
            const padX = 14
            const padY = 14
            const labelY = grp.y - grp.height / 2 + 14
            return (
              <g key={`grp-${grp.id}`} className="aw-arch-group" data-group-kind={grp.kind ?? 'generic'}>
                <rect
                  x={grp.x - grp.width / 2 - padX}
                  y={grp.y - grp.height / 2 - padY}
                  width={grp.width + padX * 2}
                  height={grp.height + padY * 2}
                  rx={10}
                  fill={chrome.fill}
                  stroke={chrome.stroke}
                  strokeWidth={1.25}
                  strokeDasharray={chrome.dash}
                />
                {/* Top-left label chip */}
                <g transform={`translate(${grp.x - grp.width / 2 - padX + 10}, ${labelY - padY})`}>
                  <rect x={0} y={-6} width={grp.label.length * 7 + (grp.kind ? grp.kind.length * 6 + 12 : 8)} height={18} rx={4} fill={tokens.bg1} stroke={chrome.stroke} strokeWidth={1} />
                  {grp.kind && (
                    <text x={6} y={7} fontSize={9} fontFamily={tokens.fontMono} fill={chrome.chip} letterSpacing={0.5}>
                      {grp.kind.toUpperCase()}
                    </text>
                  )}
                  <text x={grp.kind ? grp.kind.length * 6 + 12 : 6} y={7} fontSize={11} fontFamily={tokens.fontUi} fontWeight={600} fill={tokens.fg1}>
                    {grp.label}
                  </text>
                </g>
              </g>
            )
          })}
          {/* Edges below nodes */}
          {layout.edges.map((e, i) => {
            const style = edgeStyleFor(e.kind, tokens)
            const stroke = e.color ?? style.stroke
            const arrow = `arr_${e.kind ?? 'flow'}_${arrowId}`
            return (
              <g key={`e-${i}`} className="aw-arch-edge">
                <path
                  d={edgePath(e.points)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeDasharray={style.dash}
                  markerEnd={`url(#${arrow})`}
                />
                {e.label && e.points.length >= 2 && (() => {
                  const mid = e.points[Math.floor(e.points.length / 2)]
                  return (
                    <g transform={`translate(${mid.x}, ${mid.y})`}>
                      <rect x={-e.label.length * 3.5 - 5} y={-9} width={e.label.length * 7 + 10} height={16} rx={3} fill={tokens.bg1} stroke={tokens.line2} />
                      <text textAnchor="middle" y={3} fontSize={10} fill={tokens.fg2} fontFamily={tokens.fontUi}>{e.label}</text>
                    </g>
                  )
                })()}
              </g>
            )
          })}

          {/* Nodes */}
          {layout.nodes.map((n) => {
            const stencil = getStencil(n.type)
            const accent = stencil.vendorColor || tokens.accent
            return (
              <g key={n.id} transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`} className="aw-arch-node">
                <rect width={NODE_W} height={NODE_H} rx={8} fill={tokens.bg1} stroke={tokens.line2} strokeWidth={1} />
                <rect width={NODE_W} height={3} rx={2} fill={accent} />
                <g transform="translate(12, 22)" style={{ color: accent }}>
                  {stencil.render({ size: 36, title: stencil.defaultLabel })}
                </g>
                <text x={56} y={36} fontSize={13} fontWeight={600} fill={tokens.fg1} fontFamily={tokens.fontUi}>
                  {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
                </text>
                {n.sublabel && (
                  <text x={56} y={54} fontSize={11} fill={tokens.fg3} fontFamily={tokens.fontUi}>
                    {n.sublabel.length > 22 ? `${n.sublabel.slice(0, 21)}…` : n.sublabel}
                  </text>
                )}
                {n.group && (
                  <text x={NODE_W - 8} y={72} textAnchor="end" fontSize={9} fill={tokens.fg3} fontFamily={tokens.fontMono} letterSpacing={0.3}>
                    {n.group.toUpperCase()}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {caption && (
        <figcaption
          className="aw-chart-caption"
          style={{ marginTop: 6, padding: '6px 14px', fontSize: 12, color: tokens.fg2, fontFamily: tokens.fontUi, lineHeight: 1.5 }}
        >
          {caption}
        </figcaption>
      )}
    </div>
  )
}

/**
 * Public ArchDiagram — wraps the body in expand-modal state. The inline
 * chart shows the diagram at panel-size with Ctrl+wheel zoom; the ↗ button
 * opens a fullscreen modal where wheel-zoom works without modifier, the
 * chart sizes to ~85vh, and the user can pan/drag freely. Modal closes
 * with Esc or the X.
 */
export function ArchDiagram(props: ChartProps<ArchDiagramData>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ArchDiagramBody {...props} isExpanded={false} onExpandClick={props.disableFrame ? undefined : () => setOpen(true)} />
      <ChartExpandModal
        title={props.title ?? 'Architecture'}
        open={open}
        onClose={() => setOpen(false)}
      >
        <ArchDiagramBody
          {...props}
          isExpanded
          height={Math.floor(window.innerHeight * 0.78)}
        />
      </ChartExpandModal>
    </>
  )
}
