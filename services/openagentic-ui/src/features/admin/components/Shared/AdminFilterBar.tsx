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

import React from 'react';

export interface TimeRangeOption {
  value: string;
  label: string;
}

export interface AdminFilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  timeRange: string;
  onTimeRangeChange: (value: string) => void;
  timeRangeOptions?: TimeRangeOption[];
  onRefresh?: () => void;
  refreshing?: boolean;
  extraFilters?: React.ReactNode;
  className?: string;
}

const DEFAULT_TIME_RANGES: TimeRangeOption[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

/**
 * Shared filter toolbar for admin views.
 * Search input + time range pill selector + refresh button + optional extra filters.
 */
export const AdminFilterBar: React.FC<AdminFilterBarProps> = ({
  searchTerm,
  onSearchChange,
  timeRange,
  onTimeRangeChange,
  timeRangeOptions = DEFAULT_TIME_RANGES,
  onRefresh,
  refreshing = false,
  extraFilters,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center gap-3 flex-wrap ${className}`}
    >
      {/* Search input */}
      <div className="relative flex-shrink-0" style={{ minWidth: 200 }}>
        {/* Search icon */}
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="w-full pl-8 pr-3 py-1.5 rounded-md text-sm outline-none transition-colors"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--text-primary)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-primary)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        />
      </div>

      {/* Time range pills */}
      <div
        className="flex items-center rounded-md overflow-hidden flex-shrink-0"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {timeRangeOptions.map((opt) => {
          const isActive = timeRange === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onTimeRangeChange(opt.value)}
              className="px-2.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                borderRight: '1px solid var(--color-border)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover, color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)))';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                }
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Extra filters slot */}
      {extraFilters}

      {/* Refresh button */}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-md transition-colors flex-shrink-0"
          style={{
            color: refreshing ? 'var(--text-tertiary)' : 'var(--text-secondary)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            cursor: refreshing ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!refreshing) {
              e.currentTarget.style.borderColor = 'var(--color-primary)';
              e.currentTarget.style.color = 'var(--color-primary)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
            e.currentTarget.style.color = refreshing ? 'var(--text-tertiary)' : 'var(--text-secondary)';
          }}
          title="Refresh"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={refreshing ? 'animate-spin' : ''}
            style={{ color: 'currentColor' }}
          >
            <path
              d="M13.5 8a5.5 5.5 0 01-10.58 2.12M2.5 8a5.5 5.5 0 0110.58-2.12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M13.5 3v3.5H10M2.5 13V9.5H6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
