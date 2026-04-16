/**
 * TestLogStream — monospace live log with auto-scroll.
 */
import { useEffect, useRef } from 'react';
import type { LogEntry } from './useTestHarness';

interface Props {
  entries: LogEntry[];
  onClear: () => void;
}

const statusColor: Record<string, string> = {
  pass: 'var(--color-success, #00D26A)',
  fail: 'var(--color-error, #ef4444)',
  skip: 'var(--color-warning, #f59e0b)',
  running: 'var(--accent-info, #06b6d4)',
  info: 'var(--text-secondary, #888)',
};

export default function TestLogStream({ entries, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div style={{
      background: 'var(--color-surface, #0a0a0a)',
      border: '1px solid var(--color-border, #222)',
      borderRadius: 8,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 300,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border, #222)',
        background: 'var(--color-surfaceSecondary, #111)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: 1, textTransform: 'uppercase' }}>
          Live Execution Log
        </span>
        <button
          onClick={onClear}
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary, #666)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 8px',
          }}
        >
          Clear
        </button>
      </div>

      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        fontFamily: "'SF Mono', 'Cascadia Code', 'JetBrains Mono', monospace",
        fontSize: 12,
        lineHeight: '20px',
      }}>
        {entries.length === 0 && (
          <div style={{ color: 'var(--text-tertiary, #555)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
            Click "Light It Up" to start testing...
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i} style={{ color: statusColor[entry.status] || '#888', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span style={{ color: 'var(--text-tertiary, #555)' }}>{entry.time}</span>{'  '}{entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
