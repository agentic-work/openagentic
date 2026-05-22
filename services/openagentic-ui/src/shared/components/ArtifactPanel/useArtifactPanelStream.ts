/**
 * Phase H (task #153) — ArtifactPanel stream consumer.
 *
 * Pure reducer + React hook that turns the 3 Phase H artifact events
 * (`artifact_open`, `artifact_delta`, `artifact_close`) into an
 * `ArtifactPanelState`. Consumers pipe events through `reduceArtifactPanel`
 * or use the `useArtifactPanel()` hook which wraps it in `useReducer`.
 *
 * The reducer is tolerant of stray or out-of-order events — stale deltas
 * that reference an `artifactId` not currently open are silently dropped,
 * matching the existing `artifact_start/delta/end` behavior.
 */
import { useCallback, useReducer } from 'react';
import {
  ArtifactFile,
  ArtifactKind,
  ArtifactPanelState,
  DEFAULT_FILE_NAME,
  INITIAL_ARTIFACT_PANEL_STATE,
} from './types';

export type ArtifactPanelEvent =
  | {
      type: 'artifact_open';
      artifactId: string;
      kind?: ArtifactKind;
      title?: string;
      language?: string;
      fileName?: string;
    }
  | {
      type: 'artifact_delta';
      artifactId: string;
      contentDelta: string;
      seq?: number;
      fileName?: string;
    }
  | {
      type: 'artifact_close';
      artifactId: string;
      finalContent?: string;
      stats?: { bytes: number; lines: number };
    }
  | { type: 'reset' }
  | { type: 'close_panel' };

function cloneFiles(prev: Map<string, ArtifactFile>): Map<string, ArtifactFile> {
  return new Map(prev);
}

/**
 * Reducer — pure. Every event returns a new state object (no mutation
 * of the passed prev), so this is safe to use in React useReducer.
 */
export function reduceArtifactPanel(
  state: ArtifactPanelState,
  event: ArtifactPanelEvent,
): ArtifactPanelState {
  switch (event.type) {
    case 'artifact_open': {
      const files = new Map<string, ArtifactFile>();
      const fileName = event.fileName ?? DEFAULT_FILE_NAME;
      files.set(fileName, {
        fileName,
        language: event.language,
        content: '',
        lastSeq: -1,
      });
      return {
        artifactId: event.artifactId,
        kind: event.kind ?? 'code',
        title: event.title ?? 'Artifact',
        files,
        isOpen: true,
        isComplete: false,
        stats: null,
      };
    }

    case 'artifact_delta': {
      // Stray delta for a different (or closed) artifact — drop it
      // rather than corrupting the panel.
      if (!state.artifactId || state.artifactId !== event.artifactId) {
        return state;
      }
      const files = cloneFiles(state.files);
      const fileName = event.fileName ?? DEFAULT_FILE_NAME;
      const prevFile = files.get(fileName) ?? {
        fileName,
        language: undefined,
        content: '',
        lastSeq: -1,
      };
      // Drop out-of-order deltas when both sides carry a seq.
      const incomingSeq = typeof event.seq === 'number' ? event.seq : prevFile.lastSeq + 1;
      if (incomingSeq <= prevFile.lastSeq && prevFile.lastSeq >= 0) {
        return state;
      }
      files.set(fileName, {
        ...prevFile,
        content: prevFile.content + (event.contentDelta ?? ''),
        lastSeq: incomingSeq,
      });
      return {
        ...state,
        files,
      };
    }

    case 'artifact_close': {
      if (!state.artifactId || state.artifactId !== event.artifactId) {
        return state;
      }
      // If the close payload carries finalContent, use it as the
      // authoritative full body for the default (single-file) artifact.
      // Multi-file artifacts rely on per-file deltas being complete.
      let files = state.files;
      if (event.finalContent && files.size === 1) {
        const onlyFile = Array.from(files.values())[0];
        if (onlyFile && onlyFile.content.length < event.finalContent.length) {
          files = cloneFiles(files);
          files.set(onlyFile.fileName, {
            ...onlyFile,
            content: event.finalContent,
            lastSeq: onlyFile.lastSeq,
          });
        }
      }
      return {
        ...state,
        files,
        isComplete: true,
        stats: event.stats ?? null,
      };
    }

    case 'close_panel': {
      return {
        ...state,
        isOpen: false,
      };
    }

    case 'reset':
    default:
      return INITIAL_ARTIFACT_PANEL_STATE;
  }
}

/**
 * React hook — reducer + memoised dispatch helpers.
 */
export interface UseArtifactPanelReturn {
  state: ArtifactPanelState;
  open: (event: Extract<ArtifactPanelEvent, { type: 'artifact_open' }>) => void;
  append: (event: Extract<ArtifactPanelEvent, { type: 'artifact_delta' }>) => void;
  close: (event: Extract<ArtifactPanelEvent, { type: 'artifact_close' }>) => void;
  closePanel: () => void;
  reset: () => void;
}

export function useArtifactPanel(): UseArtifactPanelReturn {
  const [state, dispatch] = useReducer(
    reduceArtifactPanel,
    INITIAL_ARTIFACT_PANEL_STATE,
  );

  const open: UseArtifactPanelReturn['open'] = useCallback((event) => {
    dispatch(event);
  }, []);
  const append: UseArtifactPanelReturn['append'] = useCallback((event) => {
    dispatch(event);
  }, []);
  const close: UseArtifactPanelReturn['close'] = useCallback((event) => {
    dispatch(event);
  }, []);
  const closePanel: UseArtifactPanelReturn['closePanel'] = useCallback(() => {
    dispatch({ type: 'close_panel' });
  }, []);
  const reset: UseArtifactPanelReturn['reset'] = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  return { state, open, append, close, closePanel, reset };
}
