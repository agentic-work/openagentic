/**
 * ToolCallCard — V2 thin adapter (mock 01 parity).
 *
 * Replaces 447 LOC of bespoke chrome (framer-motion + custom collapsible
 * + StatusIndicator + ToolResultSummary + portalLink helpers) with a
 * pass-through to v2/ToolCard, which matches the canonical mock anatomy
 * at mocks/UX/01-cloud-ops.html lines 271-355: `.cm-tool` + `.cm-t-head`
 * + INPUT/RESULT `.cm-t-section` panels with JSON syntax tokens.
 *
 * Same input contract (ToolCallCardProps from activity.types.ts) so the
 * surrounding ToolCallGroup / AgenticActivityStream don't change.
 */

import React from 'react';
import { ToolCard, type ToolStatus } from '../../v2';
import type { ToolCallCardProps, ToolCallStatus } from '../types/activity.types';

function mapStatus(s: ToolCallStatus): ToolStatus {
  switch (s) {
    case 'success':
      return 'ok';
    case 'error':
      return 'err';
    case 'calling':
    case 'abandoned':
    default:
      return 'running';
  }
}

function fmtDuration(ms?: number, startTime?: number): string | undefined {
  // Prefer explicit duration; fall back to live elapsed when streaming.
  let actual = ms;
  if (actual === undefined && typeof startTime === 'number') {
    actual = Date.now() - startTime;
  }
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0) return undefined;
  if (actual < 1000) return `${actual}ms`;
  if (actual < 60_000) return `${(actual / 1000).toFixed(2)}s`;
  const m = Math.floor(actual / 60_000);
  const s = Math.floor((actual % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  displayName,
  toolInput,
  toolOutput,
  status,
  duration,
  startTime,
  progressMessage,
  inputDeltaContent,
  className,
  outputTemplate,
}) => {
  const v2Status = mapStatus(status);
  const durationLabel = fmtDuration(duration, startTime);

  // Prefer streaming partial JSON over toolInput while running.
  const inputForRender =
    v2Status === 'running' && inputDeltaContent
      ? inputDeltaContent
      : toolInput;

  // 'abandoned' surfaces as err with progress as the message.
  const errorMessage =
    status === 'abandoned'
      ? progressMessage || 'Tool execution abandoned (stream closed)'
      : undefined;

  return (
    <div className="cm-v2">
      <ToolCard
        name={displayName || toolName}
        status={v2Status}
        durationLabel={durationLabel}
        input={inputForRender}
        result={toolOutput}
        errorMessage={errorMessage}
        className={className}
        outputTemplate={outputTemplate}
      />
    </div>
  );
};

export default ToolCallCard;
