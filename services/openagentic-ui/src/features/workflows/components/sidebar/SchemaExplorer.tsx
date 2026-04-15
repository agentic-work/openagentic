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

/**
 * SchemaExplorer - Tree browser for data source tables and columns
 * Supports drag-to-canvas to create data_source_query nodes
 */

import React, { useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Key,
} from '@/shared/icons';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
}

export interface SchemaTable {
  name: string;
  schema?: string;
  columns: SchemaColumn[];
  rowCount?: number;
}

interface SchemaExplorerProps {
  tables: SchemaTable[];
  dataSourceId: string;
  dataSourceName: string;
}

/** Short type indicator text by column type category */
function typeIndicator(type: string): { text: string; color: string } {
  const t = type.toLowerCase();
  if (t.includes('int') || t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('numeric') || t.includes('serial') || t.includes('real')) {
    return { text: '#', color: '#4fc3f7' };
  }
  if (t.includes('bool')) {
    return { text: 'B', color: '#ab47bc' };
  }
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) {
    return { text: 'D', color: '#ffb74d' };
  }
  if (t.includes('json') || t.includes('array')) {
    return { text: '{}', color: '#66bb6a' };
  }
  // default: string / text / varchar / char / uuid / etc.
  return { text: 'T', color: '#90a4ae' };
}

export const SchemaExplorer: React.FC<SchemaExplorerProps> = ({
  tables,
  dataSourceId,
  dataSourceName,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleTable = useCallback((tableName: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, table: SchemaTable) => {
    const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;
    e.dataTransfer.setData('application/reactflow-node', JSON.stringify({
      type: 'data_source_query',
      data: {
        label: `Query ${table.name}`,
        dataSourceId,
        mode: 'raw',
        query: `SELECT * FROM ${fullName} LIMIT 100`,
        icon: 'Database',
        color: '#2196f3',
      },
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, [dataSourceId]);

  if (tables.length === 0) {
    return (
      <div style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--text-tertiary, #999)' }}>
        No tables found
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: '4px' }}>
      {tables.map(table => {
        const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;
        const isExpanded = expanded.has(fullName);

        return (
          <div key={fullName}>
            {/* Table row */}
            <div
              draggable
              onDragStart={e => handleDragStart(e, table)}
              onClick={() => toggleTable(fullName)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 6px',
                borderRadius: '3px',
                cursor: 'grab',
                fontSize: '11px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, #2a2a2a)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {isExpanded
                ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-tertiary, #999)' }} />
                : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-tertiary, #999)' }} />
              }
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                color: '#2196f3',
                width: '14px',
                textAlign: 'center',
                flexShrink: 0,
              }}>
                T
              </span>
              <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {table.name}
              </span>
              {table.rowCount !== undefined && (
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary, #999)', flexShrink: 0 }}>
                  {table.rowCount.toLocaleString()}
                </span>
              )}
            </div>

            {/* Columns */}
            {isExpanded && table.columns.length > 0 && (
              <div style={{ paddingLeft: '20px' }}>
                {table.columns.map(col => {
                  const ti = typeIndicator(col.type);
                  return (
                    <div
                      key={col.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '1px 6px',
                        fontSize: '11px',
                      }}
                    >
                      {col.primaryKey && (
                        <Key className="w-2.5 h-2.5 flex-shrink-0" style={{ color: '#ffc107' }} />
                      )}
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        color: ti.color,
                        width: col.primaryKey ? '10px' : '14px',
                        textAlign: 'center',
                        flexShrink: 0,
                      }}>
                        {ti.text}
                      </span>
                      <span style={{ flex: 1, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.name}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary, #777)', flexShrink: 0 }}>
                        {col.type}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
