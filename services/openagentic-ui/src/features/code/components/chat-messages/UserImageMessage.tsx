import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export interface UserImageMessageProps {
  imageId?: number;
  imageUrl?: string;
  addMargin?: boolean;
}

export const UserImageMessage: React.FC<UserImageMessageProps> = ({
  imageId,
  imageUrl,
  addMargin,
}) => {
  const label = imageId ? `[Image #${imageId}]` : '[Image]';
  const content = imageUrl ? (
    <a
      href={imageUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: ACCENT, textDecoration: 'none' }}
    >
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
  return (
    <div
      data-part="user_image"
      className="cm-part cm-user-image"
      style={{
        marginTop: addMargin ? 8 : 0,
        padding: '2px 0',
        color: TEXT_COLOR,
        fontFamily: MONO_FONT,
        fontSize: 12,
      }}
    >
      {content}
    </div>
  );
};

export default UserImageMessage;
