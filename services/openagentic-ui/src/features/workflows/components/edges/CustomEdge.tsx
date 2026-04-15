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
 * Custom Edge Component
 * Professional edge with delete button, execution-aware animations, and data flow visualization (D2: Living Edges)
 */

import React, { memo, useCallback } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer, useReactFlow } from 'reactflow';
import { X } from '@/shared/icons';

export const CustomEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  style = {},
  markerEnd,
  data,
}: EdgeProps) => {
  const reactFlow = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    reactFlow.deleteElements({ edges: [{ id }] });
  }, [id, reactFlow]);

  const executionState = data?.executionState as string | undefined;
  const dataType = data?.dataType as string | undefined;
  const payloadSize = data?.payloadSize as number | undefined;

  // Detect error edges (from error handle or explicit edgeType)
  const isErrorEdge = data?.edgeType === 'error' || sourceHandleId === 'error';

  // Determine edge color based on execution state and data type
  const getEdgeColor = () => {
    if (isErrorEdge) return '#ef4444';
    if (executionState === 'running') return '#ff9800';
    if (executionState === 'completed') return '#22c55e';
    if (executionState === 'failed') return '#f44336';
    if (dataType === 'text') return '#3b82f6';
    if (dataType === 'structured') return '#2dd4bf';
    if (dataType === 'binary') return '#ff9800';
    if (dataType === 'llm') return '#7c4dff';
    return undefined;
  };

  const edgeColor = getEdgeColor();
  const isExecuting = executionState === 'running';
  const isCompleted = executionState === 'completed';

  return (
    <>
      {/* Glow layer for executing edges */}
      {isExecuting && (
        <path
          d={edgePath}
          style={{
            ...style,
            stroke: '#ff9800',
            strokeWidth: 6,
            strokeOpacity: 0.2,
            fill: 'none',
            filter: 'blur(3px)',
          }}
        />
      )}

      {/* Glow layer for error edges */}
      {isErrorEdge && (
        <path
          d={edgePath}
          style={{
            ...style,
            stroke: '#ef4444',
            strokeWidth: 6,
            strokeOpacity: 0.15,
            fill: 'none',
            filter: 'blur(3px)',
          }}
        />
      )}

      {/* Edge path */}
      <path
        id={id}
        style={{
          ...style,
          ...(edgeColor ? { stroke: edgeColor } : {}),
          ...(isExecuting ? { strokeWidth: 2.5, strokeDasharray: '6 4' } : {}),
          ...(isErrorEdge ? { strokeWidth: 2, strokeDasharray: '8 4' } : {}),
        }}
        className={`react-flow__edge-path ${isExecuting ? 'wf-edge-flow-animated' : ''}`}
        d={edgePath}
        markerEnd={markerEnd}
      />

      <EdgeLabelRenderer>
        {/* Delete button */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="workflow-edge-button-wrapper"
        >
          <button
            className="workflow-edge-delete-button"
            onClick={handleDelete}
            title="Delete connection"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Error edge label */}
        {isErrorEdge && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - 16}px)`,
              pointerEvents: 'none',
              fontSize: 10,
              fontWeight: 700,
              color: '#ef4444',
              background: 'var(--wf-node-bg, #161b22)',
              border: '1px solid #ef444440',
              borderRadius: 10,
              padding: '1px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            Error
          </div>
        )}

        {/* Payload size badge (post-execution) */}
        {isCompleted && payloadSize !== undefined && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - 16}px)`,
              pointerEvents: 'none',
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--color-text-tertiary, #999)',
              background: 'var(--wf-node-bg)',
              border: '1px solid var(--wf-node-border)',
              borderRadius: 10,
              padding: '1px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            {payloadSize > 1024 ? `${(payloadSize / 1024).toFixed(1)}KB` : `${payloadSize}B`}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

CustomEdge.displayName = 'CustomEdge';
