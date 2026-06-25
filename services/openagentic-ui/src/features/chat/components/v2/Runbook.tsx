/**
 * Runbook — ordered step list for DR / incident / pipeline runbooks.
 *
 * Mock 04 anatomy (multi-region DR), also used by mocks 05 (compliance
 * playbook) and 08 (Kafka/Flink ETL pipeline pass-list).
 *
 *   <div class="cm-runbook">
 *     <div class="cm-rb-hdr">
 *       <svg class="cm-rb-ico" />
 *       <span class="cm-rb-title">{title}</span>
 *       <span class="cm-rb-budget">{budget}</span>
 *     </div>
 *     <div class="cm-rb-step cm-sev-{severity}?">
 *       <div class="cm-n">{tag}</div>
 *       <div class="cm-t">
 *         <strong>{title}</strong>: {body}
 *         <span class="cm-owner">{owner}</span>
 *       </div>
 *       <div class="cm-dur">{duration}</div>
 *     </div>
 *   </div>
 *
 * Severity (optional per step):
 *   ok / warn / err — drives the cm-n badge tint.
 */

import React from 'react';

export type RunbookSeverity = 'ok' | 'warn' | 'err';

export interface RunbookStep {
  /** Step tag: "T+0", "T+1.5", "1.", etc. */
  tag: string;
  /** Bold step title rendered before the body. */
  title: string;
  /** Body text or rich content. */
  body: React.ReactNode;
  /** Owner / actor line — rendered as cm-owner span. */
  owner?: string;
  /** Duration / SLA — rendered right-aligned. */
  duration?: string;
  /** Optional severity drives the cm-sev-* tint. */
  severity?: RunbookSeverity;
}

export interface RunbookProps {
  /** Runbook title — typically the failure scenario or playbook name. */
  title: string;
  /** Right-aligned budget / actual line in the header. */
  budget?: string;
  steps: ReadonlyArray<RunbookStep>;
}

const FileIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="cm-rb-ico" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

export function Runbook({ title, budget, steps }: RunbookProps) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="cm-runbook" data-testid="runbook">
      <div className="cm-rb-hdr">
        {FileIcon}
        <span className="cm-rb-title">{title}</span>
        {budget && <span className="cm-rb-budget">{budget}</span>}
      </div>
      {steps.map((s, idx) => (
        <div
          key={`${s.tag}-${idx}`}
          className={`cm-rb-step${s.severity ? ` cm-sev-${s.severity}` : ''}`}
        >
          <div className="cm-n">{s.tag}</div>
          <div className="cm-t">
            <strong>{s.title}</strong>: {s.body}
            {s.owner && <span className="cm-owner">owner · {s.owner}</span>}
          </div>
          {s.duration && <div className="cm-dur">{s.duration}</div>}
        </div>
      ))}
    </div>
  );
}
