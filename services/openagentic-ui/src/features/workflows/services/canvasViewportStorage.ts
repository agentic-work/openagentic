/**
 * canvasViewportStorage
 *
 * Persists the ReactFlow viewport (x, y, zoom) per workflow id in
 * localStorage so reopening a flow restores the user's last camera
 * state instead of always re-fitting from scratch.
 *
 * Storage key: `openagentic.workflow.viewport.<workflowId>` →
 * `JSON.stringify({x,y,zoom})`. All operations degrade safely when
 * localStorage is unavailable, full, or contains corrupted data.
 */

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

const PREFIX = 'openagentic.workflow.viewport.';

function key(workflowId: string): string {
  return `${PREFIX}${workflowId}`;
}

function isValid(v: unknown): v is CanvasViewport {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.x === 'number' &&
    typeof obj.y === 'number' &&
    typeof obj.zoom === 'number' &&
    Number.isFinite(obj.x) &&
    Number.isFinite(obj.y) &&
    Number.isFinite(obj.zoom)
  );
}

export function loadViewport(workflowId: string): CanvasViewport | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(workflowId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveViewport(workflowId: string, viewport: CanvasViewport): void {
  if (!isValid(viewport)) return;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(workflowId), JSON.stringify(viewport));
  } catch {
    // QuotaExceeded or sandbox restriction — silently skip.
  }
}

export function clearViewport(workflowId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key(workflowId));
  } catch {
    // ignore
  }
}
