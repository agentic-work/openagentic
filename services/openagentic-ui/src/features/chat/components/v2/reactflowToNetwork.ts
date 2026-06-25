/**
 * Translates a ReactFlow-shaped `{nodes, edges}` JSON payload (the legacy
 * `compose_visual({template:'reactflow_arch'})` wire shape) into the
 * `NetworkData` shape consumed by the lib/charts `Network` component
 * (d3-force simulation + theme-token-driven palette + shared chart frame).
 *
 * Sev #835 (2026-05-14) — compose_visual's reactflow_arch outputs looked
 * shit on a real enterprise architecture prompt: ReactFlow needs explicit
 * (x,y) coordinates the model couldn't reliably produce, so we got
 * crammed/overlapping nodes. The `lib/charts/Network` component uses
 * d3-force auto-layout from topology alone, matches the admin console
 * chart styling, and uses --cm-* theme tokens.
 *
 * This adapter is the migration shim — it lets us flip
 * `kind='reactflow_arch'` to the new renderer without changing the
 * model-facing tool schema yet. The compose_visual server tool
 * description still accepts the RF shape; the UI translates.
 *
 * Phase 2 (separate commit): server-side compose_visual nudges the model
 * to emit `template: 'network' | 'bundle' | 'chord'` directly so this
 * adapter becomes a backwards-compat path only.
 */
import type { NetworkData, NetworkNode, NetworkLink } from '../../../../lib/charts/components/Network';

export interface ReactFlowNode {
  id: string | number;
  /** ReactFlow v11 shape — label nested under `data`. */
  data?: { label?: string; kind?: string };
  /** Some emitters put label at top level. */
  label?: string;
  /** ReactFlow node `type` field — repurpose as Network `kind` (drives color). */
  type?: string;
  /** Ignored — Network auto-lays-out via d3-force. */
  position?: { x: number; y: number };
}

export interface ReactFlowEdge {
  id?: string;
  source: string | number;
  target: string | number;
  /** Optional weight — sqrt-scaled to link stroke width. */
  data?: { weight?: number };
  label?: string;
}

export interface ReactFlowPayload {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

/**
 * Pure adapter — no DOM, no React. Safe to test in isolation.
 *
 * @throws if `payload` is null / wrong shape — caller should guard.
 */
export function reactflowToNetwork(payload: ReactFlowPayload): NetworkData {
  if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error('reactflowToNetwork: payload must be { nodes: [], edges: [] }');
  }

  const nodes: NetworkNode[] = payload.nodes.map((n) => {
    const id = String(n.id);
    // ReactFlow puts label at `data.label`; some emitters use top-level
    // `label`; fall back to the id so the user still sees something.
    const name = n.data?.label ?? n.label ?? id;
    // `kind` drives Network's color-by-kind palette — derive from RF
    // `type` (e.g. "azure-frontdoor", "appgw", "backend-pool") or
    // `data.kind` if present.
    const kind = n.type ?? n.data?.kind;
    const node: NetworkNode = { id, name };
    if (kind) node.kind = kind;
    return node;
  });

  const links: NetworkLink[] = payload.edges.map((e) => ({
    source: String(e.source),
    target: String(e.target),
    value: e.data?.weight ?? 1,
  }));

  return { nodes, links };
}

/**
 * Try-parse the wire `content` string (compose_visual emits
 * `JSON.stringify({nodes, edges})` for reactflow_arch). Returns null on
 * malformed input so the caller can render a fallback instead of throwing.
 */
export function parseReactflowContent(content: string): ReactFlowPayload | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }
    return parsed as ReactFlowPayload;
  } catch {
    return null;
  }
}
