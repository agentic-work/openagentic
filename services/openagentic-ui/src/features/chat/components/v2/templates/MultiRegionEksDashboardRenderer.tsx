/**
 * MultiRegionEksDashboardRenderer — compose_visual:multi-region-eks-dashboard (mock 06).
 *
 * AWS EKS multi-region status — region columns × cluster rows; each cell has
 * node-count + pod-count + ready/total + alert chip.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-06-aws-k8s-aiops.html
 * Token-driven; no hex literals.
 *
 * the design notes
 *       §Phase 2.2.3 — A2 UI render pipeline.
 */

import React from 'react';

export type EksCellStatus = 'ok' | 'warn' | 'err' | 'unknown';

export interface EksCell {
  /** Status drives the cell tint. */
  status: EksCellStatus;
  /** Node count (workers in this region for this cluster). */
  nodes?: number;
  /** Pod count (running pods). */
  pods?: number;
  /** "ready" portion of `ready/total` ratio for pods. */
  ready?: number;
  /** "total" portion — total pods scheduled. */
  total?: number;
  /** Optional alert label rendered as a pill ("CrashLoopBackOff"). */
  alert?: string;
}

export interface EksRow {
  /** Stable id used as a row key. */
  id: string;
  /** Cluster name (rendered in the leftmost label column). */
  cluster: string;
  /** Per-region cells. Index aligned with `regions`. Missing slot → unknown. */
  cells: ReadonlyArray<EksCell | undefined>;
}

export interface MultiRegionEksDashboardRendererProps {
  title?: string;
  /** Column labels — usually AWS region codes. */
  regions: ReadonlyArray<string>;
  rows: ReadonlyArray<EksRow>;
}

function cellTone(s: EksCellStatus): string {
  switch (s) {
    case 'ok':
      return 'var(--cm-ok, currentColor)';
    case 'warn':
      return 'var(--cm-warn, currentColor)';
    case 'err':
      return 'var(--cm-err, currentColor)';
    case 'unknown':
    default:
      return 'var(--cm-fg-3, currentColor)';
  }
}

export function MultiRegionEksDashboardRenderer({
  title,
  regions,
  rows,
}: MultiRegionEksDashboardRendererProps) {
  if (!rows || rows.length === 0 || !regions || regions.length === 0) return null;

  return (
    <div
      className="cm-multi-region-eks-dashboard"
      data-testid="multi-region-eks-dashboard-renderer"
      style={{
        background: 'transparent',
        color: 'var(--cm-fg-1)',
        fontFamily: 'inherit',
      }}
    >
      {title && (
        <div
          style={{
            marginBottom: 8,
            fontWeight: 600,
            color: 'var(--cm-fg-0)',
            fontSize: 14,
          }}
        >
          {title}
        </div>
      )}
      <table
        className="cm-eks-grid"
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          background: 'var(--cm-bg-1, transparent)',
          border: '1px solid var(--cm-stroke-1)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--cm-stroke-2)' }}>
            <th
              scope="col"
              style={{
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--cm-fg-3)',
                fontFamily: 'JetBrains Mono, monospace',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                background: 'var(--cm-bg-2, transparent)',
              }}
            >
              cluster
            </th>
            {regions.map((r) => (
              <th
                key={`region-${r}`}
                scope="col"
                data-region={r}
                style={{
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--cm-fg-3)',
                  fontFamily: 'JetBrains Mono, monospace',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  background: 'var(--cm-bg-2, transparent)',
                }}
              >
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-cluster-id={row.id}
              style={{ borderBottom: '1px dashed var(--cm-stroke-2)' }}
            >
              <th
                scope="row"
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  color: 'var(--cm-fg-0)',
                  fontWeight: 600,
                  fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {row.cluster}
              </th>
              {regions.map((_, ci) => {
                const cell = row.cells[ci];
                const status = cell?.status ?? 'unknown';
                return (
                  <td
                    key={`cell-${row.id}-${ci}`}
                    data-status={status}
                    style={{
                      padding: '8px 10px',
                      verticalAlign: 'top',
                      borderLeft: `3px solid ${cellTone(status)}`,
                      fontSize: 11.5,
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--cm-fg-2)',
                    }}
                  >
                    {cell ? (
                      <>
                        {cell.nodes !== undefined && (
                          <div>
                            <span style={{ color: 'var(--cm-fg-3)' }}>nodes </span>
                            <span style={{ color: 'var(--cm-fg-0)', fontWeight: 600 }}>
                              {cell.nodes}
                            </span>
                          </div>
                        )}
                        {cell.pods !== undefined && (
                          <div>
                            <span style={{ color: 'var(--cm-fg-3)' }}>pods </span>
                            <span style={{ color: 'var(--cm-fg-0)', fontWeight: 600 }}>
                              {cell.pods}
                            </span>
                          </div>
                        )}
                        {cell.ready !== undefined && cell.total !== undefined && (
                          <div>
                            <span style={{ color: 'var(--cm-fg-3)' }}>ready </span>
                            <span
                              style={{
                                color: cellTone(status),
                                fontWeight: 600,
                              }}
                            >
                              {cell.ready}/{cell.total}
                            </span>
                          </div>
                        )}
                        {cell.alert && (
                          <div
                            className="cm-eks-alert"
                            style={{
                              marginTop: 4,
                              padding: '2px 6px',
                              borderRadius: 999,
                              background: 'var(--cm-bg-2, transparent)',
                              border: `1px solid ${cellTone(status)}`,
                              color: cellTone(status),
                              display: 'inline-block',
                              fontSize: 10.5,
                            }}
                          >
                            {cell.alert}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--cm-fg-3)' }}>–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default MultiRegionEksDashboardRenderer;
