import React from 'react';

/**
 * Mock anatomy: a single inline pill `.handoff` that shows a model
 * escalation event. Driven by the NDJSON `model_handoff` frame:
 *   { from_model: string, to_model: string, reason?: string }
 *
 * Reference shape across mocks 02 + 04 + 06 — appears in the transcript
 * inline, between two assistant turns, when SmartModelRouter switches
 * (e.g. "show me my azure RGs" → cloud-list classifier escalates from
 * gpt-oss → gemini-2.5-flash).
 */

export interface HandoffPillProps {
  fromModel: string;
  toModel: string;
  reason?: string;
}

export function HandoffPill({ fromModel, toModel, reason }: HandoffPillProps) {
  return (
    <span
      className="cm-handoff"
      role="status"
      data-testid="handoff-pill"
      title={reason || `Routed from ${fromModel} to ${toModel}`}
    >
      <span className="cm-from">{fromModel}</span>
      <span className="cm-arrow" aria-hidden>
        →
      </span>
      <span className="cm-to">{toModel}</span>
      {reason && <span style={{ color: 'var(--cm-fg-3)' }}>· {reason}</span>}
    </span>
  );
}
