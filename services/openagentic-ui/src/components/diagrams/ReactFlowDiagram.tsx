/**
 * ReactFlowDiagram — back-compat adapter (cutover 2026-05-14).
 *
 * Originally a full @xyflow/react + elkjs implementation. Now a thin
 * shim that translates the `DiagramDefinition` shape used across the
 * 23 docs-site pages into the spec consumed by
 * `src/lib/charts/components/ArchDiagram.tsx`. Public API + types are
 * preserved so every existing import keeps working without touching the
 * doc pages.
 *
 * Why the rewrite: ReactFlow output looked "like shit" per user 2026-05-14
 * and we want one architecture-diagram primitive across chatmode
 * (compose_visual `arch_diagram`), admin, and docs. The new ArchDiagram
 * uses dagre auto-layout + vendor stencil icons (AWS / Azure / GCP / k8s /
 * ML) + theme tokens — same primitive everywhere.
 */
import * as React from 'react'
import { ArchDiagram, type ArchDiagramData, type ArchEdgeKind } from '../../lib/charts/components/ArchDiagram'
import { isKnownStencil } from '../../lib/charts/icons/registry'

// =============================================================================
// TYPES — preserved verbatim so consumers don't break.
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
  | 'process'

export type NodeShape =
  | 'rectangle'
  | 'rounded'
  | 'diamond'
  | 'circle'
  | 'hexagon'
  | 'database'
  | 'cloud'
  | 'server'
  | 'container'

export type EdgeStyle = 'solid' | 'dashed' | 'dotted' | 'animated'

export interface DiagramNode {
  id: string
  label: string
  description?: string
  shape?: NodeShape
  color?: string
  icon?: string
  group?: string
  metadata?: Record<string, unknown>
}

export interface DiagramEdge {
  id?: string
  source: string
  target: string
  label?: string
  style?: EdgeStyle
  color?: string
  animated?: boolean
}

export interface DiagramDefinition {
  type: DiagramType
  title?: string
  description?: string
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  layout?: 'horizontal' | 'vertical' | 'radial' | 'force'
  theme?: 'light' | 'dark'
}

interface ReactFlowDiagramProps {
  diagram: DiagramDefinition
  className?: string
  height?: number | string
  interactive?: boolean
  showMiniMap?: boolean
  showControls?: boolean
}

// =============================================================================
// SHAPE / ICON → STENCIL TYPE
// =============================================================================

/** Map legacy `icon` / `shape` hints to ArchDiagram stencil slugs. */
function inferStencilType(node: DiagramNode): string | undefined {
  // 1) explicit icon hint wins, if the registry knows it
  if (node.icon) {
    const slug = node.icon.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    if (isKnownStencil(slug)) return slug
  }
  // 2) try label-derived match (e.g. label "Amazon S3" → aws_s3)
  if (node.label) {
    const l = node.label.toLowerCase()
    if (/\bs3\b/.test(l)) return 'aws_s3'
    if (/\bec2\b/.test(l)) return 'aws_ec2'
    if (/\blambda\b/.test(l)) return 'aws_lambda'
    if (/\beks\b/.test(l)) return 'aws_eks'
    if (/\becs\b/.test(l)) return 'aws_ecs'
    if (/\brds\b/.test(l)) return 'aws_rds'
    if (/\bdynamodb\b/.test(l)) return 'aws_dynamodb'
    if (/\bcloudfront\b/.test(l)) return 'aws_cloudfront'
    if (/\bcognito\b/.test(l)) return 'aws_cognito'
    if (/api\s*gateway/.test(l)) return 'aws_apigateway'
    if (/\biam\b/.test(l)) return 'aws_iam'
    if (/\bvpc\b/.test(l)) return 'aws_vpc'
    if (/cloudwatch/.test(l)) return 'aws_cloudwatch'
    if (/\bsqs\b/.test(l)) return 'aws_sqs'
    if (/\bsns\b/.test(l)) return 'aws_sns'
    if (/\balb\b|\belb\b|load\s*balancer/.test(l)) return 'aws_elb'
    if (/\baks\b/.test(l)) return 'azure_aks'
    if (/azure\s*sql|sql\s*db/.test(l)) return 'azure_sql'
    if (/cosmos/.test(l)) return 'azure_cosmos'
    if (/blob/.test(l)) return 'azure_blob'
    if (/key\s*vault/.test(l)) return 'azure_keyvault'
    if (/entra|aad|azure\s*ad/.test(l)) return 'azure_entra'
    if (/\bgke\b/.test(l)) return 'gcp_gke'
    if (/cloud\s*storage|gcs\b/.test(l)) return 'gcp_gcs'
    if (/firestore/.test(l)) return 'gcp_firestore'
    if (/pubsub|pub\/sub/.test(l)) return 'gcp_pubsub'
    if (/bigquery/.test(l)) return 'gcp_bigquery'
    if (/\bpod\b/.test(l)) return 'k8s_pod'
    if (/deployment/.test(l)) return 'k8s_deployment'
    if (/ingress/.test(l)) return 'k8s_ingress'
    if (/configmap/.test(l)) return 'k8s_configmap'
    if (/secret/.test(l)) return 'k8s_secret'
    if (/\bllm\b|claude|gpt|sonnet|haiku/.test(l)) return 'ml_llm'
    if (/embedding/.test(l)) return 'ml_embedding'
    if (/vector\s*(db|store)|qdrant|milvus|pinecone/.test(l)) return 'ml_vectordb'
    if (/\bagent\b/.test(l)) return 'ml_agent'
    if (/\brag\b/.test(l)) return 'ml_rag'
    if (/\buser\b|customer|client/.test(l)) return 'user'
    if (/browser/.test(l)) return 'browser'
    if (/mobile/.test(l)) return 'mobile'
    if (/api\b/.test(l)) return 'api'
    if (/database|\bdb\b|postgres|mysql/.test(l)) return 'database'
    if (/queue|kafka|rabbitmq/.test(l)) return 'queue'
    if (/cache|redis/.test(l)) return 'cache'
    if (/firewall/.test(l)) return 'firewall'
    if (/internet/.test(l)) return 'internet'
    if (/\bcdn\b/.test(l)) return 'cdn'
    if (/monitoring/.test(l)) return 'monitoring'
  }
  // 3) shape hint as a last resort (cloud → internet, container → service, ...)
  if (node.shape === 'cloud') return 'internet'
  if (node.shape === 'database') return 'database'
  if (node.shape === 'container' || node.shape === 'server') return 'service'
  return undefined
}

/** Map legacy edge styles to ArchDiagram semantic edge kinds. */
function mapEdgeKind(e: DiagramEdge): ArchEdgeKind {
  if (e.style === 'dashed') return 'data'
  if (e.style === 'dotted') return 'auth'
  if (e.animated || e.style === 'animated') return 'event'
  return 'flow'
}

/** Map legacy layout to ArchDiagram direction. */
function mapDirection(layout?: 'horizontal' | 'vertical' | 'radial' | 'force'): 'LR' | 'TB' | undefined {
  if (layout === 'vertical') return 'TB'
  if (layout === 'horizontal') return 'LR'
  // 'radial' + 'force' have no native equivalent; let dagre default to LR.
  return undefined
}

// =============================================================================
// COMPONENT
// =============================================================================

export const ReactFlowDiagram: React.FC<ReactFlowDiagramProps> = ({
  diagram,
  className,
  height = 400,
}) => {
  const data: ArchDiagramData = React.useMemo(
    () => ({
      nodes: diagram.nodes.map((n) => ({
        id: n.id,
        type: inferStencilType(n),
        label: n.label,
        sublabel: n.description,
        group: n.group,
      })),
      edges: diagram.edges.map((e) => ({
        from: e.source,
        to: e.target,
        kind: mapEdgeKind(e),
        label: e.label,
        color: e.color,
      })),
      direction: mapDirection(diagram.layout),
    }),
    [diagram],
  )

  const numericHeight = typeof height === 'number' ? height : undefined

  return (
    <div className={className} style={{ width: '100%' }}>
      <ArchDiagram data={data} title={diagram.title} height={numericHeight} />
      {diagram.description && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 14px',
            fontSize: 12,
            color: 'var(--cm-fg-2, var(--fg-2, #9ca3af))',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
            lineHeight: 1.5,
          }}
        >
          {diagram.description}
        </div>
      )}
    </div>
  )
}

/**
 * Parse diagram JSON from LLM / MCP tool output into a `DiagramDefinition`.
 * Mirrors `parseChartJson` / `parseVennJson` — returns `null` on malformed
 * input or a missing `nodes` array rather than throwing.
 */
export const parseDiagramJson = (json: string): DiagramDefinition | null => {
  try {
    const parsed = JSON.parse(json)

    if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
      return null
    }

    return {
      type: parsed.type || 'flowchart',
      title: parsed.title,
      description: parsed.description,
      nodes: parsed.nodes,
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      layout: parsed.layout,
      theme: parsed.theme,
    }
  } catch {
    return null
  }
}

export default ReactFlowDiagram
