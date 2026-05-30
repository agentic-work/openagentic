/**
 * StreamEnginedActivityStream — Step 3 of the streaming-engine integration.
 *
 * Mounts a stable DOM container during streaming and feeds incoming
 * wire frames (published via the `streamFrameBus`) into a
 * `StreamEngine` instance for glitchless React-bypass rendering. After
 * stream completion the engine `finalize()`s and the caller hands off
 * to the canonical `AgenticActivityStream` render path — both speak
 * SDK `UIContentBlock[]` so the handoff is structurally invisible.
 *
 * Behind the `VITE_FEATURE_STREAM_ENGINE` env flag. Default OFF in
 * production helm values; ON in services/openagentic-ui/.env.local
 * during dev. Flip the flag to fall back to the legacy React-only
 * pipeline.
 *
 * Spec: docs/superpowers/specs/2026-05-18-streaming-engine-design.md
 */

import React, { useEffect, useRef } from 'react';

import type { UIStreamFrame, UIStreamFrameLoose } from '@agentic-work/llm-sdk';
import { StreamEngine } from '../../streamEngine/StreamEngine';

// ─────────────────────────────────────────────────────────────────────────
// Frame bus — module-singleton callback registry the useChatStream loop
// publishes wire frames into. Subscribers (this wrapper) hook in via
// `registerStreamFrameTap`. Frames are pushed synchronously — the engine
// applies them immediately into its owned DOM container.
// ─────────────────────────────────────────────────────────────────────────

type FrameTap = (frame: UIStreamFrame | UIStreamFrameLoose) => void;

let _taps: FrameTap[] = [];

/**
 * Register a function to receive every frame published into the bus.
 * Returns an unsubscribe function. Subscribers receive frames in the
 * order they were published.
 */
export function registerStreamFrameTap(fn: FrameTap): () => void {
  _taps.push(fn);
  return () => {
    _taps = _taps.filter((t) => t !== fn);
  };
}

/**
 * Publish a frame into the bus. Called from useChatStream's frame loop
 * (one call per applyCanonicalFrame invocation). Synchronous fan-out —
 * each tap runs in registration order and any tap exception is caught
 * locally so a misbehaving tap can't block the streaming hot path.
 */
export function publishStreamFrame(frame: UIStreamFrame | UIStreamFrameLoose): void {
  for (const tap of _taps) {
    try {
      tap(frame);
    } catch (err) {
      // Swallow — a streaming-tap fault must not crash the wire loop.
      // eslint-disable-next-line no-console
      console.warn('[streamFrameBus] tap threw:', err);
    }
  }
}

/**
 * Test-only — reset the tap registry between cases. Not part of the
 * production surface (no consumer outside tests should call this).
 */
export function __resetStreamFrameBus(): void {
  _taps = [];
}

// ─────────────────────────────────────────────────────────────────────────
// StreamEnginedActivityStream — the React wrapper.
//
// Mounts a host <div data-cm-stream-engine="true"> when isStreaming=true,
// instantiates a StreamEngine over it, and subscribes to the frame bus
// for the lifetime of the streaming turn. On unmount or on
// isStreaming=false transition, calls engine.finalize() and engine.destroy().
// ─────────────────────────────────────────────────────────────────────────

export interface StreamEnginedActivityStreamProps {
  messageId: string;
  isStreaming: boolean;
  /**
   * Optional callback fired on finalize. Caller can read the produced
   * `contentBlocks` for telemetry / parity-assert / mid-stream snapshot.
   */
  onFinalize?: (result: ReturnType<StreamEngine['finalize']>) => void;
}

export const StreamEnginedActivityStream: React.FC<StreamEnginedActivityStreamProps> = ({
  messageId,
  isStreaming,
  onFinalize,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<StreamEngine | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isStreaming) return;
    if (!hostRef.current) return;

    // Instantiate engine on the stable container.
    const engine = new StreamEngine(hostRef.current);
    engine.beginMessage(messageId);
    engineRef.current = engine;

    // Subscribe to frame bus.
    const unsub = registerStreamFrameTap((frame) => {
      try {
        engine.applyFrame(frame as UIStreamFrameLoose);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[StreamEnginedActivityStream] engine.applyFrame threw:', err);
      }
    });
    unsubRef.current = unsub;

    return () => {
      // Unsubscribe first so no in-flight frame races with destroy.
      unsubRef.current?.();
      unsubRef.current = null;

      // Finalize + emit telemetry.
      try {
        const result = engine.finalize();
        onFinalize?.(result);
      } catch {
        // ignore — already-destroyed engines no-op
      }
      engine.destroy();
      engineRef.current = null;
    };
    // intentionally exclude onFinalize from deps — keep engine stable
    // across re-renders that only change the callback identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, messageId]);

  if (!isStreaming) return null;

  return (
    <div
      ref={hostRef}
      className="cm-stream-engine-host"
      data-cm-stream-engine="true"
      data-cm-message-id={messageId}
    />
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Feature flag helper — read once at module load. Vite injects
// `import.meta.env.VITE_FEATURE_STREAM_ENGINE` at build time.
// Truthy values: "1", "true", "yes" (case-insensitive). Default OFF.
// ─────────────────────────────────────────────────────────────────────────

export function isStreamEngineEnabled(): boolean {
  try {
    // Vite + Vitest both populate import.meta.env. In environments where it
    // is undefined we default-fail-closed (flag OFF) to preserve legacy
    // behavior.
    const raw =
      (typeof import.meta !== 'undefined' &&
        (import.meta as unknown as { env?: Record<string, string | undefined> }).env
          ?.VITE_FEATURE_STREAM_ENGINE) ||
      '';
    return /^(1|true|yes|on)$/i.test(raw.trim());
  } catch {
    return false;
  }
}
