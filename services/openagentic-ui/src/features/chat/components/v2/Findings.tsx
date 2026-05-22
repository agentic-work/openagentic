/**
 * Findings — numbered findings list with severity variants.
 *
 * Mock anatomy: mocks 03 (security review), 07 (TS refactor risks),
 * 08 (Kafka/Flink ETL audit), 09 (full-stack SaaS).
 *
 *   <div class="cm-findings">
 *     <div class="cm-finding cm-sev-{severity}">
 *       <div class="cm-f-head">
 *         <span class="cm-ord">N</span>
 *         <span class="cm-title">{title}</span>
 *         <span class="cm-sev">{severity}</span>
 *       </div>
 *       <div class="cm-f-body">{body}</div>   (optional)
 *     </div>
 *   </div>
 *
 * Severity drives left-border colour + sev-label tint:
 *   critical (red) → high (orange) → med (amber) → low (yellow) → info (blue) → ok (green)
 */

import React from 'react';

export type FindingSeverity = 'critical' | 'high' | 'med' | 'low' | 'info' | 'ok';

export interface FindingItem {
  id: string;
  title: string;
  severity: FindingSeverity;
  body?: React.ReactNode;
}

export interface FindingsProps {
  items: ReadonlyArray<FindingItem>;
  /** Override the ordinal start (default 1). */
  ordStart?: number;
}

export function Findings({ items, ordStart = 1 }: FindingsProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="cm-findings" data-testid="findings">
      {items.map((it, idx) => (
        <div
          key={it.id}
          className={`cm-finding cm-sev-${it.severity}`}
          data-severity={it.severity}
        >
          <div className="cm-f-head">
            <span className="cm-ord">{ordStart + idx}</span>
            <span className="cm-title">{it.title}</span>
            <span className="cm-sev">{it.severity}</span>
          </div>
          {it.body && <div className="cm-f-body">{it.body}</div>}
        </div>
      ))}
    </div>
  );
}
