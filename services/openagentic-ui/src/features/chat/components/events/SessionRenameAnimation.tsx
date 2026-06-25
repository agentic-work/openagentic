/**
 * Phase H (task #153) — `session_rename` event renderer.
 *
 * Wrapper hook + tiny presentational component that implements the
 * ~300ms cross-fade morph of a session title. The hook's canonical use
 * is in the sidebar SessionRow and in the chat header TitleBar: both
 * call `useSessionRenameMorph(sessionId, title)` and the title morphs
 * on every new payload.
 *
 * Wire contract: `{sessionId, from, to, reason}`.
 *
 * Why a hook + component split?
 *   - The hook is stateless from the consumer's perspective — just pass
 *     in the authoritative title and it animates whenever the title
 *     string changes.
 *   - The component is opt-in: some surfaces may prefer to render the
 *     morph themselves (e.g. chat header has a custom font-size path).
 */
import React, { memo, useEffect, useRef, useState } from 'react';

export interface SessionRenameAnimationProps {
  sessionId: string;
  title: string;
  className?: string;
  /** Animation duration in ms. Default 300ms per task #153 spec. */
  durationMs?: number;
}

export interface UseSessionRenameMorphReturn {
  /** Currently visible title. Switches from `from` to `to` during the fade. */
  displayed: string;
  /** True while the cross-fade is in progress. */
  isMorphing: boolean;
  /** The previous title (only meaningful while isMorphing=true). */
  previous: string | null;
}

/**
 * Cross-fade morph hook. Consumers pass the authoritative current
 * `title`; the hook animates whenever `title` changes. Returns the
 * displayed string + previous value + morph flag so the consumer can
 * render a two-layer opacity transition if it wants a richer effect.
 */
export function useSessionRenameMorph(
  _sessionId: string,
  title: string,
  durationMs: number = 300,
): UseSessionRenameMorphReturn {
  const [displayed, setDisplayed] = useState(title);
  const [previous, setPrevious] = useState<string | null>(null);
  const [isMorphing, setIsMorphing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (title === displayed) return;
    // Stash old value so consumer can render a two-layer cross-fade.
    setPrevious(displayed);
    setDisplayed(title);
    setIsMorphing(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsMorphing(false);
      setPrevious(null);
      timeoutRef.current = null;
    }, Math.max(50, durationMs));
    // NOTE: we deliberately do NOT return a cleanup here — clearing the
    // timeout on the next effect run would cancel the in-flight morph
    // as soon as setDisplayed(title) triggers the next render. The
    // unmount cleanup below handles stray timers at component teardown.
  }, [title, displayed, durationMs]);

  // Single unmount-only cleanup so the active morph timer is released
  // if the component leaves the tree before it fires.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { displayed, isMorphing, previous };
}

const SessionRenameAnimationComponent: React.FC<SessionRenameAnimationProps> = ({
  sessionId,
  title,
  className,
  durationMs = 300,
}) => {
  const { displayed, isMorphing, previous } = useSessionRenameMorph(
    sessionId,
    title,
    durationMs,
  );

  return (
    <span
      data-testid="session-rename-animation"
      data-session-id={sessionId}
      data-morphing={isMorphing ? 'true' : undefined}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-block',
        minHeight: '1em',
        minWidth: 24,
      }}
    >
      {isMorphing && previous !== null && (
        <span
          data-testid="session-rename-previous"
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            transition: `opacity ${durationMs}ms ease-out`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {previous}
        </span>
      )}
      <span
        data-testid="session-rename-current"
        style={{
          opacity: 1,
          transition: `opacity ${durationMs}ms ease-in`,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {displayed}
      </span>
    </span>
  );
};

export const SessionRenameAnimation = memo(SessionRenameAnimationComponent);
SessionRenameAnimation.displayName = 'SessionRenameAnimation';
