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

interface TreeNodeProps {
  status: 'success' | 'thinking' | 'running' | 'error' | 'artifact' | 'hitl';
  children: React.ReactNode;
  isLast?: boolean;
  depth?: number;
}

const STATUS_COLORS: Record<string, string> = {
  success: '#3fb950',
  thinking: '#d29922',
  running: '#58a6ff',
  error: '#f85149',
  artifact: '#bc8cff',
  hitl: '#d29922',
};

export function TreeNode({ status, children, isLast = false, depth = 0 }: TreeNodeProps) {
  return (
    <div style={{
      position: 'relative',
      paddingLeft: depth > 0 ? 20 : 0,
      marginLeft: depth > 0 ? 8 : 0,
    }}>
      {/* Vertical connector line */}
      {depth > 0 && !isLast && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: 'rgba(255,255,255,0.05)',
        }} />
      )}
      {/* Horizontal connector */}
      {depth > 0 && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 10,
          width: 12,
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.05)',
        }} />
      )}
      {/* Status dot */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '2px 0',
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: STATUS_COLORS[status] || STATUS_COLORS.running,
          marginTop: 5,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
