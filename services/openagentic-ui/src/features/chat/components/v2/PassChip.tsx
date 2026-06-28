/**
 * PassChip — sub-agent multi-pass indicator (mock 04 anatomy).
 *
 *   <span class="cm-pass-chip cm-pass-2">pass 2</span>
 *
 * Sits inside `cm-sa-head` next to `cm-stats`. Pass 1 is implicit and
 * never rendered (every dispatch is at least pass 1; the chip only
 * appears after a self-correction triggers a re-dispatch).
 *
 * Tone variants (chatmode-v2.css):
 *   pass-2 → amber soft (after first correction)
 *   pass-3 → orange (escalating, retry budget burning)
 *   pass-4+ → red (final retry territory)
 */

import React from 'react';

export interface PassChipProps {
  pass: number;
}

export function PassChip({ pass }: PassChipProps) {
  if (!Number.isFinite(pass) || pass < 2) return null;
  const safe = Math.max(2, Math.floor(pass));
  return (
    <span
      className={`cm-pass-chip cm-pass-${safe}`}
      data-testid="pass-chip"
      data-pass={safe}
    >
      pass {safe}
    </span>
  );
}
