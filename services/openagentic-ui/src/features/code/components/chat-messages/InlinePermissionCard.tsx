import React from 'react';
import type { CanUseToolRequest } from '../../types/_sdk-bindings';
import { renderToolInputSummary } from './toolRenderers';

/**
 * Decision payload sent to `respondToPermission`. `alwaysAllow:true`
 * extends the existing hook contract — the host hook passes it through
 * untouched (default: ignored), or a higher layer can persist a per-tool
 * rule before forwarding. The base `behavior:'allow' | 'deny'` shape
 * matches `useCodeModeChat.respondToPermission`.
 */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; alwaysAllow?: boolean; toolName?: string }
  | { behavior: 'deny'; message?: string; interrupt?: boolean };

interface InlinePermissionCardProps {
  request: CanUseToolRequest & { request_id: string };
  onRespond: (decision: PermissionDecision) => void;
}

const MAX_INPUT_PREVIEW = 200;

/**
 * Render the input as a one-line preview, truncated to MAX_INPUT_PREVIEW.
 * Falls back to a tool-specific summary when no obvious primary field
 * exists. Used in the card's input-preview row.
 */
function previewInput(toolName: string, input: Record<string, unknown>): string {
  const summary = renderToolInputSummary(toolName, input);
  if (summary) return summary.length > MAX_INPUT_PREVIEW ? summary.slice(0, MAX_INPUT_PREVIEW - 1) + '…' : summary;
  // Generic fallback — flatten the input as JSON. Truncate to keep the
  // card scannable; the full input is still in the assistant message's
  // tool_use block (expandable above).
  try {
    const flat = JSON.stringify(input ?? {});
    return flat.length > MAX_INPUT_PREVIEW ? flat.slice(0, MAX_INPUT_PREVIEW - 1) + '…' : flat;
  } catch {
    return '';
  }
}

const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", JetBrains Mono, Menlo, Monaco, Consolas, monospace)';

const buttonStyle = (variant: 'allow' | 'always' | 'deny'): React.CSSProperties => {
  if (variant === 'allow') {
    return {
      padding: '5px 12px',
      background: 'var(--cm-accent, #58a6ff)',
      border: '1px solid var(--cm-accent, #58a6ff)',
      color: 'var(--cm-bg, #0d1117)',
      borderRadius: 4,
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontWeight: 600,
      fontSize: 12,
    };
  }
  if (variant === 'always') {
    return {
      padding: '5px 12px',
      background: 'transparent',
      border: '1px solid var(--cm-accent, #58a6ff)',
      color: 'var(--cm-accent, #58a6ff)',
      borderRadius: 4,
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontWeight: 500,
      fontSize: 12,
    };
  }
  return {
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid var(--cm-error, #f85149)',
    color: 'var(--cm-error, #f85149)',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
  };
};

export const InlinePermissionCard: React.FC<InlinePermissionCardProps> = ({
  request,
  onRespond,
}) => {
  const inputPreview = previewInput(request.tool_name, request.input ?? {});

  const handleAllowOnce = () => {
    onRespond({ behavior: 'allow' });
  };

  const handleAllowAlways = () => {
    onRespond({
      behavior: 'allow',
      alwaysAllow: true,
      toolName: request.tool_name,
    });
  };

  const handleDeny = () => {
    onRespond({ behavior: 'deny', message: 'User denied via inline card' });
  };

  return (
    <div
      data-testid="cm-inline-permission"
      data-request-id={request.request_id}
      style={{
        marginTop: 10,
        marginBottom: 4,
        padding: '10px 12px',
        background: 'var(--cm-bg-secondary, #161b22)',
        border: '1px solid var(--cm-border, #30363d)',
        borderLeft: '3px solid var(--cm-warning, var(--accent-warning, #d29922))',
        borderRadius: 4,
        fontFamily: MONO_FONT,
        color: 'var(--cm-text, #e6edf3)',
      }}
    >
      {/* Header row — `Tool: Bash` */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.6ch',
          fontSize: 12,
          color: 'var(--cm-text-muted, #8b949e)',
          marginBottom: 6,
        }}
      >
        <span
          aria-hidden
          style={{ color: 'var(--cm-warning, #d29922)' }}
        >
          ⚠
        </span>
        <span>Tool:</span>
        <span style={{ color: 'var(--cm-accent, #58a6ff)', fontWeight: 600 }}>
          {request.tool_name}
        </span>
        <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 11 }}>
          permission requested
        </span>
      </div>

      {/* Input preview — single-line truncated. */}
      {inputPreview && (
        <pre
          style={{
            margin: 0,
            marginBottom: 8,
            padding: '6px 8px',
            background: 'var(--cm-bg, #0d1117)',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 4,
            fontSize: 11.5,
            color: 'var(--cm-text, #e6edf3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflow: 'hidden',
          }}
        >
          {inputPreview}
        </pre>
      )}

      {/* Three actions. Order: Allow once (primary), Allow always
          (secondary), Deny (destructive on the right). */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          data-testid="cm-inline-permission-allow-once"
          onClick={handleAllowOnce}
          style={buttonStyle('allow')}
        >
          Allow once
        </button>
        <button
          type="button"
          data-testid="cm-inline-permission-allow-always"
          onClick={handleAllowAlways}
          style={buttonStyle('always')}
          title={`Allow ${request.tool_name} for the rest of this session`}
        >
          Allow always
        </button>
        <button
          type="button"
          data-testid="cm-inline-permission-deny"
          onClick={handleDeny}
          style={{ ...buttonStyle('deny'), marginLeft: 'auto' }}
        >
          Deny
        </button>
      </div>
    </div>
  );
};

export default InlinePermissionCard;
