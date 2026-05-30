/**
 * #503 — natural printout pacer.
 *
 * Reveals an `incomingContent` string char-by-char at a fixed cadence,
 * matching mocks/UX/mock.html (lines 378-409). Two important differences
 * from the older `useSmoothStreaming`:
 *
 *   1. Constant cadence — no adaptive 3x burst when far behind. The point
 *      is human readability, not throughput. If the model out-runs the
 *      pacer, the user sees prose appear at the same comfortable speed.
 *
 *   2. Per-block defaults — caller passes the cadence (15ms prose,
 *      20ms tool output per the mock). This hook is intentionally thin
 *      so the caller decides.
 *
 * Contract:
 *   - `displayed` grows from '' to `incomingContent` one char per
 *     `intervalMs` tick.
 *   - `done` is true when displayed === incomingContent (or content is
 *     empty/undefined).
 *   - When `enabled === false` the hook is a passthrough — full content
 *     immediately, done=true. Useful for "completed message on initial
 *     mount" (don't replay history).
 *   - If `incomingContent` shrinks (replaced rather than appended), the
 *     pacer resets so we never display more than the current target.
 */

import { useEffect, useRef, useState } from 'react';

export interface UseTextPacerOptions {
  /** Milliseconds per char. Default 15ms (prose). Use 20ms for tool output. */
  intervalMs?: number;
  /** When false, returns full content immediately (no pacing). */
  enabled?: boolean;
}

export interface UseTextPacerReturn {
  displayed: string;
  done: boolean;
}

export function useTextPacer(
  incomingContent: string | undefined,
  options: UseTextPacerOptions = {},
): UseTextPacerReturn {
  const { intervalMs = 15, enabled = true } = options;

  const target = incomingContent ?? '';
  const [displayed, setDisplayed] = useState<string>(() => (enabled ? '' : target));
  const indexRef = useRef<number>(enabled ? 0 : target.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      indexRef.current = target.length;
      setDisplayed(target);
      return;
    }

    if (target.length === 0) {
      indexRef.current = 0;
      setDisplayed('');
      return;
    }

    if (indexRef.current > target.length) {
      indexRef.current = 0;
      setDisplayed('');
    }

    if (indexRef.current >= target.length) {
      return;
    }

    const tick = () => {
      const next = indexRef.current + 1;
      indexRef.current = next;
      setDisplayed(target.slice(0, next));
      if (next < target.length) {
        timerRef.current = setTimeout(tick, intervalMs);
      } else {
        timerRef.current = null;
      }
    };

    timerRef.current = setTimeout(tick, intervalMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [target, intervalMs, enabled]);

  const done = displayed.length >= target.length;
  return { displayed, done };
}
