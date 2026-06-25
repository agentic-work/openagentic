import React from 'react';

/**
 * Mock anatomy: `.stages` — a flex-wrap row of pill chips, each one a
 * named pipeline stage with a status dot. NDJSON-driven: consumes
 * `stage_progress` frames per the streaming-contract.md.
 *
 * Renders nothing if `stages` is empty — the strip is opt-in per
 * conversation and only appears on multi-step / orchestration flows.
 */

export type StageStatus = 'pending' | 'active' | 'done' | 'failed';

export interface StageItem {
  id: string;
  label: string;
  status: StageStatus;
}

export interface StagesStripProps {
  stages: StageItem[];
}

export function StagesStrip({ stages }: StagesStripProps) {
  if (!stages || stages.length === 0) return null;
  return (
    <div className="cm-stages" role="list" data-testid="stages-strip">
      {stages.map((s) => (
        <span
          key={s.id}
          role="listitem"
          className={[
            'cm-stage',
            s.status === 'active' && 'cm-active',
            s.status === 'done' && 'cm-done',
            s.status === 'failed' && 'cm-failed',
          ]
            .filter(Boolean)
            .join(' ')}
          data-stage-status={s.status}
        >
          <span className="cm-dot" aria-hidden />
          <span>{s.label}</span>
        </span>
      ))}
    </div>
  );
}
