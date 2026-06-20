/**
 * #781 Phase D.2 — extractArtifacts helper.
 *
 * Scans a chat Message for new-pipeline artifacts (either persisted
 * `visualizations[]` entries OR `tool_result._meta.artifactKind`
 * stamps) and returns descriptors that MessageBubble feeds into
 * `ArtifactSlideOutLauncher`.
 *
 * Legacy ```artifact:html fences are NOT picked up — those still
 * route through the legacy `ArtifactRenderer` pipeline until
 * Phase D.3 ripping.
 */
import type { ArtifactKind, ArtifactStatus } from './types.js';

export interface ArtifactDescriptor {
  kind: ArtifactKind;
  title: string;
  payload: unknown;
  status: ArtifactStatus;
  /** Source id for stable React keys: visualization index OR tool_use_id. */
  id: string;
}

const KIND_LABELS: Record<string, string> = {
  'python-report': 'Report',
  'react-app': 'App',
  chart: 'Chart',
  table: 'Table',
  runbook: 'Runbook',
  'mini-app': 'Mini-App',
  unknown: 'Artifact',
};

// Strict allowlist — `Message.visualizations[]` is the legacy catch-all
// envelope array and holds hitl_approval / follow_up / sub_agent / tool_call
// frames alongside real artifact descriptors. Phase D launchers must ONLY
// fire for these 6 production kinds, never for `unknown` or non-artifact
// frame subtypes. Regression: 60+ "unknown Artifact" launchers rendered on
// a single message in the dev environment 0.7.1-3d7fb248 (2026-05-13).
const ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'python-report',
  'react-app',
  'chart',
  'table',
  'runbook',
  'mini-app',
]);

function normalizeStatus(s: unknown): ArtifactStatus {
  if (s === 'error' || s === 'running') return s;
  return 'success';
}

export function extractArtifacts(message: any): ArtifactDescriptor[] {
  const out: ArtifactDescriptor[] = [];
  if (!message || typeof message !== 'object') return out;

  // Source A: persisted visualizations[]. Strict allowlist — see
  // ARTIFACT_KINDS comment above; the legacy `visualizations` array
  // is a catch-all for many envelope frames, not just artifacts.
  const vizs = Array.isArray(message.visualizations) ? message.visualizations : [];
  for (let i = 0; i < vizs.length; i++) {
    const v = vizs[i];
    if (!v || typeof v !== 'object') continue;
    if (typeof v.kind !== 'string' || !ARTIFACT_KINDS.has(v.kind)) continue;
    const kind = v.kind as ArtifactKind;
    out.push({
      id: `viz-${i}`,
      kind,
      title: v.title ?? KIND_LABELS[kind] ?? 'Artifact',
      payload: v.payload ?? v,
      status: normalizeStatus(v.status),
    });
  }

  // Source B: tool_result blocks with _meta.artifactKind in the allowlist.
  const trs = Array.isArray(message.toolResults) ? message.toolResults : [];
  for (const tr of trs) {
    if (!tr || typeof tr !== 'object') continue;
    const meta = tr._meta;
    if (!meta || typeof meta !== 'object') continue;
    if (typeof meta.artifactKind !== 'string' || !ARTIFACT_KINDS.has(meta.artifactKind)) continue;
    const kind = meta.artifactKind as ArtifactKind;
    out.push({
      id: tr.tool_use_id ?? `tr-${out.length}`,
      kind,
      title: meta.artifactTitle ?? KIND_LABELS[kind] ?? 'Artifact',
      payload: meta.payload ?? meta ?? tr.content,
      status: normalizeStatus(meta.status),
    });
  }

  return out;
}
