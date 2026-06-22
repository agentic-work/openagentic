import React from 'react';
import { ToolCard, type ToolStatus } from './v2';

/**
 * EnhancedInlineToolCall — V2 thin adapter.
 *
 * Replaces ~280 LOC of bespoke chrome (tailwind classes + framer-motion +
 * status-icon switch + tool summarizer) with a pass-through to the v2
 * `ToolCard` component, which matches the mock anatomy at
 * mocks/UX/01-cloud-ops.html lines 271-355 (`.cm-tool` + `.cm-t-head` +
 * `.cm-t-body` + INPUT/RESULT `.cm-t-section`s with JSON syntax tokens).
 *
 * Input is permissive — accepts any of the four shapes the streaming
 * pipeline emits (legacy `tool/arguments`, OpenAI `function.{name,
 * arguments}`, tool-result rows with `response`/`toolName`/`functionName`).
 * That's why the prop type is wide.
 */

export interface ToolCallShape {
  // Legacy / canonical
  id?: string;
  tool?: string;
  arguments?: unknown;
  status?: 'pending' | 'executing' | 'completed' | 'failed' | string;
  result?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
  // OpenAI tool_call shape
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  // Tool-result shape (downstream after dispatch)
  toolName?: string;
  functionName?: string;
  response?: unknown;
}

export interface EnhancedInlineToolCallProps {
  toolCall: ToolCallShape;
  isStreaming?: boolean;
}

function pickName(c: ToolCallShape): string {
  return (
    c.tool ||
    c.toolName ||
    c.functionName ||
    c.function?.name ||
    'tool'
  );
}

function pickArgs(c: ToolCallShape): unknown {
  if (c.arguments !== undefined) return c.arguments;
  const raw = c.function?.arguments;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return {};
}

function deriveStatus(
  c: ToolCallShape,
  _isStreaming: boolean,
): ToolStatus {
  const explicit = c.status;
  if (explicit === 'completed') return 'ok';
  if (explicit === 'failed') return 'err';
  if (explicit === 'executing' || explicit === 'pending') return 'running';
  // No explicit status — infer from data presence.
  if (c.error) return 'err';
  if (c.result !== undefined || c.response !== undefined) return 'ok';
  return 'running';
}

function fmtDuration(c: ToolCallShape): string | undefined {
  if (typeof c.startTime !== 'number' || typeof c.endTime !== 'number') return undefined;
  const ms = c.endTime - c.startTime;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export const EnhancedInlineToolCall: React.FC<EnhancedInlineToolCallProps> = ({
  toolCall,
  isStreaming = false,
}) => {
  const name = pickName(toolCall);
  const status = deriveStatus(toolCall, isStreaming);
  const input = pickArgs(toolCall);
  const result = toolCall.result ?? toolCall.response;
  const durationLabel = fmtDuration(toolCall);
  // Audit L1-2 / Phase A3 — thread `_meta.outputTemplate` (when the wire
  // tool_result carries the FrameRendererRegistry slug) through to
  // ToolCard so registered templates render rich content instead of raw
  // JsonView.
  const outputTemplate =
    (toolCall as { outputTemplate?: string }).outputTemplate ??
    (toolCall as { _meta?: { outputTemplate?: string } })._meta?.outputTemplate;

  return (
    <div className="cm-v2">
      <ToolCard
        name={name}
        status={status}
        durationLabel={durationLabel}
        input={input}
        result={result}
        errorMessage={toolCall.error}
        outputTemplate={outputTemplate}
      />
    </div>
  );
};

export default EnhancedInlineToolCall;
