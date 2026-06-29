/**
 * VersionMatrixRenderer — compose_app:version_matrix template.
 *
 * Package × environment grid showing installed vs latest, color-coded by
 * drift severity (major / minor / patch / equal). Cells render as two-line
 * stacks (installed over latest) when there's any drift.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-05-troubleshoot-fix-build-validate.html.
 */

import React, { useMemo } from 'react';

export type DriftLevel = 'equal' | 'patch' | 'minor' | 'major' | 'invalid';

export interface VersionEntry {
  package: string;
  environment: string;
  installed: string;
  latest: string;
}

export interface VersionMatrixRendererProps {
  title?: string;
  subtitle?: string;
  packages?: ReadonlyArray<string>;
  environments?: ReadonlyArray<string>;
  entries?: ReadonlyArray<VersionEntry>;
}

function classify(installed: string, latest: string): DriftLevel {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(installed);
  const b = parse(latest);
  if (!a || !b) return 'invalid';
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'equal';
}

function driftTone(d: DriftLevel): string {
  switch (d) {
    case 'equal':
      return 'var(--cm-success, currentColor)';
    case 'patch':
      return 'var(--cm-info, currentColor)';
    case 'minor':
      return 'var(--cm-warn, currentColor)';
    case 'major':
      return 'var(--cm-error, currentColor)';
    case 'invalid':
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function VersionMatrixRenderer(props: VersionMatrixRendererProps) {
  const { title, subtitle, packages, environments, entries } = props;
  const safeP = Array.isArray(packages) ? packages : [];
  const safeE = Array.isArray(environments) ? environments : [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  const lookup = useMemo(() => {
    const m = new Map<string, VersionEntry>();
    for (const e of safeEntries) m.set(`${e.package}\x00${e.environment}`, e);
    return m;
  }, [safeEntries]);

  if (safeP.length === 0 || safeE.length === 0) {
    return (
      <div data-testid="version-matrix-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no version data
      </div>
    );
  }

  return (
    <div
      data-testid="version-matrix-renderer"
      className="cm-version-matrix"
      style={{ display: 'grid', gap: 12, color: 'var(--cm-fg)' }}
    >
      {(title || subtitle) && (
        <div>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
          )}
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--cm-fg-dim)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      )}
      <div
        style={{
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          overflow: 'auto',
        }}
      >
        <table
          style={{
            borderCollapse: 'collapse',
            minWidth: '100%',
            fontSize: 12,
            fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  background: 'var(--cm-bg-3, var(--cm-bg-2))',
                  color: 'var(--cm-fg-dim)',
                  fontWeight: 600,
                  borderBottom: '1px solid var(--cm-border)',
                }}
              >
                package
              </th>
              {safeE.map((e) => (
                <th
                  key={e}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    background: 'var(--cm-bg-3, var(--cm-bg-2))',
                    color: 'var(--cm-fg-dim)',
                    fontWeight: 600,
                    borderBottom: '1px solid var(--cm-border)',
                  }}
                >
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeP.map((p) => (
              <tr key={p}>
                <td
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid var(--cm-border)',
                    color: 'var(--cm-fg)',
                  }}
                >
                  {p}
                </td>
                {safeE.map((e) => {
                  const entry = lookup.get(`${p}\x00${e}`);
                  if (!entry) {
                    return (
                      <td
                        key={e}
                        style={{
                          padding: '6px 12px',
                          borderBottom: '1px solid var(--cm-border)',
                          color: 'var(--cm-fg-dim)',
                        }}
                      >
                        —
                      </td>
                    );
                  }
                  const d = classify(entry.installed, entry.latest);
                  const tone = driftTone(d);
                  return (
                    <td
                      key={e}
                      data-package={p}
                      data-env={e}
                      data-drift={d}
                      style={{
                        padding: '6px 12px',
                        borderBottom: '1px solid var(--cm-border)',
                        color: tone,
                        background:
                          d === 'equal'
                            ? undefined
                            : `color-mix(in srgb, ${tone} 10%, transparent)`,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{entry.installed}</span>
                        {d !== 'equal' && (
                          <span style={{ fontSize: 10, color: 'var(--cm-fg-dim)' }}>
                            → {entry.latest}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default VersionMatrixRenderer;
