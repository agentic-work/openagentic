import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const CHANNEL_ARROW = '↻';
const TRUNCATE_AT = 60;

const CHANNEL_RE =
  /<channel\s+source="([^"]+)"([^>]*)>\n?([\s\S]*?)\n?<\/channel>/;
const USER_ATTR_RE = /\buser="([^"]+)"/;

function displayServerName(name: string): string {
  const i = name.lastIndexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function truncateToWidth(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export interface UserChannelMessageProps {
  text: string;
  addMargin?: boolean;
}

export const UserChannelMessage: React.FC<UserChannelMessageProps> = ({
  text,
  addMargin,
}) => {
  const m = CHANNEL_RE.exec(text);
  if (!m) return null;
  const [, source = '', attrs = '', content = ''] = m;
  const userMatch = USER_ATTR_RE.exec(attrs);
  const user = userMatch?.[1];
  const body = content.trim().replace(/\s+/g, ' ');
  const truncated = truncateToWidth(body, TRUNCATE_AT);

  return (
    <div
      data-part="user_channel"
      className="cm-part cm-channel"
      style={{
        marginTop: addMargin ? 8 : 0,
        padding: '2px 0',
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 13,
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
      }}
    >
      <span style={{ color: ACCENT }} aria-hidden>
        {CHANNEL_ARROW}
      </span>
      <span style={{ color: DIM }}>
        {displayServerName(source)}
        {user ? ` · ${user}` : ''}:
      </span>
      <span>{truncated}</span>
    </div>
  );
};

export default UserChannelMessage;
