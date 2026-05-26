/**
 * Phase G (task #152) — `stage_change` event renderer.
 *
 * Horizontal 5-dot progress strip above a streaming message. Mirrors
 * the `.stages` + `.stage` classes from the v0.6.7 UX mockup — dots
 * pulse on the active phase, dim for pending, solid violet for done.
 *
 * The backend ChatPipeline collapses its real stage names
 * (auth/validation/rag/mcp/completion/…) into five UX phases:
 *
 *   discover → query → analyze → generate → verify
 *
 * Consumer passes the current phase + timing map; this component
 * decides which dots are done, active, or pending. Hover on a past
 * dot surfaces the elapsed time for that phase.
 */
import React, { memo } from 'react';
import { ensurePhaseGKeyframes } from './useKeyframes';

export type StagePhase = 'discover' | 'query' | 'analyze' | 'generate' | 'verify';

export const STAGE_ORDER: ReadonlyArray<StagePhase> = [
  'discover',
  'query',
  'analyze',
  'generate',
  'verify',
];

export interface StageStripProps {
  currentStage: StagePhase | null;
  timings?: Partial<Record<StagePhase, number>>;
}

const StageStripComponent: React.FC<StageStripProps> = ({ currentStage, timings }) => {
  ensurePhaseGKeyframes();
  const currentIndex = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  return (
    <div
      data-testid="stage-strip"
      data-current-stage={currentStage || undefined}
      role="progressbar"
      aria-label="Pipeline progress"
      aria-valuemin={0}
      aria-valuemax={STAGE_ORDER.length}
      aria-valuenow={currentIndex >= 0 ? currentIndex + 1 : 0}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '8px 0',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {STAGE_ORDER.map((stage, i) => {
        const isDone = currentIndex >= 0 && i < currentIndex;
        const isActive = currentIndex >= 0 && i === currentIndex;
        const ms = timings?.[stage];
        const hoverLabel = ms ? `${stage} · ${(ms / 1000).toFixed(1)}s` : stage;
        return (
          <React.Fragment key={stage}>
            <div
              data-testid={`stage-${stage}`}
              data-state={isDone ? 'done' : isActive ? 'active' : 'pending'}
              title={hoverLabel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                fontSize: 11,
                color: isActive ? 'var(--cm-accent)' : isDone ? 'var(--cm-text-secondary)' : 'var(--cm-text-muted)',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: isDone
                    ? 'var(--cm-success)'
                    : isActive
                      ? 'var(--cm-accent)'
                      : 'var(--cm-bg-tertiary)',
                  border: `1px solid ${
                    isDone ? 'var(--cm-success)' : isActive ? 'var(--cm-accent)' : 'var(--cm-border)'
                  }`,
                  boxShadow: isActive ? '0 0 0 3px color-mix(in srgb, var(--cm-accent) 22%, transparent)' : undefined,
                  animation: isActive ? 'stageStripPulse 1.6s ease-in-out infinite' : undefined,
                  flexShrink: 0,
                }}
              />
              {stage}
            </div>
            {i < STAGE_ORDER.length - 1 && (
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 1,
                  background:
                    'linear-gradient(90deg, currentColor 50%, transparent 50%)',
                  backgroundSize: '6px 1px',
                  margin: '0 2px',
                  opacity: 0.35,
                  color: 'var(--cm-text-muted)',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const StageStrip = memo(StageStripComponent);
StageStrip.displayName = 'StageStrip';
