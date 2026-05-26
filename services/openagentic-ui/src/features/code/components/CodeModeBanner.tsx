import React from 'react';

export interface CodeModeBannerProps {
  /**
   * False when the caller wants to hide the banner (e.g. user has
   * scrolled past it). Defaults to true so the banner is shown by
   * default and the caller can opt out.
   */
  visible?: boolean;
}

export const CodeModeBanner: React.FC<CodeModeBannerProps> = ({ visible = true }) => {
  if (!visible) return null;
  return (
    <div
      data-testid="cm-banner"
      className="cm-banner"
      style={{
        padding: '22px 32px 0',
        textAlign: 'center',
        opacity: 0.18,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
      aria-hidden
    >
      <div
        className="cm-banner-pixel"
        style={{
          fontFamily:
            'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
          fontSize: 9,
          letterSpacing: '0.18em',
          color: 'var(--cm-accent, #89b4fa)',
          whiteSpace: 'pre',
          lineHeight: 1,
          textShadow: '0 0 8px rgba(137,180,250,0.3)',
        }}
      >
        [ A G E N T I C W O R K ]
      </div>
    </div>
  );
};

export default CodeModeBanner;
