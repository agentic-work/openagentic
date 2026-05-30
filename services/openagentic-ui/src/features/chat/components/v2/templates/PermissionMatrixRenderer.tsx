/**
 * PermissionMatrixRenderer — compose_app:permission_matrix template.
 *
 * Principals × actions grid. Each cell is allow / deny / conditional with
 * tone-tinted background. Conditional cells surface the condition text on
 * hover via <title>.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-02-enterprise-multi-tenant-audit.html.
 */

import React, { useMemo } from 'react';

export type CellEffect = 'allow' | 'deny' | 'conditional';

export interface PermissionCell {
  principal: string;
  action: string;
  effect: CellEffect;
  condition?: string;
}

export interface PermissionMatrixRendererProps {
  title?: string;
  subtitle?: string;
  principals?: ReadonlyArray<string>;
  actions?: ReadonlyArray<string>;
  cells?: ReadonlyArray<PermissionCell>;
}

function effectTone(e?: CellEffect): string {
  switch (e) {
    case 'allow':
      return 'var(--cm-success, currentColor)';
    case 'deny':
      return 'var(--cm-error, currentColor)';
    case 'conditional':
      return 'var(--cm-warn, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

function effectGlyph(e?: CellEffect): string {
  switch (e) {
    case 'allow':
      return '✓';
    case 'deny':
      return '✕';
    case 'conditional':
      return '◐';
    default:
      return '·';
  }
}

export function PermissionMatrixRenderer(props: PermissionMatrixRendererProps) {
  const { title, subtitle, principals, actions, cells } = props;
  const safeP = Array.isArray(principals) ? principals : [];
  const safeA = Array.isArray(actions) ? actions : [];
  const safeC = Array.isArray(cells) ? cells : [];

  const cellLookup = useMemo(() => {
    const m = new Map<string, PermissionCell>();
    for (const c of safeC) m.set(`${c.principal}\x00${c.action}`, c);
    return m;
  }, [safeC]);

  if (safeP.length === 0 || safeA.length === 0) {
    return (
      <div data-testid="permission-matrix-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no permission data
      </div>
    );
  }

  return (
    <div
      data-testid="permission-matrix-renderer"
      className="cm-permission-matrix"
      style={{
        background: 'var(--cm-bg-2)',
        border: '1px solid var(--cm-border)',
        borderRadius: 'var(--cm-radius, 6px)',
        padding: 0,
        color: 'var(--cm-fg)',
        overflow: 'hidden',
      }}
    >
      {(title || subtitle) && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--cm-border)',
            background: 'var(--cm-bg-3, var(--cm-bg-2))',
          }}
        >
          {title && (
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
          )}
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="permission-matrix-table"
          style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}
        >
          <thead>
            <tr>
              <th
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  position: 'sticky',
                  left: 0,
                  background: 'var(--cm-bg-2)',
                  color: 'var(--cm-fg-dim)',
                  borderBottom: '1px solid var(--cm-border)',
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontWeight: 600,
                }}
              >
                principal \ action
              </th>
              {safeA.map((a) => (
                <th
                  key={a}
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    fontWeight: 600,
                    color: 'var(--cm-fg-dim)',
                    borderBottom: '1px solid var(--cm-border)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {safeP.map((p) => (
              <tr key={p}>
                <td
                  style={{
                    padding: '8px 12px',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--cm-bg-2)',
                    color: 'var(--cm-fg)',
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    borderBottom: '1px solid var(--cm-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p}
                </td>
                {safeA.map((a) => {
                  const cell = cellLookup.get(`${p}\x00${a}`);
                  const tone = effectTone(cell?.effect);
                  return (
                    <td
                      key={a}
                      data-principal={p}
                      data-action={a}
                      data-effect={cell?.effect ?? 'none'}
                      style={{
                        padding: 0,
                        borderBottom: '1px solid var(--cm-border)',
                        textAlign: 'center',
                      }}
                    >
                      <span
                        title={cell?.condition || cell?.effect || ''}
                        style={{
                          display: 'inline-flex',
                          width: 32,
                          height: 28,
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                          color: tone,
                          background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                          borderRadius: 4,
                          margin: 4,
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                      >
                        {effectGlyph(cell?.effect)}
                      </span>
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

export default PermissionMatrixRenderer;
