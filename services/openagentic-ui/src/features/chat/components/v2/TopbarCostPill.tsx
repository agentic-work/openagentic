import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Topbar session-cost pill — shows the running total cost across all
 * messages in the current session. Replaces the per-message CostPill
 * that lived inside `MessageBubble` (ripped per the V2 plan: per-message
 * pill is noise; topbar is the SoT for "how much has this session cost").
 *
 * Mock anatomy: `.cost-pill` from mocks/UX/01-cloud-ops.html — pulsing
 * accent dot + tabular-nums dollar amount in a rounded pill. CSS lives
 * in chatmode-v2.css alongside the rest of the V2 surface.
 *
 * Input: an array of message-shape objects with optional `tokenUsage` /
 * `cost` / `costUsd` fields. We're permissive about field names so the
 * pill works regardless of which provider populated the row.
 */

type MaybeCost = {
  tokenUsage?: {
    cost?: number;
    costUsd?: number;
    total_cost?: number;
    promptCost?: number;
    completionCost?: number;
  } | null;
  cost?: number | null;
  costUsd?: number | null;
};

export interface TopbarCostPillProps {
  /** Permissive — accept any message-shape; we only read tokenUsage / cost / costUsd if present. */
  messages?: ReadonlyArray<unknown>;
  /** Override sum (e.g. live streaming running cost). When set, replaces the message-aggregation. */
  override?: number;
  /** Show a "live" pulsing dot (typically while a turn is streaming). */
  live?: boolean;
}

function pickCost(raw: unknown): number {
  const m = raw as MaybeCost;
  const u = m?.tokenUsage;
  if (u) {
    if (typeof u.costUsd === 'number') return u.costUsd;
    if (typeof u.cost === 'number') return u.cost;
    if (typeof u.total_cost === 'number') return u.total_cost;
    const p = typeof u.promptCost === 'number' ? u.promptCost : 0;
    const c = typeof u.completionCost === 'number' ? u.completionCost : 0;
    if (p + c > 0) return p + c;
  }
  if (typeof m?.costUsd === 'number') return m.costUsd;
  if (typeof m?.cost === 'number') return m.cost;
  return 0;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function TopbarCostPill({ messages, override, live }: TopbarCostPillProps) {
  const total = useMemo<number>(() => {
    if (typeof override === 'number') return override;
    let sum = 0;
    for (const m of messages || []) sum += pickCost(m);
    return sum;
  }, [messages, override]);

  // Delta-flash: when total goes UP, render a transient cm-delta with the
  // increment. Animation lasts ~2.4s (mock 01:226). On increment we bump a
  // version key + record the delta value; a timer unmounts after 2400ms.
  const prevRef = useRef<number>(total);
  const [delta, setDelta] = useState<{ value: number; key: number } | null>(null);
  const versionRef = useRef(0);
  useEffect(() => {
    const diff = total - prevRef.current;
    prevRef.current = total;
    if (diff > 0) {
      versionRef.current += 1;
      const key = versionRef.current;
      setDelta({ value: diff, key });
      const t = setTimeout(() => {
        setDelta((curr) => (curr && curr.key === key ? null : curr));
      }, 2400);
      return () => clearTimeout(t);
    }
    // No-op for flat or decreasing totals.
    return undefined;
  }, [total]);

  return (
    <span
      className={`cm-v2-pill cm-cost-pill${live ? ' cm-live' : ''}`}
      data-testid="topbar-cost-pill"
      title={`Session total cost: ${fmtUsd(total)}`}
    >
      <span className="cm-dot" aria-hidden />
      <span className="cm-amount">{fmtUsd(total)}</span>
      {delta && (
        <span className="cm-delta" key={delta.key} data-testid="topbar-cost-delta">
          {`+${fmtUsd(delta.value)}`}
        </span>
      )}
    </span>
  );
}
