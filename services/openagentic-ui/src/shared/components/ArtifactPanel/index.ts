/**
 * Phase H (task #153) — ArtifactPanel barrel.
 *
 * Right-side slide-out surface for streaming artifacts produced by the
 * chat model. Consumes the Phase H NDJSON envelope triple:
 *   `artifact_open` → N `artifact_delta` → `artifact_close`
 *
 * Distinct from the in-chat-message `ArtifactsPanel.tsx` (plural) which
 * is a file-management surface, and from `CanvasPanel.tsx` which runs
 * interactive HTML/React previews post-stream.
 */

export { ArtifactPanel } from './ArtifactPanel';
export type { ArtifactPanelProps } from './ArtifactPanel';

export {
  useArtifactPanel,
  reduceArtifactPanel,
} from './useArtifactPanelStream';
export type {
  ArtifactPanelEvent,
  UseArtifactPanelReturn,
} from './useArtifactPanelStream';

export {
  INITIAL_ARTIFACT_PANEL_STATE,
  DEFAULT_FILE_NAME,
} from './types';
export type {
  ArtifactKind,
  ArtifactFile,
  ArtifactStats,
  ArtifactPanelState,
} from './types';
