/**
 * WaveTimeline — horizontal multi-wave timeline (mocks 06, 08).
 *
 *   <div class="cm-wave-timeline">
 *     <div class="cm-wt-hdr">
 *       <svg class="cm-wt-ico" />
 *       <span class="cm-wt-title">{title}</span>
 *     </div>
 *     <div class="cm-wt-row">
 *       <div class="cm-tag">{label}<span class="cm-dates">{dates}</span></div>
 *       <div class="cm-wt-bar">
 *         <div class="cm-seg cm-tone-{a-d}" style="left/width">{label}</div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Tones cycle a→b→c→d for sequential waves (purple/teal/amber/red palette).
 */

import React from 'react';

export type WaveTone = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

export interface WaveSegment {
  /** Left offset in 0-100 percent. */
  left: number;
  /** Width in 0-100 percent. */
  width: number;
  /** Optional inline label rendered inside the segment. */
  label?: string;
  tone: WaveTone;
}

export interface WaveRow {
  id: string;
  label: string;
  dates?: string;
  segments: ReadonlyArray<WaveSegment>;
}

export interface WaveTimelineProps {
  title: string;
  rows: ReadonlyArray<WaveRow>;
}

const CalendarIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="cm-wt-ico" aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export function WaveTimeline({ title, rows }: WaveTimelineProps) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="cm-wave-timeline" data-testid="wave-timeline">
      <div className="cm-wt-hdr">
        {CalendarIcon}
        <span className="cm-wt-title">{title}</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="cm-wt-row">
          <div className="cm-tag">
            {r.label}
            {r.dates && <span className="cm-dates">{r.dates}</span>}
          </div>
          <div className="cm-wt-bar">
            {r.segments.map((s, i) => (
              <div
                key={`${r.id}-${i}`}
                className={`cm-seg cm-tone-${s.tone}`}
                style={{ left: `${s.left}%`, width: `${s.width}%` }}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
