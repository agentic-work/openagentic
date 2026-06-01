import React, { useEffect, useRef, useCallback } from 'react';
import { CloseIcon as X } from './AdminIcons';

export interface SlideInPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Show backdrop overlay */
  showBackdrop?: boolean;
  /** Close on backdrop click */
  closeOnBackdropClick?: boolean;
  /** Close on Escape key */
  closeOnEscape?: boolean;
}

const widthClasses = {
  sm: 'w-[400px]',
  md: 'w-[600px]',
  lg: 'w-[800px]',
  xl: 'w-[1000px]',
  full: 'w-full max-w-[1200px]',
};

/**
 * GCP-style slide-in panel from right edge
 * Uses CSS variables for theming - no hardcoded colors
 */
export const SlideInPanel: React.FC<SlideInPanelProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  width = 'md',
  children,
  footer,
  showBackdrop = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  // Focus trap and keyboard handling
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Focus the close button when panel opens
      setTimeout(() => firstFocusableRef.current?.focus(), 100);
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ backgroundColor: showBackdrop ? 'color-mix(in srgb, var(--color-shadow) 50%, transparent)' : 'transparent' }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-panel-title"
    >
      {/* Panel — M3 Expressive (task #160): surface-2, soft-lg shadow, 24px
          radius on top-left + bottom-left for the exposed edge. */}
      <div
        ref={panelRef}
        className={`
          h-full flex flex-col
          ${widthClasses[width]}
          transform transition-transform duration-300 ease-emphasized
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{
          backgroundColor: 'var(--surface-2)',
          boxShadow: 'var(--shadow-soft-lg)',
          borderTopLeftRadius: 'var(--radius-panel)',
          borderBottomLeftRadius: 'var(--radius-panel)',
        }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surfaceSecondary)',
          }}
        >
          <div className="flex-1 min-w-0">
            <h2
              id="slide-panel-title"
              className="text-lg font-semibold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className="text-sm mt-0.5 truncate"
                style={{ color: 'var(--text-secondary)' }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            ref={firstFocusableRef}
            onClick={onClose}
            className="ml-4 p-2 rounded-lg transition-colors"
            style={{
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            aria-label="Close panel"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-y-auto px-6 py-4"
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className="flex-shrink-0 px-6 py-4 flex items-center justify-end gap-3"
            style={{
              borderTop: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surfaceSecondary)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Styled button for use in SlideInPanel footer
 */
export const PanelButton: React.FC<{
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  type?: 'button' | 'submit';
}> = ({ variant = 'secondary', onClick, disabled, children, type = 'button' }) => {
  const getStyles = () => {
    // M3 Expressive (task #160): primary/danger → pill; secondary → btn (12px).
    // Press scale handled via the CSS active:scale-[0.98] rule added to the
    // class string below.
    const isFilled = variant === 'primary' || variant === 'danger';
    const base = {
      padding: isFilled ? '8px 20px' : '8px 16px',
      borderRadius: isFilled ? 'var(--radius-btn-pill)' : 'var(--radius-btn-soft)',
      fontSize: 'var(--text-sm)',
      fontWeight: '500',
      letterSpacing: '-0.01em',
      transition: 'background-color 200ms var(--ease-emphasized), border-color 200ms var(--ease-emphasized), transform 150ms var(--ease-emphasized)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    };

    switch (variant) {
      case 'primary':
        return {
          ...base,
          backgroundColor: 'var(--color-primary)',
          color: 'var(--ap-fg-0)',
          border: 'none',
        };
      case 'danger':
        return {
          ...base,
          backgroundColor: 'var(--color-error)',
          color: 'var(--ap-fg-0)',
          border: 'none',
        };
      default:
        return {
          ...base,
          backgroundColor: 'transparent',
          color: 'var(--text-primary)',
          border: '1px solid var(--color-border)',
        };
    }
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-focus-ring"
      style={getStyles()}
      onMouseEnter={(e) => {
        if (!disabled) {
          if (variant === 'primary') {
            e.currentTarget.style.filter = 'brightness(1.1)';
          } else if (variant === 'danger') {
            e.currentTarget.style.filter = 'brightness(1.1)';
          } else {
            e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
          }
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none';
        if (variant === 'secondary') {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      {children}
    </button>
  );
};

export default SlideInPanel;
