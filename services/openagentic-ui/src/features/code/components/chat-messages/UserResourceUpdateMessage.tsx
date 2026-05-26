import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const REFRESH_ARROW = '↻';

type ParsedUpdate = {
  kind: 'resource' | 'polling';
  server: string;
  /** URI for resource updates, tool name for polling updates. */
  target: string;
  reason?: string;
};

function parseUpdates(text: string): ParsedUpdate[] {
  const updates: ParsedUpdate[] = [];

  const resourceRegex =
    /<mcp-resource-update\s+server="([^"]+)"\s+uri="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  let match: RegExpExecArray | null;
  while ((match = resourceRegex.exec(text)) !== null) {
    updates.push({
      kind: 'resource',
      server: match[1] ?? '',
      target: match[2] ?? '',
      reason: match[3],
    });
  }

  const pollingRegex =
    /<mcp-polling-update\s+type="([^"]+)"\s+server="([^"]+)"\s+tool="([^"]+)"[^>]*>(?:[\s\S]*?<reason>([^<]+)<\/reason>)?/g;
  while ((match = pollingRegex.exec(text)) !== null) {
    updates.push({
      kind: 'polling',
      server: match[2] ?? '',
      target: match[3] ?? '',
      reason: match[4],
    });
  }

  return updates;
}

function formatUri(uri: string): string {
  if (uri.startsWith('file://')) {
    const path = uri.slice(7);
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
  }
  if (uri.length > 40) return uri.slice(0, 39) + '…';
  return uri;
}

export interface UserResourceUpdateMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserResourceUpdateMessage: React.FC<UserResourceUpdateMessageProps> = ({
  text,
  addMargin,
}) => {
  const updates = parseUpdates(text);
  if (updates.length === 0) return null;
  return (
    <div
      data-part="user_resource_update"
      className="cm-part cm-resource-update"
      style={{
        marginTop: addMargin ? 8 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontFamily: MONO_FONT,
        fontSize: 13,
      }}
    >
      {updates.map((update, i) => (
        <div
          key={i}
          data-update={update.kind}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            color: TEXT_COLOR,
          }}
        >
          <span style={{ color: SUCCESS }} aria-hidden>
            {REFRESH_ARROW}
          </span>
          <span style={{ color: DIM }}>{update.server}:</span>
          <span style={{ color: ACCENT }}>
            {update.kind === 'resource' ? formatUri(update.target) : update.target}
          </span>
          {update.reason && (
            <span style={{ color: DIM }}> · {update.reason}</span>
          )}
        </div>
      ))}
    </div>
  );
};

export default UserResourceUpdateMessage;
