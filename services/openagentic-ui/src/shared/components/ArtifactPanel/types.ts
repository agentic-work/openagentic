/**
 * Phase H (task #153) — ArtifactPanel state model.
 *
 * Shared between `ArtifactPanel.tsx` (render) and
 * `useArtifactPanelStream.ts` (stream consumer). The state accumulates
 * as `artifact_open` → N `artifact_delta` → `artifact_close` events
 * fire on the chat NDJSON wire.
 */

export type ArtifactKind = 'markdown' | 'code' | 'chart' | 'csv';

export interface ArtifactFile {
  /** Logical file name within the artifact (e.g. `src/App.tsx`). */
  fileName: string;
  /** Optional source language (syntax highlighting). */
  language?: string;
  /** Accumulated content from all artifact_delta events for this file. */
  content: string;
  /** Highest `seq` seen for this file. */
  lastSeq: number;
}

export interface ArtifactStats {
  bytes: number;
  lines: number;
}

export interface ArtifactPanelState {
  /** Stable ID from the artifact_open envelope. */
  artifactId: string | null;
  /** Kind from artifact_open (default: `code`). */
  kind: ArtifactKind;
  /** Title from artifact_open. */
  title: string;
  /** Files keyed by fileName. Single-file artifacts still go here under a
   *  synthetic `__default__` key. */
  files: Map<string, ArtifactFile>;
  /** Panel visibility — true from artifact_open until the user closes it. */
  isOpen: boolean;
  /** True once artifact_close has fired. Freezes typewriter cursor. */
  isComplete: boolean;
  /** Stats from artifact_close, if present. */
  stats?: ArtifactStats | null;
}

export const INITIAL_ARTIFACT_PANEL_STATE: ArtifactPanelState = {
  artifactId: null,
  kind: 'code',
  title: '',
  files: new Map(),
  isOpen: false,
  isComplete: false,
  stats: null,
};

/** Synthetic default file name for single-file artifacts. */
export const DEFAULT_FILE_NAME = '__default__';
