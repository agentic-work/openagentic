/**
 * TestPanel — category card showing pass/fail counts.
 */
import type { TestResult } from './useTestHarness';

interface Props {
  category: string;
  label: string;
  icon: React.ReactNode;
  results: TestResult[];
  isActive: boolean;
  onClick: () => void;
}

export default function TestPanel({ label, icon, results, isActive, onClick }: Props) {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const running = results.filter(r => r.status === 'running').length;
  const total = results.length;

  const borderColor = failed > 0
    ? 'var(--color-error)'
    : passed > 0 && passed === total
      ? 'var(--color-success)'
      : running > 0
        ? 'var(--accent-info)'
        : 'var(--color-border)';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '12px 16px',
        background: isActive ? 'var(--color-surfaceSecondary)' : 'var(--color-surface)',
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        cursor: 'pointer',
        minWidth: 100,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {total === 0 ? (
          <span style={{ color: 'var(--text-tertiary)' }}>-</span>
        ) : (
          <>
            <span style={{ color: 'var(--color-success)' }}>{passed}</span>
            {failed > 0 && <span style={{ color: 'var(--color-error)' }}> / {failed}</span>}
            <span style={{ color: 'var(--text-tertiary)' }}> / {total}</span>
          </>
        )}
      </div>
    </button>
  );
}
