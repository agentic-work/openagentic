/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useMemo, useState } from 'react';

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';

export interface ListItem {
  name: string;
  detail?: string;
  status?: string;
  badge?: string;
}

interface SessionInfoModalProps {
  title: string;
  items: ListItem[];
  onClose: () => void;
  onAction?: (item: ListItem, action: string) => void;
  actionLabel?: string;
}

export const SessionInfoModal: React.FC<SessionInfoModalProps> = ({
  title,
  items,
  onClose,
  onAction,
  actionLabel,
}) => {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.detail?.toLowerCase().includes(q),
    );
  }, [items, filter]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          maxHeight: '70vh',
          backgroundColor: 'var(--cm-bg-secondary, #161b22)',
          color: 'var(--cm-text, #e6edf3)',
          border: '1px solid var(--cm-border, #30363d)',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* header */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--cm-border, #30363d)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--cm-text-muted, #8b949e)',
            }}
          >
            {filtered.length}/{items.length}
          </span>
        </div>

        {/* search */}
        <div style={{ padding: '6px 14px' }}>
          <input
            autoFocus
            placeholder="filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 8px',
              fontFamily: 'inherit',
              fontSize: 12,
              backgroundColor: 'var(--cm-bg, #0d1117)',
              color: 'var(--cm-text, #e6edf3)',
              border: '1px solid var(--cm-border, #30363d)',
              borderRadius: 4,
              outline: 'none',
            }}
          />
        </div>

        {/* list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: '16px 14px',
                textAlign: 'center',
                color: 'var(--cm-text-muted, #8b949e)',
                fontSize: 12,
              }}
            >
              {items.length === 0 ? 'none available' : 'no matches'}
            </div>
          )}
          {filtered.map((item) => (
            <div
              key={item.name}
              style={{
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'baseline',
                gap: '1ch',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--cm-accent, #58a6ff)', fontWeight: 500 }}>
                {item.name}
              </span>
              {item.badge && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 5px',
                    borderRadius: 3,
                    backgroundColor:
                      item.badge === 'connected' || item.badge === 'active'
                        ? 'rgba(63, 185, 80, 0.15)'
                        : 'rgba(139, 148, 158, 0.15)',
                    color:
                      item.badge === 'connected' || item.badge === 'active'
                        ? 'var(--cm-success, #3fb950)'
                        : 'var(--cm-text-muted, #8b949e)',
                  }}
                >
                  {item.badge}
                </span>
              )}
              {item.detail && (
                <span
                  style={{
                    color: 'var(--cm-text-muted, #8b949e)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {item.detail}
                </span>
              )}
              {onAction && actionLabel && (
                <button
                  type="button"
                  onClick={() => onAction(item, actionLabel)}
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 3,
                    background: 'transparent',
                    border: '1px solid var(--cm-border, #30363d)',
                    color: 'var(--cm-text-muted, #8b949e)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    flexShrink: 0,
                  }}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* footer */}
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--cm-border, #30363d)',
            fontSize: 11,
            color: 'var(--cm-text-muted, #8b949e)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>esc close</span>
          <span style={{ marginLeft: 'auto' }}>
            actions run via openagentic on your pod
          </span>
        </div>
      </div>
    </div>
  );
};
