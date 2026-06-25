/**
 * #781 Phase B — UI-side ArtifactKind taxonomy, mirroring the server's
 * `services/openagentic-api/src/services/ArtifactRegistry.ts` union.
 *
 * The `mini-app` kind is added on the UI side ahead of the server-side
 * registry (which currently has 5 kinds + 'unknown'); the server adds it
 * in plan Phase C6 after this UI layer is ready.
 */
export type ArtifactKind =
  | 'python-report'
  | 'react-app'
  | 'chart'
  | 'table'
  | 'runbook'
  | 'mini-app'
  | 'unknown';

/**
 * The exportable manifest the server stamps onto synth_execute outputs.
 * Mirrors `SynthExportableManifest` in `SynthExecuteTool.ts`. Used by the
 * ActionBar to enable conditional export buttons (PDF / PNG / CSV /
 * Download source).
 */
export interface ArtifactExportableManifest {
  kind: 'python-report' | 'chart' | 'table' | 'code';
  mime: string[];
  sources: string[];
}

/** Status of the artifact in its lifecycle. */
export type ArtifactStatus = 'running' | 'success' | 'error';
