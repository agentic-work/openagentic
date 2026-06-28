import React, { useState, useRef, useCallback } from 'react';

export interface AdminTooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * CSS-only positioned tooltip with hover delay.
 * No external dependencies - uses absolute positioning relative to wrapper.
 */
export const AdminTooltip: React.FC<AdminTooltipProps> = ({
  content,
  children,
  position = 'top',
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 150);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const positionStyles: Record<string, React.CSSProperties> = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
  };

  const arrowStyles: Record<string, React.CSSProperties> = {
    top: {
      bottom: -4, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
    },
    bottom: {
      top: -4, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
    },
    left: {
      right: -4, top: '50%', transform: 'translateY(-50%) rotate(45deg)',
    },
    right: {
      left: -4, top: '50%', transform: 'translateY(-50%) rotate(45deg)',
    },
  };

  return (
    <div
      role="presentation"
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            ...positionStyles[position],
            maxWidth: 300,
            whiteSpace: 'normal',
          }}
        >
          <div
            className="relative px-3 py-2 rounded-md text-xs leading-relaxed"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 4px 12px color-mix(in srgb, var(--color-shadow) 25%, transparent)',
            }}
          >
            {content}
            <div
              className="absolute w-2 h-2"
              style={{
                ...arrowStyles[position],
                backgroundColor: 'var(--color-surfaceSecondary)',
                borderRight: position === 'top' || position === 'left'
                  ? '1px solid var(--color-border)' : 'none',
                borderBottom: position === 'top' || position === 'right'
                  ? '1px solid var(--color-border)' : 'none',
                borderLeft: position === 'bottom' || position === 'right'
                  ? '1px solid var(--color-border)' : 'none',
                borderTop: position === 'bottom' || position === 'left'
                  ? '1px solid var(--color-border)' : 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Small (i) info icon that reveals a tooltip on hover.
 * Drop-in helper for labels that need contextual help.
 */
export const InfoTooltip: React.FC<{
  content: string | React.ReactNode;
  position?: AdminTooltipProps['position'];
  size?: number;
}> = ({ content, position = 'top', size = 14 }) => (
  <AdminTooltip content={content} position={position}>
    <span
      className="inline-flex items-center justify-center rounded-full cursor-help"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.7,
        fontWeight: 600,
        lineHeight: 1,
        color: 'var(--text-tertiary)',
        border: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
      aria-label="More information"
    >
      i
    </span>
  </AdminTooltip>
);
