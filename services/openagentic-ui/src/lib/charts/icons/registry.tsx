/**
 * ArchDiagram stencil registry.
 *
 * Curated inline SVG components covering the resources LLMs reach for
 * 95% of the time when sketching cloud / k8s / ML architecture
 * diagrams. Each stencil is a React component that renders at
 * size 32×32 by default (tweak via the `size` prop), uses
 * `currentColor` for everything theme-driven, and exposes a vendor
 * accent (`vendorColor`) the diagram lays into the node chrome so
 * AWS nodes read orange, Azure blue, GCP red, k8s blue-violet, etc.
 *
 * The registry is keyed by **resource type slug** — the model emits
 * `{ id, type: 'aws_s3', label }` and ArchDiagram dispatches here.
 * Unknown types fall back to a generic "service" stencil so the
 * diagram never breaks, just looks slightly less specific.
 *
 * Add a new stencil: register a function, give it a vendor color, add
 * the slug to one of the category lists at the bottom for docs/tests.
 */
import * as React from 'react'

export interface StencilProps {
  size?: number
  className?: string
  title?: string
}

interface StencilDef {
  /** vendor brand accent used in node chrome; '' = inherit accent token. */
  vendorColor: string
  /** human-friendly label fallback when the model doesn't provide one. */
  defaultLabel: string
  /** SVG render function — must use viewBox 0 0 32 32, currentColor for fill/stroke. */
  render: (props: StencilProps) => React.ReactElement
}

const svgWrap = (
  child: React.ReactNode,
  props: StencilProps,
  vb = '0 0 32 32',
): React.ReactElement => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={vb}
    width={props.size ?? 32}
    height={props.size ?? 32}
    className={props.className}
    role="img"
    aria-label={props.title}
    style={{ display: 'block' }}
  >
    {props.title && <title>{props.title}</title>}
    {child}
  </svg>
)

// ---------------------------------------------------------------------------
// AWS — 16 stencils — vendor color #FF9900
// Iconography refs official AWS Architecture Icons; simplified to monoline
// silhouettes so theme tokens drive color.
// ---------------------------------------------------------------------------
const AWS = '#FF9900'

const ec2: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'EC2',
  render: (p) => svgWrap(
    <g fill="currentColor">
      <path d="M5 5h22v22H5z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 9h14v3H9zM9 14h14v3H9zM9 19h10v3H9z" />
    </g>, p),
}
const s3: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'S3',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="8" rx="11" ry="3" />
      <path d="M5 8v16c0 1.7 4.9 3 11 3s11-1.3 11-3V8" />
      <path d="M5 16c0 1.7 4.9 3 11 3s11-1.3 11-3" />
    </g>, p),
}
const lambda: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'Lambda',
  render: (p) => svgWrap(
    <path d="M7 4h6l9 24h-6l-3-8-6 8H1zM14 4h6l9 24h-6L14 12z" fill="currentColor" />, p),
}
const rds: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'RDS',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="6" rx="10" ry="3" />
      <path d="M6 6v20c0 1.7 4.5 3 10 3s10-1.3 10-3V6" />
      <path d="M6 13c0 1.7 4.5 3 10 3s10-1.3 10-3M6 20c0 1.7 4.5 3 10 3s10-1.3 10-3" />
    </g>, p),
}
const dynamodb: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'DynamoDB',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 8l12-4 12 4-12 4z" />
      <path d="M4 8v8l12 4 12-4V8M4 16v8l12 4 12-4v-8" />
    </g>, p),
}
const sqs: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'SQS',
  render: (p) => svgWrap(
    <g fill="currentColor">
      <rect x="3" y="11" width="6" height="10" rx="1" />
      <rect x="11" y="11" width="6" height="10" rx="1" />
      <rect x="19" y="11" width="6" height="10" rx="1" />
      <path d="M9 16h2M17 16h2" stroke="currentColor" strokeWidth="2" fill="none" />
    </g>, p),
}
const sns: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'SNS',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="16" r="4" />
      <path d="M12 16l12-8v16z" fill="currentColor" />
    </g>, p),
}
const elb: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'ELB',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="6" r="3" />
      <circle cx="6" cy="24" r="3" />
      <circle cx="16" cy="24" r="3" />
      <circle cx="26" cy="24" r="3" />
      <path d="M16 9v8M16 17l-10 4M16 17l10 4M16 17v4" />
    </g>, p),
}
const cloudfront: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'CloudFront',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="12" />
      <path d="M4 16h24M16 4c4 3 4 21 0 24M16 4c-4 3-4 21 0 24" />
    </g>, p),
}
const apigateway: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'API Gateway',
  render: (p) => svgWrap(
    <g fill="currentColor">
      <path d="M4 14h6v4H4zM12 10h6v12h-6zM20 12h8v8h-8z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10 16h2M18 16h2" stroke="currentColor" strokeWidth="2" />
    </g>, p),
}
const cognito: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'Cognito',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="11" r="5" />
      <path d="M6 28c0-6 4-10 10-10s10 4 10 10" />
    </g>, p),
}
const ecs: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'ECS',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="11" height="11" />
      <rect x="17" y="4" width="11" height="11" />
      <rect x="4" y="17" width="11" height="11" />
      <rect x="17" y="17" width="11" height="11" />
    </g>, p),
}
const eks: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'EKS',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 28,10 28,22 16,29 4,22 4,10" />
      <polygon points="16,9 22,12.5 22,19.5 16,23 10,19.5 10,12.5" fill="currentColor" fillOpacity="0.2" />
    </g>, p),
}
const iam: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'IAM',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 3l11 4v8c0 7-5 13-11 14C10 28 5 22 5 15V7z" />
      <path d="M12 16l3 3 6-6" />
    </g>, p),
}
const vpc: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'VPC',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="26" height="26" rx="2" strokeDasharray="3 2" />
      <rect x="8" y="8" width="7" height="7" />
      <rect x="17" y="8" width="7" height="7" />
      <rect x="8" y="17" width="7" height="7" />
      <rect x="17" y="17" width="7" height="7" />
    </g>, p),
}
const cloudwatch: StencilDef = {
  vendorColor: AWS,
  defaultLabel: 'CloudWatch',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="12" />
      <path d="M16 8v8l5 3" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// Azure — 12 stencils — vendor color #0078D4
// ---------------------------------------------------------------------------
const AZ = '#0078D4'

const azVm: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'VM',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="26" height="16" rx="1" />
      <path d="M3 11h26M10 26h12M16 22v4" />
    </g>, p),
}
const azBlob: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Blob Storage',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4c-6 0-9 3-9 7 0 1.5.5 3 1.5 4-1 1-1.5 2.5-1.5 4 0 4 3 7 9 7s9-3 9-7c0-1.5-.5-3-1.5-4 1-1 1.5-2.5 1.5-4 0-4-3-7-9-7z" />
    </g>, p),
}
const azFunc: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Function',
  render: (p) => svgWrap(
    <path d="M9 4l-5 12h6L7 28l11-14h-6l3-10z" fill="currentColor" />, p),
}
const azSql: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'SQL DB',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="6" rx="11" ry="3" />
      <path d="M5 6v20c0 1.7 4.9 3 11 3s11-1.3 11-3V6M5 16c0 1.7 4.9 3 11 3s11-1.3 11-3" />
    </g>, p),
}
const azCosmos: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Cosmos DB',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="12" />
      <ellipse cx="16" cy="16" rx="12" ry="4" />
      <ellipse cx="16" cy="16" rx="4" ry="12" />
    </g>, p),
}
const azServiceBus: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Service Bus',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 16h6M22 16h6" />
      <rect x="10" y="11" width="12" height="10" rx="1" />
      <path d="M10 14h12M10 18h12" />
    </g>, p),
}
const azAppGw: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'App Gateway',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4v24h24V4zM4 16h24M16 4v24" />
    </g>, p),
}
const aks: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'AKS',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 28,10 28,22 16,29 4,22 4,10" />
      <path d="M16 11v10M11 14l10 4M21 14l-10 4" />
    </g>, p),
}
const entraId: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Entra ID',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 28,28 4,28" />
      <path d="M16 13v8M12 21h8" />
    </g>, p),
}
const azMonitor: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Monitor',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 22l6-8 5 4 6-10 7 12" />
      <circle cx="10" cy="14" r="1.5" fill="currentColor" />
      <circle cx="15" cy="18" r="1.5" fill="currentColor" />
      <circle cx="21" cy="8" r="1.5" fill="currentColor" />
    </g>, p),
}
const azKeyVault: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Key Vault',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="6" y="14" width="20" height="14" rx="1" />
      <path d="M10 14V9a6 6 0 0 1 12 0v5M14 21h4" />
    </g>, p),
}
const azLogicApps: StencilDef = {
  vendorColor: AZ,
  defaultLabel: 'Logic Apps',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="3" />
      <circle cx="24" cy="8" r="3" />
      <circle cx="8" cy="24" r="3" />
      <circle cx="24" cy="24" r="3" />
      <path d="M11 8h10M11 24h10M8 11v10M24 11v10" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// GCP — 10 stencils — vendor color #4285F4
// ---------------------------------------------------------------------------
const GCP = '#4285F4'

const gce: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Compute Engine',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="24" height="24" rx="2" />
      <rect x="9" y="9" width="14" height="14" />
      <path d="M16 4v5M16 23v5M4 16h5M23 16h5" />
    </g>, p),
}
const gcs: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Cloud Storage',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="8" width="24" height="6" rx="1" />
      <rect x="4" y="18" width="24" height="6" rx="1" />
      <circle cx="9" cy="11" r="1" fill="currentColor" />
      <circle cx="9" cy="21" r="1" fill="currentColor" />
    </g>, p),
}
const gcf: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Cloud Function',
  render: (p) => svgWrap(
    <path d="M9 4h14v4H9zM4 11h24v4H4zM9 18h14v4H9zM12 25h8v3h-8z" fill="currentColor" />, p),
}
const cloudSql: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Cloud SQL',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="7" rx="11" ry="3" />
      <path d="M5 7v18c0 1.7 4.9 3 11 3s11-1.3 11-3V7" />
      <path d="M5 16c0 1.7 4.9 3 11 3s11-1.3 11-3" />
    </g>, p),
}
const firestore: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Firestore',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 3l11 8-11 8L5 11z" />
      <path d="M5 16l11 8 11-8M5 21l11 8 11-8" />
    </g>, p),
}
const pubsub: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Pub/Sub',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="4" />
      <path d="M16 4v6M16 22v6M4 16h6M22 16h6M7 7l4 4M21 21l4 4M25 7l-4 4M11 21l-4 4" />
    </g>, p),
}
const gke: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'GKE',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 28,10 28,22 16,29 4,22 4,10" />
      <circle cx="16" cy="16" r="4" />
    </g>, p),
}
const gcpIam: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'IAM',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 3l11 4v8c0 7-5 13-11 14C10 28 5 22 5 15V7z" />
      <path d="M12 16l3 3 6-6" />
    </g>, p),
}
const gcpLogging: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'Logging',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="5" width="24" height="22" rx="1" />
      <path d="M8 11h16M8 16h16M8 21h12" />
    </g>, p),
}
const bigquery: StencilDef = {
  vendorColor: GCP,
  defaultLabel: 'BigQuery',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="14" cy="14" r="9" />
      <path d="M21 21l6 6" />
      <path d="M14 9v5l3 2" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// Kubernetes — 8 stencils — vendor color #326CE5
// ---------------------------------------------------------------------------
const K8S = '#326CE5'

const pod: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Pod',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </g>, p),
}
const deployment: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Deployment',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <path d="M11 12l5-3 5 3v6l-5 3-5-3zM16 9v12" />
    </g>, p),
}
const k8sService: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Service',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <path d="M10 16h12M16 10v12M11 11l10 10M21 11L11 21" />
    </g>, p),
}
const ingress: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Ingress',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <path d="M9 16h14M19 12l4 4-4 4" />
    </g>, p),
}
const configMap: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'ConfigMap',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <path d="M11 12h10M11 16h10M11 20h6" />
    </g>, p),
}
const secret: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Secret',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <rect x="11" y="15" width="10" height="7" rx="1" />
      <path d="M13 15v-3a3 3 0 0 1 6 0v3" />
    </g>, p),
}
const job: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'Job',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <path d="M16 11v5l3 2M16 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
    </g>, p),
}
const statefulset: StencilDef = {
  vendorColor: K8S,
  defaultLabel: 'StatefulSet',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="16,3 27,9 27,23 16,29 5,23 5,9" />
      <ellipse cx="16" cy="13" rx="5" ry="2" />
      <path d="M11 13v6c0 1.1 2.2 2 5 2s5-.9 5-2v-6" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// ML / AI — 8 stencils — vendor color uses theme accent
// ---------------------------------------------------------------------------
const ML = ''

const llm: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'LLM',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4C9 4 4 9 4 16c0 4 2 7 5 9l-1 3 4-1c1 .5 3 1 4 1 7 0 12-5 12-12S23 4 16 4z" />
      <path d="M10 14h12M10 18h8" />
    </g>, p),
}
const embedding: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Embedding',
  render: (p) => svgWrap(
    <g fill="currentColor">
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="24" cy="8" r="2" />
      <circle cx="6" cy="16" r="2" />
      <circle cx="16" cy="16" r="2.5" />
      <circle cx="26" cy="16" r="2" />
      <circle cx="8" cy="24" r="2" />
      <circle cx="16" cy="26" r="2" />
      <circle cx="24" cy="24" r="2" />
    </g>, p),
}
const vectorDb: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Vector DB',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="7" rx="10" ry="3" />
      <path d="M6 7v18c0 1.7 4.5 3 10 3s10-1.3 10-3V7" />
      <path d="M11 14l5 3 5-3M11 19l5 3 5-3" />
    </g>, p),
}
const agent: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Agent',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="10" r="5" />
      <path d="M6 28c0-6 4-10 10-10s10 4 10 10" />
      <path d="M13 9l2 2 4-4" />
    </g>, p),
}
const inference: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Inference',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 16h6l3-8 6 16 3-8h6" />
    </g>, p),
}
const training: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Training',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 24c4-4 6-12 12-12s8 8 12 12" />
      <circle cx="10" cy="20" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
      <circle cx="22" cy="20" r="1.5" fill="currentColor" />
      <path d="M4 28h24" />
    </g>, p),
}
const pipeline: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'Pipeline',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="12" width="6" height="8" rx="1" />
      <rect x="13" y="12" width="6" height="8" rx="1" />
      <rect x="23" y="12" width="6" height="8" rx="1" />
      <path d="M9 16h4M19 16h4" />
    </g>, p),
}
const rag: StencilDef = {
  vendorColor: ML,
  defaultLabel: 'RAG',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="9" cy="16" rx="5" ry="6" />
      <path d="M14 14h6M14 18h6" />
      <circle cx="24" cy="16" r="4" />
      <path d="M22 16h4M24 14v4" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// Generic / system — 12 stencils — vendor color inherits accent
// ---------------------------------------------------------------------------
const G = ''

const userIcon: StencilDef = {
  vendorColor: G,
  defaultLabel: 'User',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="11" r="5" />
      <path d="M6 28c0-6 4-10 10-10s10 4 10 10" />
    </g>, p),
}
const browser: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Browser',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="26" height="20" rx="1" />
      <path d="M3 12h26M7 9h.01M11 9h.01M15 9h.01" />
    </g>, p),
}
const mobile: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Mobile',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="14" height="26" rx="2" />
      <path d="M9 24h14M14 27h4" />
    </g>, p),
}
const api: StencilDef = {
  vendorColor: G,
  defaultLabel: 'API',
  render: (p) => svgWrap(
    <g fill="currentColor">
      <text x="16" y="20" textAnchor="middle" fontFamily="sans-serif" fontSize="11" fontWeight="700" fill="currentColor">API</text>
      <rect x="2" y="6" width="28" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    </g>, p),
}
const database: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Database',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="16" cy="6" rx="11" ry="3" />
      <path d="M5 6v20c0 1.7 4.9 3 11 3s11-1.3 11-3V6M5 16c0 1.7 4.9 3 11 3s11-1.3 11-3" />
    </g>, p),
}
const queue: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Queue',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="12" width="26" height="8" rx="1" />
      <path d="M9 12v8M15 12v8M21 12v8" />
    </g>, p),
}
const cache: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Cache',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4l-3 7 8 1-9 16 3-10-8-1z" fill="currentColor" />
    </g>, p),
}
const service: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Service',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="24" height="24" rx="3" />
      <circle cx="16" cy="16" r="4" />
      <path d="M16 6v3M16 23v3M6 16h3M23 16h3" />
    </g>, p),
}
const internet: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Internet',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="12" />
      <path d="M4 16h24M16 4c4 4 4 20 0 24M16 4c-4 4-4 20 0 24" />
    </g>, p),
}
const cdn: StencilDef = {
  vendorColor: G,
  defaultLabel: 'CDN',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="26" cy="6" r="2" />
      <circle cx="6" cy="26" r="2" />
      <circle cx="26" cy="26" r="2" />
      <path d="M14 14L8 8M18 14l6-6M14 18L8 24M18 18l6 6" />
    </g>, p),
}
const firewall: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Firewall',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="26" height="20" />
      <path d="M3 12h26M3 18h26M3 24h26M10 6v6M16 12v6M22 18v6M22 6v6M10 18v6M16 24v2" />
    </g>, p),
}
const monitoring: StencilDef = {
  vendorColor: G,
  defaultLabel: 'Monitoring',
  render: (p) => svgWrap(
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="26" height="18" rx="1" />
      <path d="M7 18l4-6 5 4 4-8 5 6" />
      <path d="M12 28h8" />
    </g>, p),
}

// ---------------------------------------------------------------------------
// Registry — keyed by lowercase slug. Aliases below.
// ---------------------------------------------------------------------------
const REGISTRY: Record<string, StencilDef> = {
  // AWS
  aws_ec2: ec2, aws_s3: s3, aws_lambda: lambda, aws_rds: rds,
  aws_dynamodb: dynamodb, aws_sqs: sqs, aws_sns: sns, aws_elb: elb,
  aws_cloudfront: cloudfront, aws_apigateway: apigateway, aws_cognito: cognito,
  aws_ecs: ecs, aws_eks: eks, aws_iam: iam, aws_vpc: vpc, aws_cloudwatch: cloudwatch,
  // Azure
  azure_vm: azVm, azure_blob: azBlob, azure_function: azFunc, azure_sql: azSql,
  azure_cosmos: azCosmos, azure_servicebus: azServiceBus, azure_appgw: azAppGw,
  azure_aks: aks, azure_entra: entraId, azure_monitor: azMonitor,
  azure_keyvault: azKeyVault, azure_logicapps: azLogicApps,
  // GCP
  gcp_gce: gce, gcp_gcs: gcs, gcp_function: gcf, gcp_sql: cloudSql,
  gcp_firestore: firestore, gcp_pubsub: pubsub, gcp_gke: gke,
  gcp_iam: gcpIam, gcp_logging: gcpLogging, gcp_bigquery: bigquery,
  // Kubernetes
  k8s_pod: pod, k8s_deployment: deployment, k8s_service: k8sService,
  k8s_ingress: ingress, k8s_configmap: configMap, k8s_secret: secret,
  k8s_job: job, k8s_statefulset: statefulset,
  // ML / AI
  ml_llm: llm, ml_embedding: embedding, ml_vectordb: vectorDb, ml_agent: agent,
  ml_inference: inference, ml_training: training, ml_pipeline: pipeline, ml_rag: rag,
  // Generic
  user: userIcon, browser, mobile, api, database, queue, cache,
  service, internet, cdn, firewall, monitoring,
}

// Aliases — common alternate names the model might emit. Mapped to canonical.
const ALIASES: Record<string, string> = {
  's3': 'aws_s3', 'ec2': 'aws_ec2', 'lambda': 'aws_lambda',
  'eks': 'aws_eks', 'ecs': 'aws_ecs', 'rds': 'aws_rds',
  'dynamodb': 'aws_dynamodb', 'cloudfront': 'aws_cloudfront',
  'api_gateway': 'aws_apigateway', 'apigateway': 'aws_apigateway',
  'cognito': 'aws_cognito', 'iam': 'aws_iam', 'vpc': 'aws_vpc',
  'cloudwatch': 'aws_cloudwatch', 'sqs': 'aws_sqs', 'sns': 'aws_sns',
  'elb': 'aws_elb', 'alb': 'aws_elb',
  'vm': 'azure_vm', 'blob': 'azure_blob', 'cosmos': 'azure_cosmos',
  'aks': 'azure_aks', 'entra': 'azure_entra', 'aad': 'azure_entra',
  'key_vault': 'azure_keyvault', 'keyvault': 'azure_keyvault',
  'gke': 'gcp_gke', 'gcs': 'gcp_gcs', 'gce': 'gcp_gce',
  'firestore': 'gcp_firestore', 'pubsub': 'gcp_pubsub', 'bigquery': 'gcp_bigquery',
  'pod': 'k8s_pod', 'deployment': 'k8s_deployment', 'k8s_svc': 'k8s_service',
  'svc': 'k8s_service', 'ingress': 'k8s_ingress', 'configmap': 'k8s_configmap',
  'cm': 'k8s_configmap', 'secret': 'k8s_secret', 'job': 'k8s_job',
  'sts': 'k8s_statefulset', 'statefulset': 'k8s_statefulset',
  'llm': 'ml_llm', 'embedding': 'ml_embedding', 'embeddings': 'ml_embedding',
  'vector_db': 'ml_vectordb', 'vectordb': 'ml_vectordb',
  'agent': 'ml_agent', 'inference': 'ml_inference', 'training': 'ml_training',
  'rag': 'ml_rag', 'pipeline': 'ml_pipeline',
  'db': 'database', 'cache': 'cache', 'redis': 'cache',
}

/** Resolve a type slug to a stencil. Unknown slugs return the generic
 *  service stencil so the diagram never breaks. */
export function getStencil(type?: string): StencilDef {
  if (!type) return service
  const key = type.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return REGISTRY[key] ?? REGISTRY[ALIASES[key] ?? ''] ?? service
}

export function isKnownStencil(type?: string): boolean {
  if (!type) return false
  const key = type.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  return key in REGISTRY || (ALIASES[key] != null && ALIASES[key] in REGISTRY)
}

/** Canonical list of every registered slug — used by docs + tests. */
export const STENCIL_SLUGS = Object.keys(REGISTRY).sort((a, b) => a.localeCompare(b))

/** Grouped slug list for docs / palette UI. */
export const STENCIL_GROUPS = {
  AWS:        STENCIL_SLUGS.filter((s) => s.startsWith('aws_')),
  Azure:      STENCIL_SLUGS.filter((s) => s.startsWith('azure_')),
  GCP:        STENCIL_SLUGS.filter((s) => s.startsWith('gcp_')),
  Kubernetes: STENCIL_SLUGS.filter((s) => s.startsWith('k8s_')),
  'ML / AI':  STENCIL_SLUGS.filter((s) => s.startsWith('ml_')),
  Generic:    STENCIL_SLUGS.filter((s) => !/^(aws|azure|gcp|k8s|ml)_/.test(s)),
}
