/**
 * Phase F.3 — inline streaming table.
 *
 * Takes a detected `{rows, columns}` payload (see utils/tableRowStream.ts)
 * and reveals rows progressively so a paginated MCP result (Azure / AWS /
 * GCP `list_*` calls) animates in instead of landing as a single block.
 *
 * The rows have already arrived at this point — the "stream" is a client
 * -side reveal pacing out at ~20 rows/second so users feel the response
 * land. If rows > MAX_ROWS the trailing set is shown collapsed behind a
 * "+N more" pill so 900-result cloud queries don't tank the scroll.
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  type TableRowStreamData,
  formatCell,
  revealedSlice,
} from '../utils/tableRowStream';

interface InlineStreamingTableProps {
  data: TableRowStreamData;
  /** Reveal delay per row in ms; 0 skips the animation. */
  rowDelayMs?: number;
  /** Hard cap on rendered rows; the overflow gets a "+N more" tail. */
  maxRows?: number;
  /** Optional label shown above the table. */
  title?: string;
}

const DEFAULT_ROW_DELAY_MS = 50;
const DEFAULT_MAX_ROWS = 50;

const InlineStreamingTableComponent: React.FC<InlineStreamingTableProps> = ({
  data,
  rowDelayMs = DEFAULT_ROW_DELAY_MS,
  maxRows = DEFAULT_MAX_ROWS,
  title,
}) => {
  const renderableRows = useMemo(() => data.rows.slice(0, maxRows), [data.rows, maxRows]);
  const overflow = Math.max(0, data.rows.length - renderableRows.length);
  const target = renderableRows.length;

  const [revealed, setRevealed] = useState<number>(rowDelayMs <= 0 ? target : 0);

  useEffect(() => {
    if (rowDelayMs <= 0) {
      setRevealed(target);
      return;
    }
    // Reset when data changes (new tool call returning a fresh table).
    setRevealed(0);
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      setRevealed(current);
      if (current >= target) clearInterval(interval);
    }, rowDelayMs);
    return () => clearInterval(interval);
  }, [target, rowDelayMs]);

  const visibleRows = revealedSlice(renderableRows, revealed);

  return (
    <div
      data-testid="inline-streaming-table"
      style={{
        marginTop: 6,
        marginLeft: 24,
        padding: '6px 10px 8px',
        borderLeft: '2px solid var(--color-border)',
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--color-text-muted)',
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <thead>
            <tr>
              {data.columns.map((col) => (
                <th
                  key={col}
                  style={{
                    textAlign: 'left',
                    padding: '4px 8px',
                    borderBottom: '1px solid var(--color-border)',
                    color: 'var(--color-text-muted)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                style={{
                  animation: 'fadeIn 160ms ease-out',
                }}
              >
                {data.columns.map((col) => (
                  <td
                    key={col}
                    style={{
                      padding: '3px 8px',
                      borderBottom: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
                      color: 'var(--color-text)',
                      whiteSpace: 'nowrap',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={formatCell(row[col])}
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {revealed < target && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {`streaming ${revealed}/${target} rows…`}
        </div>
      )}
      {overflow > 0 && revealed >= target && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 4,
          }}
        >
          + {overflow} more rows hidden
        </div>
      )}
    </div>
  );
};

export const InlineStreamingTable = memo(InlineStreamingTableComponent);
InlineStreamingTable.displayName = 'InlineStreamingTable';
