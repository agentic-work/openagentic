/**
 * toolRound — NDJSON envelopes for grouping parallel tool calls.
 *
 * When the chat pipeline launches N tools in parallel, emit:
 *   tool_round_start { roundId, toolCount, toolIds, toolNames }
 *   ...per-tool tool_executing / tool_progress / tool_complete with roundId
 *   tool_round_end   { roundId, succeeded, failed, durationMs }
 *
 * UI groups by roundId into one "Running N tools…" card that fans into
 * per-tool progress. Back-compat: old clients ignore unknown types.
 */

import crypto from 'crypto';

export interface RoundStartFrame {
  roundId: string;
  toolCount: number;
  toolIds: string[];
  toolNames: string[];
  timestamp: string;
}

export interface RoundEndFrame {
  roundId: string;
  succeeded: number;
  failed: number;
  durationMs: number;
  timestamp: string;
}

interface ToolDescriptor {
  toolCallId: string;
  toolName: string;
}

type EmitFn = (event: string, data: Record<string, unknown>) => void;

export function newRoundId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function emitRoundStart(
  emit: EmitFn,
  tools: ToolDescriptor[],
  providedRoundId?: string,
): string {
  if (!tools || tools.length === 0) return providedRoundId ?? '';
  const roundId = providedRoundId ?? newRoundId();
  const frame: RoundStartFrame = {
    roundId,
    toolCount: tools.length,
    toolIds: tools.map((t) => t.toolCallId),
    toolNames: tools.map((t) => t.toolName),
    timestamp: new Date().toISOString(),
  };
  emit('tool_round_start', frame as unknown as Record<string, unknown>);
  return roundId;
}

export interface RoundEndInput {
  roundId: string;
  succeeded: number;
  failed: number;
  durationMs: number;
}

export function emitRoundEnd(emit: EmitFn, input: RoundEndInput): void {
  const frame: RoundEndFrame = {
    roundId: input.roundId,
    succeeded: input.succeeded,
    failed: input.failed,
    durationMs: input.durationMs,
    timestamp: new Date().toISOString(),
  };
  emit('tool_round_end', frame as unknown as Record<string, unknown>);
}
